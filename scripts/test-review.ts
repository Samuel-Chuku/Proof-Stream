// Exercise the verifier's judgment on a real PR without paying it — the
// counterpart to `pnpm verdict:test`, for tuning the second-opinion prompt.
// Read-only on-chain, no x402 payment, inference cost only.
//   pnpm review:test 2
import { readStream } from '../agent/src/chain';
import { fetchDiff } from '../agent/src/github';
import { review } from '../agent/src/verifier/review';

const prNumber = Number(process.argv[2]);
if (!Number.isInteger(prNumber)) {
  console.error('usage: pnpm review:test <pr-number>');
  process.exit(1);
}

const milestoneOverride = process.argv[3];
const stream = await readStream();
const milestone = milestoneOverride ?? stream.milestone;
const diff = await fetchDiff(prNumber);

console.log(`milestone: ${milestone}`);
console.log(`diff:      ${diff.length} chars\n`);

const { review: verdict, costUsd, model } = await review(prNumber, milestone, diff);

console.log(`model:             ${model}`);
console.log(`satisfies:         ${verdict.satisfies_milestone}`);
console.log(`confidence:        ${verdict.confidence}`);
console.log(`tranche_fraction:  ${verdict.tranche_fraction}`);
console.log(`reasoning:         ${verdict.reasoning}`);
if (verdict.red_flags.length) console.log(`red flags:         ${verdict.red_flags.join('; ')}`);
console.log(`inference cost:    $${costUsd.toFixed(4)}`);
