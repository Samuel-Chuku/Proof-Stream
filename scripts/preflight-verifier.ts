// Dry run for the Phase 3 agent-to-agent economy (§5.10). Read-only: it asks
// Circle to sign one throwaway EIP-712 payload to prove the x402 signer path
// works, but never sends a payment or a transaction.
import { GATEWAY_FACILITATOR_URL, GATEWAY_WALLET_ADDRESS, USDC_ADDRESS, VERIFICATION_FEE, VERIFIER_MAX_TOKENS, formatUsdc, parseUsdc } from '@proofstream/config';
import { createPublicClient, erc20Abi, http, recoverTypedDataAddress } from 'viem';
import { arcTestnet } from 'viem/chains';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const rateLimited = String((err as Error).message).includes('request limit reached');
      if (!rateLimited || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

const GATEWAY_WALLET_ABI = [
  {
    type: 'function',
    name: 'availableBalance',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const requiredVars = ['VERIFIER_ADDRESS', 'AGENT_ADDRESS', 'AGENT_WALLET_ID', 'CIRCLE_API_KEY', 'ENTITY_SECRET'] as const;

let envOk = true;
for (const name of requiredVars) {
  const present = Boolean(process.env[name]);
  if (!present) envOk = false;
  add(`env ${name}`, present, present ? 'set' : 'MISSING');
}
if (!envOk) report();

const { env } = await import('../agent/src/env');

const client = createPublicClient({ chain: arcTestnet, transport: http(env.arcRpcUrl) });

add(
  'buyer and seller are different wallets',
  env.agentAddress.toLowerCase() !== env.verifierAddress.toLowerCase(),
  `attestor ${env.agentAddress} / verifier ${env.verifierAddress}`,
);

// The GatewayWallet must actually be deployed on Arc testnet at the documented
// address — everything downstream is worthless if this is an empty account.
try {
  const code = await withRetry(() => client.getCode({ address: GATEWAY_WALLET_ADDRESS }));
  add('GatewayWallet deployed on Arc', Boolean(code && code !== '0x'), `${GATEWAY_WALLET_ADDRESS} (${(code?.length ?? 2) / 2 - 1} bytes)`);
} catch (err) {
  add('GatewayWallet deployed on Arc', false, (err as Error).message.split('\n')[0]);
}

// The attestor must have Gateway balance to spend. Wallet USDC is not enough —
// nanopayments draw on the deposited balance, so an undeposited agent cannot pay.
const fee = parseUsdc(VERIFICATION_FEE.replace('$', ''));
try {
  const available = await withRetry(() =>
    client.readContract({
      address: GATEWAY_WALLET_ADDRESS,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'availableBalance',
      args: [USDC_ADDRESS, env.agentAddress],
    }),
  );
  add(
    `attestor Gateway balance ≥ ${VERIFICATION_FEE}`,
    available >= fee,
    available >= fee
      ? `${formatUsdc(available)} USDC (~${available / fee} calls)`
      : `${formatUsdc(available)} USDC — run pnpm gateway:deposit`,
  );
} catch (err) {
  add('attestor Gateway balance', false, (err as Error).message.split('\n')[0]);
}

try {
  const balance = await withRetry(() =>
    client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [env.agentAddress] }),
  );
  add('attestor wallet USDC (gas + deposits)', balance > 0n, `${formatUsdc(balance)} USDC`);
} catch (err) {
  add('attestor wallet USDC', false, (err as Error).message.split('\n')[0]);
}

// Seller's current credit, recorded so the demo run can show it rise (T3).
try {
  const earned = await withRetry(() =>
    client.readContract({
      address: GATEWAY_WALLET_ADDRESS,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'availableBalance',
      args: [USDC_ADDRESS, env.verifierAddress],
    }),
  );
  add('verifier Gateway balance readable', true, `${formatUsdc(earned)} USDC (baseline — batched, expect lag)`);
} catch (err) {
  add('verifier Gateway balance readable', false, (err as Error).message.split('\n')[0]);
}

// The verifier process itself, if it is already running.
try {
  const res = await fetch(env.verifierUrl.replace(/\/verify$/, '/health'));
  const body: any = await res.json();
  const sellerMatches = String(body?.verifier ?? '').toLowerCase() === env.verifierAddress.toLowerCase();
  add('verifier service up', res.ok && sellerMatches, res.ok ? `${body?.price} per call, model ${body?.model}` : `HTTP ${res.status}`);

  // tsx does not hot-reload: a seller started before the last edit keeps
  // serving old code, the buyer pays in full, and the call fails anyway.
  add(
    'verifier is running current code',
    body?.maxTokens === VERIFIER_MAX_TOKENS,
    body?.maxTokens === VERIFIER_MAX_TOKENS
      ? `maxTokens ${body.maxTokens}`
      : `serving maxTokens ${body?.maxTokens} but config says ${VERIFIER_MAX_TOKENS} — RESTART pnpm verifier:dev`,
  );

  const unpaid = await fetch(env.verifierUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prNumber: 1 }),
  });
  const header = unpaid.headers.get('PAYMENT-REQUIRED');
  let networkOk = false;
  let detail = `HTTP ${unpaid.status}`;
  if (header) {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    const accepts: any[] = decoded.accepts ?? [];
    networkOk = accepts.some((a) => a.network === 'eip155:5042002' && a.extra?.name === 'GatewayWalletBatched');
    detail = `402, accepts ${accepts.map((a) => `${a.network}@${a.amount}`).join(', ')}`;
  }
  add('unpaid /verify returns 402 for Arc testnet batching', unpaid.status === 402 && networkOk, detail);
} catch (err) {
  add('verifier service up', false, `${(err as Error).message.split('\n')[0]} — start it with pnpm verifier:dev`);
}

// THE critical check. Drives the real SDK buyer path against the live 402 and
// stops at the signature, so it proves Circle can sign what Gateway will
// accept without spending anything. If the recovered signer is wrong, every
// payment fails with invalid_signature.
try {
  const { signPaymentAuthorization } = await import('../agent/src/pay');
  const probeStream = (process.env.WORKSTREAM_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const { paymentRequired, payload } = await signPaymentAuthorization(probeStream);

  const requirements: any = (paymentRequired as any).accepts?.[0];
  const auth: any = (payload as any).payload?.authorization;
  const signature: `0x${string}` = (payload as any).payload?.signature;

  const recovered = await recoverTypedDataAddress({
    domain: {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId: arcTestnet.id,
      verifyingContract: requirements.extra.verifyingContract,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    signature,
  });

  const match = recovered.toLowerCase() === env.agentAddress.toLowerCase();
  add('x402 authorization signs as the attestor', match, match ? recovered : `got ${recovered}, expected ${env.agentAddress}`);
  add('authorization pays the verifier the asking price', auth.to.toLowerCase() === env.verifierAddress.toLowerCase() && BigInt(auth.value) === fee, `${formatUsdc(BigInt(auth.value))} USDC to ${auth.to}`);

  // Gateway rejects anything valid for less than 3 days (docs: authorization_validity_too_short).
  const validityDays = (Number(auth.validBefore) - Math.floor(Date.now() / 1000)) / 86_400;
  add('authorization validity ≥ 3 days', validityDays >= 3, `${validityDays.toFixed(1)} days`);
} catch (err) {
  add('x402 authorization signs as the attestor', false, (err as Error).message.split('\n')[0]);
}

add('facilitator is testnet', GATEWAY_FACILITATOR_URL.includes('testnet'), GATEWAY_FACILITATOR_URL);

report();

function report(): never {
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(46)} ${c.detail}`);
  }
  console.log(
    allOk
      ? '\nALL GREEN — the attestor can buy a second opinion from the verifier.'
      : '\nNOT READY — fix the FAIL lines before running the demo.',
  );
  process.exit(allOk ? 0 : 1);
}
