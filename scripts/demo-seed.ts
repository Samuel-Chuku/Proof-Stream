// Phase 5: drive a batch of real changesets through the full agent pipeline,
// unattended, and record every on-chain transaction.
//
// Each changeset becomes a real branch + PR on the demo repo, because the
// verifier deliberately fetches its own diff from GitHub — feeding it synthetic
// in-memory diffs would break the independence that answers the collusion
// question. The PRs are never merged: the seeder drives the pipeline directly,
// so no webhook and no merge is involved.
//
// LIVE — the agents spend real testnet USDC. Run `pnpm preflight:verifier` and
// `pnpm preflight:withdraw` first, and keep `pnpm verifier:dev` up.
//
//   pnpm seed              # run the whole plan
//   pnpm seed 3            # run only the first 3 changesets
//
// The milestone this plan is written against (set it with setMilestone first,
// employer key required):
//
//   Milestone 3: harden src/ledger.ts — validate transfer inputs, replace thrown
//   strings with named error types, add structured audit logging for every
//   balance change, and cover each of those three with unit tests.
import { appendFileSync } from 'node:fs';
import { EXPLORER_URL, formatUsdc } from '@proofstream/config';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { readStream } from '../agent/src/chain';
import { env } from '../agent/src/env';
import type { MergedPr } from '../agent/src/github';
import { processPr, type PipelineOutcome } from '../agent/src/pipeline';

const SEED_LOG = new URL('../agent/seed.jsonl', import.meta.url).pathname;

const WITHDRAW_ABI = [
  { type: 'function', name: 'withdrawable', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'policy',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// What src/ledger.ts looks like on main. Each changeset ships this plus its own
// additions, so the diff the agents read is exactly the work being claimed.
const BASE = `export type Entry = { id: string; amount: number; memo?: string };

export function total(entries: Entry[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

export function isValid(e: Entry): boolean {
  return e.amount > 0 && e.id.length > 0;
}

export type Account = { id: string; balance: number };

export function balanceOf(account: Account): number {
  return account.balance;
}
`;

type Changeset = {
  /** Branch/PR title. */
  title: string;
  /** Path in the demo repo. */
  path: string;
  /** Full file contents to commit. */
  content: string;
  /** PR body — the agents read this alongside the diff. */
  body: string;
};

// Deliberately mixed quality. Some genuinely advance the milestone, some only
// look like they do. The agents are expected to disagree with a few of these —
// that variance IS the demo, so nothing here is tuned to be approved.
// Deliberately mixed quality, all aimed at the SAME on-chain milestone:
// "implement transfer() with balance and overdraft checks in src/ledger.ts".
// Some genuinely do it, some only look like they do, some do it partially.
// The agents are expected to refuse several — that variance IS the demo, so
// nothing here is tuned to be approved.
const PLAN: Changeset[] = [
  {
    title: 'feat: add canCover balance helper',
    path: 'src/ledger.ts',
    body: 'Adds a canCover() helper that reports whether an account can fund an amount. Groundwork for transfer.',
    content: `${BASE}
export function canCover(account: Account, amount: number): boolean {
  return account.balance >= amount;
}
`,
  },
  {
    title: 'feat: implement transfer()',
    path: 'src/ledger.ts',
    body: 'Implements transfer() moving value between two accounts and returning the updated pair.',
    content: `${BASE}
export function transfer(from: Account, to: Account, amount: number): [Account, Account] {
  return [
    { ...from, balance: from.balance - amount },
    { ...to, balance: to.balance + amount },
  ];
}
`,
  },
  {
    title: 'docs: describe the intended ledger API',
    path: 'docs/ledger.md',
    body: 'Documentation only. Describes transfer(), balance checks and overdraft behaviour.',
    content: `# Ledger

\`transfer(from, to, amount)\` moves value between accounts.

It must reject a transfer that would overdraw the sending account, and must
reject non-positive amounts.
`,
  },
  {
    title: 'feat: transfer() with balance and overdraft checks',
    path: 'src/ledger.ts',
    body: 'Implements transfer() with an explicit balance check that blocks overdrafts, plus positive-amount and self-transfer guards.',
    content: `${BASE}
export function canCover(account: Account, amount: number): boolean {
  return account.balance >= amount;
}

export function transfer(from: Account, to: Account, amount: number): [Account, Account] {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(\`transfer amount must be a positive number, got \${amount}\`);
  }
  if (from.id === to.id) {
    throw new Error(\`cannot transfer from \${from.id} to itself\`);
  }
  if (!canCover(from, amount)) {
    throw new Error(
      \`overdraft blocked: \${from.id} holds \${from.balance} but \${amount} was requested\`,
    );
  }
  return [
    { ...from, balance: from.balance - amount },
    { ...to, balance: to.balance + amount },
  ];
}
`,
  },
  {
    title: 'chore: formatting helper',
    path: 'src/format.ts',
    body: 'Cosmetic. Formats amounts for display.',
    content: `export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}
`,
  },
  {
    title: 'feat: transfer() with overdraft checks and unit tests',
    path: 'src/ledger.ts',
    body: 'Implements transfer() with balance and overdraft checks. Companion tests land in src/ledger.test.ts in this same PR.',
    content: `${BASE}
export function canCover(account: Account, amount: number): boolean {
  return account.balance >= amount;
}

/**
 * Move value between two accounts. Rejects non-positive amounts, self
 * transfers, and any transfer that would overdraw the sender.
 */
export function transfer(from: Account, to: Account, amount: number): [Account, Account] {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(\`transfer amount must be a positive number, got \${amount}\`);
  }
  if (from.id === to.id) {
    throw new Error(\`cannot transfer from \${from.id} to itself\`);
  }
  if (!canCover(from, amount)) {
    throw new Error(
      \`overdraft blocked: \${from.id} holds \${from.balance} but \${amount} was requested\`,
    );
  }
  return [
    { ...from, balance: from.balance - amount },
    { ...to, balance: to.balance + amount },
  ];
}
`,
  },
  {
    title: 'test: cover transfer balance and overdraft behaviour',
    path: 'src/ledger.test.ts',
    body: 'Unit tests asserting a successful transfer moves both balances and that an overdraft is blocked.',
    content: `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balanceOf, type Account } from './ledger';

const alice = (): Account => ({ id: 'alice', balance: 100 });

test('balanceOf reports the account balance', () => {
  assert.equal(balanceOf(alice()), 100);
});
`,
  },
  {
    title: 'refactor: rename helpers in ledger',
    path: 'src/ledger.ts',
    body: 'Renames internal helpers for readability. No behaviour change.',
    content: `${BASE}
export function accountBalance(account: Account): number {
  return balanceOf(account);
}
`,
  },
];

// ---------------------------------------------------------------- github API

// The repo the CONTRACT names. The employer registers it on-chain; the
// seeder must not quietly operate on something else.
let API = '';

async function gh(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'proofstream-seeder',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${json.message ?? text}`);
  return json as any;
}

/** Branch, commit, open PR. Returns what the pipeline needs. */
async function openChangeset(cs: Changeset, index: number, pass: number): Promise<MergedPr> {
  const branch = `seed/p${pass}-${index}-${cs.path.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const main = await gh('GET', '/git/ref/heads/main');

  try {
    await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: main.object.sha });
  } catch (err) {
    if (!String((err as Error).message).includes('already exists')) throw err;
  }

  // Existing path needs its blob sha; a new path must not send one.
  let sha: string | undefined;
  try {
    sha = (await gh('GET', `/contents/${cs.path}?ref=${branch}`)).sha;
  } catch {
    sha = undefined;
  }

  const commit = await gh('PUT', `/contents/${cs.path}`, {
    message: cs.title,
    content: Buffer.from(cs.content).toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });

  const pr = await gh('POST', '/pulls', {
    title: cs.title,
    head: branch,
    base: 'main',
    body: cs.body,
  });

  return {
    number: pr.number,
    title: cs.title,
    body: cs.body,
    commitSha: commit.commit.sha,
    author: 'proofstream-seeder',
  };
}

// ------------------------------------------------------------------- run it

function note(entry: Record<string, unknown>) {
  const line = { at: new Date().toISOString(), ...entry };
  appendFileSync(SEED_LOG, `${JSON.stringify(line)}\n`);
}

const limit = Number(process.argv[2] || PLAN.length);
const passes = Math.max(1, Number(process.argv[3] || 1));
const intervalMin = Number(process.argv[4] || 15);
const plan = PLAN.slice(0, Math.max(1, Math.min(limit, PLAN.length)));

const before = await readStream();
API = `https://api.github.com/repos/${before.repo}`;

console.log(`repo:      ${before.repo}  (from the contract)`);
console.log(`milestone: ${before.milestone}\n`);
console.log(`seeding ${plan.length} changesets x ${passes} pass(es), ${intervalMin}m apart`);
console.log(`policy: maxTranche ${formatUsdc(before.maxTranche)} / day ${formatUsdc(before.dailyUnlockCap)}`);
console.log(`budget: ${formatUsdc(before.budget)} USDC over ${Number(before.budget) / 1e6} accrual\n`);

const tally: Record<string, number> = {};
let payouts = 0;

/// Sweep whatever the agents released to the allowlisted payee. Each sweep is
/// its own on-chain transaction, so a pass that unlocks also pays out — which
/// is what makes the run produce two transactions per cycle rather than one.
async function sweep(): Promise<void> {
  const key = process.env.CONTRIBUTOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return;

  const account = privateKeyToAccount(key);
  const transport = http(env.arcRpcUrl);
  const pub = createPublicClient({ chain: arcTestnet, transport });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport });

  const owed = (await pub.readContract({
    address: env.workStream,
    abi: WITHDRAW_ABI,
    functionName: 'withdrawable',
  })) as bigint;
  if (owed <= 0n) return;

  const [, , payee] = (await pub.readContract({
    address: env.workStream,
    abi: WITHDRAW_ABI,
    functionName: 'policy',
  })) as [bigint, bigint, `0x${string}`];

  const hash = await wallet.writeContract({
    address: env.workStream,
    abi: WITHDRAW_ABI,
    functionName: 'withdraw',
    args: [payee, owed],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });

  payouts += 1;
  console.log(`   payout ${formatUsdc(owed)} USDC  ${hash}`);
  appendFileSync(
    new URL('../agent/payouts.jsonl', import.meta.url).pathname,
    `${JSON.stringify({
      at: new Date().toISOString(),
      workStream: env.workStream,
      event: receipt.status === 'success' ? 'withdrawn' : 'withdraw_failed',
      amountUsdc: formatUsdc(owed),
      to: payee,
      by: account.address,
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      explorer: `${EXPLORER_URL}/tx/${hash}`,
    })}\n`,
  );
}

for (let pass = 1; pass <= passes; pass++) {
  console.log(`\n════════ pass ${pass}/${passes}`);

  for (const [i, cs] of plan.entries()) {
    console.log(`\n── ${i + 1}/${plan.length}  ${cs.title}`);
    try {
      const pr = await openChangeset(cs, i + 1, pass);
      console.log(`   PR #${pr.number} opened`);

      const outcome: PipelineOutcome = await processPr(pr);
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      console.log(`   → ${outcome}`);
      note({ event: 'seeded', pass, index: i + 1, pr: pr.number, title: cs.title, outcome });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tally.error = (tally.error ?? 0) + 1;
      console.log(`   ✗ ${message}`);
      note({ event: 'seed_error', pass, index: i + 1, title: cs.title, message });
    }

    // Arc rate-limits, OpenRouter is slower under load, and back-to-back
    // unlocks in the same second confuse the daily-cap bucket.
    await new Promise((r) => setTimeout(r, 4_000));
  }

  try {
    await sweep();
  } catch (err) {
    console.log(`   payout failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (pass < passes) {
    // Unlocks are bounded by accrual, not by how many changesets we throw at
    // it — so the wait between passes IS the throughput. Nothing to gain by
    // hurrying it.
    const s = await readStream();
    console.log(
      `\n   waiting ${intervalMin}m for accrual — ${formatUsdc(s.accrued - s.milestoneUnlocked)} USDC available now`,
    );
    await new Promise((r) => setTimeout(r, intervalMin * 60_000));
  }
}

const after = await readStream();

console.log('\n──────── summary');
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(14)} ${v}`);
console.log(`  payouts        ${payouts}`);
console.log(`  nonce          ${before.nonce} → ${after.nonce}`);
console.log(`  unlocked       ${formatUsdc(before.unlocked)} → ${formatUsdc(after.unlocked)} USDC`);
console.log(`  accrued        ${formatUsdc(after.accrued)} USDC of ${formatUsdc(after.budget)} budget`);
console.log(`\n  contract ${EXPLORER_URL}/address/${env.workStream}`);
console.log('  next: pnpm evidence');
