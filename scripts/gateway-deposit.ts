// One-time: move USDC from the attestor's wallet into its Circle Gateway
// balance so it can pay the verifier per call. Two on-chain transactions
// (approve, then deposit), both sent from the agent's own Circle wallet.
//
// Run `pnpm preflight:verifier` first — it must print ALL GREEN (§5.10).
//
//   pnpm gateway:deposit 5      # deposits 5 USDC
import { randomUUID } from 'node:crypto';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { GATEWAY_WALLET_ADDRESS, USDC_ADDRESS, formatUsdc, parseUsdc } from '@proofstream/config';
import { createPublicClient, encodeFunctionData, erc20Abi, http } from 'viem';
import { arcTestnet } from 'viem/chains';
import { env } from '../agent/src/env';

const GATEWAY_WALLET_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
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

const amountArg = process.argv[2] ?? '5';
const amount = parseUsdc(amountArg);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(env.arcRpcUrl) });
const circle = initiateDeveloperControlledWalletsClient({
  apiKey: env.circleApiKey,
  entitySecret: env.entitySecret,
});

const TERMINAL = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

async function send(label: string, contractAddress: `0x${string}`, callData: `0x${string}`) {
  const res = await circle.createContractExecutionTransaction({
    walletId: env.agentWalletId,
    contractAddress,
    callData,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: randomUUID(),
  });
  const id = res.data?.id;
  if (!id) throw new Error(`${label}: Circle returned no transaction id`);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const tx = (await circle.getTransaction({ id })).data?.transaction;
    if (tx?.state && TERMINAL.has(tx.state)) {
      console.log(`${label}: ${tx.state} ${tx.txHash ?? ''}`);
      if (tx.state !== 'COMPLETE') throw new Error(`${label} failed: ${tx.errorReason ?? tx.state}`);
      console.log(`  https://testnet.arcscan.app/tx/${tx.txHash}`);
      return;
    }
  }
  throw new Error(`${label}: timed out waiting for Circle`);
}

const balance = await publicClient.readContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [env.agentAddress],
});

console.log(`attestor ${env.agentAddress}`);
console.log(`  wallet USDC:      ${formatUsdc(balance)}`);
if (balance < amount) throw new Error(`insufficient USDC: need ${amountArg}, have ${formatUsdc(balance)}`);

console.log(`\ndepositing ${amountArg} USDC into Gateway (${GATEWAY_WALLET_ADDRESS})\n`);

await send(
  'approve',
  USDC_ADDRESS,
  encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [GATEWAY_WALLET_ADDRESS, amount] }),
);

await send(
  'deposit',
  GATEWAY_WALLET_ADDRESS,
  encodeFunctionData({ abi: GATEWAY_WALLET_ABI, functionName: 'deposit', args: [USDC_ADDRESS, amount] }),
);

const available = await publicClient.readContract({
  address: GATEWAY_WALLET_ADDRESS,
  abi: GATEWAY_WALLET_ABI,
  functionName: 'availableBalance',
  args: [USDC_ADDRESS, env.agentAddress],
});
console.log(`\nattestor Gateway available balance: ${formatUsdc(available)} USDC`);
