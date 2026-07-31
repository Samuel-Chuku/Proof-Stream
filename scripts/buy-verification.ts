// Buys one second opinion from the verifier, outside the webhook flow.
//
// This is the agent-to-agent payment on its own, which makes it the thing to
// run when demoing or debugging Phase 3 without waiting for a merged PR. It
// spends real testnet USDC from the attestor's Gateway balance, so it is a
// human-run command: `pnpm preflight:verifier` must be ALL GREEN first (§5.10).
//
//   pnpm verify:once 2      # buy a review of PR #2
import { formatUsdc } from '@proofstream/config';
import { buySecondOpinion } from '../agent/src/pay';
import { env } from '../agent/src/env';

const prNumber = Number(process.argv[2]);
if (!Number.isInteger(prNumber) || prNumber <= 0) {
  console.error('usage: pnpm verify:once <prNumber> [stream address]');
  process.exit(1);
}

// The verifier is told WHICH stream to review against; it still reads that
// contract's milestone and fetches the diff itself.
const stream = (process.argv[3] as `0x${string}` | undefined) ?? env.workStream;
if (!stream) {
  console.error('pass a stream address, or set WORKSTREAM_ADDRESS');
  process.exit(1);
}

console.log(`buying a second opinion on PR #${prNumber}`);
console.log(`  buyer:  ${env.agentAddress} (attestor)`);
console.log(`  seller: ${env.verifierAddress} (verifier)`);
console.log(`  via:    ${env.verifierUrl}\n`);

const { opinion, feePaid, transfer } = await buySecondOpinion(stream, prNumber);

console.log(`paid ${formatUsdc(feePaid)} USDC — Gateway transfer ${transfer ?? '(no receipt header)'}`);
console.log('settles in a later Gateway batch, not as its own Arc transaction (T3)\n');
console.log(JSON.stringify(opinion, null, 2));
