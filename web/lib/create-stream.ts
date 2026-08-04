// Creating a stream is four transactions, all signed by the employer's own
// wallet. They are described here as plain data so the UI only has to send them
// in order and report progress — no business logic lives in a component.
//
// WHY THE BROWSER DEPLOYS THE CONTRACT ITSELF: WorkStream sets
// `employer = msg.sender` in its constructor, and that field is immutable. Mint
// it from a factory and the factory becomes the employer — which would mean
// openMilestone, fund, pause and closeMilestone are all unreachable, and worse,
// closeMilestone would refund the unspent budget INTO the factory, permanently.
// Deploying from the user's wallet is what makes the stream genuinely theirs.
import { encodeFunctionData, parseUnits } from 'viem';
import { STREAM_REGISTRY_ABI, WORK_STREAM_ABI, WORK_STREAM_BYTECODE } from './artifacts';
import { ERC20_ABI, REGISTRY_ADDRESS, USDC } from './chain';

export type StreamTerms = {
  /** Who gets paid. */
  contributor: `0x${string}`;
  /** The attestor this stream appoints. */
  agent: `0x${string}`;
  /** What the agent judges work against. */
  milestone: string;
  /** Human USDC, e.g. "40". */
  budget: string;
  /** Seconds the budget accrues over once fully funded. */
  durationSeconds: number;
  /** owner/name — registered on-chain, and what routes webhooks to this stream. */
  repo: string;
  /** Per-unlock ceiling, human USDC. */
  maxTranche: string;
  /** Per-UTC-day ceiling, human USDC. */
  dailyUnlockCap: string;
  /** The only address withdraw() may pay. */
  payee: `0x${string}`;
};

export const usdc = (human: string) => parseUnits(human, 6);

/// Sensible caps derived from the budget.
///
/// Typing these by hand produced a 30 USDC budget with a 5 USDC daily cap,
/// which throttles the whole milestone to six days without saying so. Defaults
/// that scale with the budget avoid quietly configuring a stream that cannot
/// finish.
export function suggestedCaps(budget: string) {
  const amount = Number(budget) || 0;
  return {
    // The WHOLE budget. This was a quarter, on the assumption that a milestone
    // would be merged about four times — and a well-scoped milestone is
    // satisfied ONCE, so a contributor who finished the job could be certified
    // for a quarter of it and the rest refunded to the employer on close.
    //
    // Nothing is lost by raising it. The cap now bounds how much entitlement a
    // single attestation may CREATE, and money still only leaves at the speed
    // the stream accrues, so the clock is a second rate limit no key can
    // bypass. What actually bounds a compromised agent is dailyUnlockCap and
    // the fact that the employer funds one milestone at a time.
    maxTranche: amount > 0 ? amount.toFixed(2) : '',
    // The whole budget in a day — a cap that stops a runaway key without
    // stopping the job.
    dailyUnlockCap: amount > 0 ? amount.toFixed(2) : '',
  };
}

/// Fails the same checks the contract does, but in the form, where the user can
/// still fix them — a reverted deploy costs gas and explains nothing.
export function validate(terms: StreamTerms): string[] {
  const problems: string[] = [];
  const zero = '0x0000000000000000000000000000000000000000';

  if (!terms.milestone.trim()) problems.push('The milestone cannot be empty — it is what the agent judges against.');
  if (!/^[^/\s]+\/[^/\s]+$/.test(terms.repo)) problems.push('The repository must be owner/name.');
  for (const [label, value] of [
    ['contributor', terms.contributor],
    ['agent', terms.agent],
    ['payee', terms.payee],
  ] as const) {
    if (!value || value === zero) problems.push(`The ${label} address is required.`);
  }

  const budget = usdc(terms.budget || '0');
  const maxTranche = usdc(terms.maxTranche || '0');
  const dailyCap = usdc(terms.dailyUnlockCap || '0');

  if (budget <= 0n) problems.push('The budget must be greater than zero.');
  if (terms.durationSeconds <= 0) problems.push('The duration must be greater than zero.');
  if (maxTranche <= 0n) problems.push('The per-unlock cap must be greater than zero.');
  if (maxTranche > budget) problems.push('The per-unlock cap cannot exceed the budget.');
  if (dailyCap < maxTranche) problems.push('The daily cap cannot be below the per-unlock cap.');
  // Not a contract rule, but a stream whose daily ceiling is under its budget
  // cannot finish in a day, and nothing in the UI would otherwise say so.
  if (dailyCap > 0n && dailyCap < budget) {
    problems.push(
      `A daily cap of ${terms.dailyUnlockCap} USDC below the ${terms.budget} USDC budget means this milestone needs more than one day to pay out in full.`,
    );
  }

  return problems;
}

/// 1 of 4 — deploy the stream from the employer's wallet.
export function deployStream(terms: StreamTerms) {
  return {
    abi: WORK_STREAM_ABI,
    bytecode: WORK_STREAM_BYTECODE,
    args: [
      USDC,
      terms.contributor,
      terms.agent,
      terms.milestone,
      usdc(terms.budget),
      BigInt(terms.durationSeconds),
      terms.repo,
      {
        maxTranche: usdc(terms.maxTranche),
        dailyUnlockCap: usdc(terms.dailyUnlockCap),
        payee: terms.payee,
      },
    ],
  } as const;
}

/// 2 of 4 — announce it, so the agent can discover it. Only the stream's own
/// employer may do this, which is what keeps the registry free of junk.
export function registerStream(stream: `0x${string}`) {
  return {
    address: REGISTRY_ADDRESS,
    abi: STREAM_REGISTRY_ABI,
    functionName: 'register',
    args: [stream],
  } as const;
}

/// 3 of 4 — approve the stream to pull the budget.
export function approveBudget(stream: `0x${string}`, budget: string) {
  return {
    address: USDC,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [stream, usdc(budget)],
  } as const;
}

/// 4 of 4 — deposit it. THIS is what starts the clock: a milestone accrues
/// nothing until its budget is in full, which is the anti-rug gate a
/// contributor checks before starting work.
export function fundStream(stream: `0x${string}`, budget: string) {
  return {
    address: stream,
    abi: WORK_STREAM_ABI,
    functionName: 'fund',
    args: [usdc(budget)],
  } as const;
}

/// The four steps in order, for a progress checklist. Deploy and register are
/// separate transactions, and a user who stops between them owns a stream the
/// agent will never hear about — so the UI must drive both.
export const STEPS = [
  { key: 'deploy', label: 'Deploy your stream', detail: 'You own it — it is created from your wallet.' },
  { key: 'register', label: 'Announce it to the agent', detail: 'Without this the agent never sees your repository.' },
  { key: 'approve', label: 'Approve the budget', detail: 'Lets the stream pull the USDC you are committing.' },
  { key: 'fund', label: 'Fund the milestone', detail: 'Deposits it in full. Nothing accrues until this lands.' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];

/// Encoded calldata for `fund`, handy for wallets that preview raw data.
export const fundCalldata = (budget: string) =>
  encodeFunctionData({ abi: WORK_STREAM_ABI, functionName: 'fund', args: [usdc(budget)] });
