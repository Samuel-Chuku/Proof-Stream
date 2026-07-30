// Judge a real PR without unlocking anything — for tuning the prompt and
// proving the verdict varies with the work (T5). Read-only on-chain.
//   pnpm verdict:test 1
import { readStream } from '../agent/src/chain';
import { fetchDiff } from '../agent/src/github';
import { judge } from '../agent/src/verdict';

const prNumber = Number(process.argv[2]);
if (!Number.isInteger(prNumber)) {
  console.error('usage: pnpm verdict:test <pr-number>');
  process.exit(1);
}

const milestoneOverride = process.argv[3];
const stream = await readStream();
const milestone = milestoneOverride ?? stream.milestone;
const diff = await fetchDiff(stream.repo, prNumber);

console.log(`milestone: ${milestone}`);
console.log(`diff:      ${diff.length} chars\n`);

const { verdict, costUsd, model } = await judge(
  { number: prNumber, title: `PR #${prNumber}`, body: '', commitSha: 'test', author: 'test' },
  milestone,
  diff,
);

console.log(`model:             ${model}`);
console.log(`satisfies:         ${verdict.satisfies_milestone}`);
console.log(`confidence:        ${verdict.confidence}`);
console.log(`tranche_fraction:  ${verdict.tranche_fraction}`);
console.log(`reasoning:         ${verdict.reasoning}`);
if (verdict.concerns.length) console.log(`concerns:          ${verdict.concerns.join('; ')}`);
console.log(`inference cost:    $${costUsd.toFixed(4)}`);
