// The attestor's buyer side: it pays the verifier per call over x402 using
// Circle Gateway nanopayments.
//
// The published quickstart hands GatewayClient a raw private key. We cannot —
// the attestor's key lives in Circle's custody and never reaches this process.
// BatchEvmScheme takes a `{ address, signTypedData }` signer instead, so we
// hand it a Circle-backed one and the agent pays from the same wallet it signs
// attestations and sends unlocks from. No plaintext key, one agent identity.
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { registerBatchScheme } from '@circle-fin/x402-batching/client';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { env } from './env';

const circle = initiateDeveloperControlledWalletsClient({
  apiKey: env.circleApiKey,
  entitySecret: env.entitySecret,
});

// Circle wants the whole EIP-712 payload as a JSON string and, unlike viem,
// needs EIP712Domain declared explicitly. bigints are stringified because the
// scheme builds authorization values as bigint and JSON cannot carry them.
const circleSigner = {
  address: env.agentAddress,
  signTypedData: async (params: {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`> => {
    const data = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...params.types,
      },
      primaryType: params.primaryType,
      domain: params.domain,
      message: params.message,
    };

    const res = await circle.signTypedData({
      walletId: env.agentWalletId,
      data: JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    });
    const signature = res.data?.signature;
    if (!signature) throw new Error('Circle returned no signature for the x402 authorization');
    return signature as `0x${string}`;
  },
};

const client = new x402Client();
registerBatchScheme(client, { signer: circleSigner });
const http = new x402HTTPClient(client);

export type SecondOpinion = {
  satisfies_milestone: boolean;
  confidence: number;
  tranche_fraction: number;
  reasoning: string;
  red_flags: string[];
  model: string;
};

/// Negotiates the 402 and signs the authorization, then stops. Nothing is
/// spent — settlement only happens when the signed request is actually sent —
/// so the preflight can prove the whole buyer path works before any money
/// exists to move.
export async function signPaymentAuthorization(streamAddress: `0x${string}`, prNumber = 1) {
  const unpaid = await fetch(env.verifierUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: streamAddress, prNumber }),
  });
  if (unpaid.status !== 402) throw new Error(`expected 402 from the verifier, got HTTP ${unpaid.status}`);

  const paymentRequired = http.getPaymentRequiredResponse((name) => unpaid.headers.get(name));
  const payload = await http.createPaymentPayload(paymentRequired);
  return { paymentRequired, payload };
}

export type PurchaseResult = {
  opinion: SecondOpinion;
  /** Raw 6-dp USDC actually authorised for this call. */
  feePaid: bigint;
  /** Gateway transfer id — the receipt. Settles in a later batch (T3). */
  transfer?: string;
};

/// Buys one independent review. Throws if the verifier cannot be paid or does
/// not answer: the attestor fails closed rather than unlocking unreviewed.
/// The stream address is a POINTER, not evidence. The verifier reads that
/// contract's own milestone and fetches its own diff — it is told WHERE to look,
/// never WHAT it will find. That is what keeps the second opinion independent
/// of the agent paying for it.
export async function buySecondOpinion(
  streamAddress: `0x${string}`,
  prNumber: number,
): Promise<PurchaseResult> {
  const body = JSON.stringify({ stream: streamAddress, prNumber });
  const headers = { 'content-type': 'application/json' };

  const unpaid = await fetch(env.verifierUrl, { method: 'POST', headers, body });

  if (unpaid.status !== 402) {
    throw new Error(
      `verifier did not ask to be paid (HTTP ${unpaid.status}) — refusing to trust a free opinion`,
    );
  }

  // Sign the EIP-3009 authorization against the GatewayWallet. Zero gas: this
  // never touches the chain, Gateway settles it in a batch later.
  const paymentRequired = http.getPaymentRequiredResponse((name) => unpaid.headers.get(name));
  const payload = await http.createPaymentPayload(paymentRequired);
  const paymentHeaders = http.encodePaymentSignatureHeader(payload);

  const paid = await fetch(env.verifierUrl, {
    method: 'POST',
    headers: { ...headers, ...paymentHeaders },
    body,
  });

  const result = await http.processResponse(paid);

  if (paid.status !== 200) {
    throw new Error(`verifier returned HTTP ${paid.status}: ${JSON.stringify(result.body).slice(0, 300)}`);
  }

  const settle = result.paymentStatus === 'settled' ? (result.header as { transaction?: string }) : undefined;
  const authorization = (payload as { payload?: { authorization?: { value?: string | bigint } } }).payload
    ?.authorization;

  return {
    opinion: result.body as SecondOpinion,
    feePaid: BigInt(authorization?.value ?? 0),
    transfer: settle?.transaction,
  };
}
