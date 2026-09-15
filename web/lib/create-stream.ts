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
import { formatRepoSpec, STREAM_REGISTRY_ABI, WORK_STREAM_ABI } from '@proofstream/config';
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';
import { WORK_STREAM_BYTECODE } from './bytecode';
import { REGISTRY_ADDRESS, USDC } from './chain';

export type StreamTerms = {
  /** Who gets paid. Zero for a stream shared as a claim link, where the
   *  employer knows an email but not a wallet, and the recipient binds their
   *  own address by claiming. */
  contributor: `0x${string}`;
  /** The address of the one-time key that authorises a claim, or absent for a
   *  stream whose contributor is named at deploy. The PRIVATE key goes in the
   *  link and is never stored. */
  claimAuthority?: `0x${string}`;
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
  /** The branch work must be merged INTO to count. Stored on-chain as part of
   *  the repo string (`owner/name#branch`), so the employer controls it exactly
   *  as they control the repository, and the agent cannot choose its own. */
  branch: string;
  /** GitHub logins whose merges count for this stream. Empty means any author,
   *  which is how every stream behaved before this existed. An allowlist rather
   *  than one login, because a person routinely has a personal and a work
   *  account. */
  authors?: string[];
  /** Per-unlock ceiling, human USDC. */
  maxTranche: string;
  /** Per-UTC-day ceiling, human USDC. */
  dailyUnlockCap: string;
  /** The only address withdraw() may pay. Zero for a claimable stream: the
   *  claimant becomes the payee. */
  payee: `0x${string}`;
};

export const usdc = (human: string) => parseUnits(human, 6);

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

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
  const zero = ZERO_ADDRESS;

  if (!terms.milestone.trim()) problems.push('The milestone cannot be empty — it is what the agent judges against.');
  if (!/^[^/\s#]+\/[^/\s#]+$/.test(terms.repo)) problems.push('The repository must be owner/name.');
  // A branch may contain slashes but nothing that would change what the on-chain
  // spec parses back to — a `#` here would split the string somewhere else.
  if (!terms.branch.trim()) problems.push('A branch is required — the agent only pays for work merged into it.');
  else if (!/^[\w.-]+(\/[\w.-]+)*$/.test(terms.branch.trim())) problems.push('That is not a valid branch name.');
  if (!terms.agent || terms.agent === zero) problems.push('The agent address is required.');

  // EXACTLY ONE OF NAMED OR CLAIMABLE, which is what the contract enforces.
  // A named stream knows its contributor and payee now; a claimable one binds
  // both when someone opens the link. Both would leave two answers to "who gets
  // paid", and neither would leave a funded stream nobody can withdraw from.
  const named = Boolean(terms.contributor) && terms.contributor !== zero;
  const claimable = Boolean(terms.claimAuthority) && terms.claimAuthority !== zero;
  if (named && claimable) {
    problems.push('A stream cannot both name a contributor and be shared as a claim link. Choose one.');
  } else if (!named && !claimable) {
    problems.push('Name a contributor, or create a claim link for them to open.');
  } else if (named && (!terms.payee || terms.payee === zero)) {
    problems.push('The payee address is required when a contributor is named.');
  }

  const budget = usdc(terms.budget || '0');
  const maxTranche = usdc(terms.maxTranche || '0');
  const dailyCap = usdc(terms.dailyUnlockCap || '0');

  if (budget <= 0n) problems.push('The budget must be greater than zero.');
  if (terms.durationSeconds <= 0) problems.push('The duration must be greater than zero.');
  if (maxTranche <= 0n) problems.push('The per-unlock cap must be greater than zero.');

  // THE CAPS MAY THROTTLE THE RATE, NEVER MAKE THE TOTAL UNREACHABLE.
  //
  // These mirror the contract's constructor exactly. They used to say the
  // opposite: a cap ABOVE the budget was the error and a cap below it was a
  // mere advisory, which is how a 100 USDC budget with a 30 USDC cap got
  // deployed and sent 67 USDC back to the employer instead of the contributor.
  if (budget > 0n && maxTranche < budget) {
    problems.push(
      'The per-unlock cap cannot be below the budget, or the agent could never certify the ' +
        'milestone in full and the remainder would return to you instead of the contributor.',
    );
  }
  // The daily cap is a RATE, so what matters is whether it can cover the budget
  // across this milestone's own duration. Days round UP, matching the contract,
  // so a milestone shorter than a day still gets a full day's allowance.
  // Mirrors MAX_AUTHORS on the contract. Bounded because the AGENT reads this
  // list on every judgment, so an unbounded one makes a stream expensive to
  // serve.
  const authors = (terms.authors ?? []).map((a) => a.trim()).filter(Boolean);
  if (authors.length > 16) problems.push('At most 16 GitHub accounts can be named.');
  if (authors.some((a) => !/^[A-Za-z0-9-]{1,39}$/.test(a))) {
    problems.push('Each GitHub account must be a username, not a URL or an email.');
  }

  const days = BigInt(Math.max(1, Math.ceil(terms.durationSeconds / 86_400)));
  if (budget > 0n && terms.durationSeconds > 0 && dailyCap * days < budget) {
    problems.push(
      `A daily cap of ${terms.dailyUnlockCap} USDC cannot reach the budget over ${days} day(s). ` +
        'Raise the cap or lengthen the milestone.',
    );
  }
  return problems;
}

/// Worth saying, but not worth refusing. Kept apart from `validate` because a
/// list that mixes "deploy is impossible" with "this is unusual but fine" makes
/// neither legible, and the reader cannot tell which one is stopping them.
///
/// The daily-cap note used to sit in `validate` and therefore BLOCKED the
/// deploy. That was wrong twice over: a daily ceiling under the budget is a
/// legitimate configuration, and it is precisely how the policy-revert demo is
/// set up — the form was refusing to build the thing the project exists to show.
export function advisories(terms: StreamTerms): string[] {
  const notes: string[] = [];
  const budget = usdc(terms.budget || '0');
  const dailyCap = usdc(terms.dailyUnlockCap || '0');
  const maxTranche = usdc(terms.maxTranche || '0');

  // NOTE: the per-certification cap warning that used to live here is now an
  // ERROR in `validate`. The contract refuses to deploy a stream whose caps
  // could make the budget unreachable, so warning about it would be reporting
  // the same thing twice, in two lists that mean different things.

  // Still worth saying, and still not worth refusing. A daily ceiling under the
  // budget is legitimate and is exactly how the policy-revert demo is set up.
  // `validate` only refuses one that cannot reach the budget across the whole
  // duration; this covers the rest.
  if (dailyCap > 0n && budget > 0n && dailyCap < budget) {
    notes.push(
      `The daily cap of ${terms.dailyUnlockCap} USDC is below the ${terms.budget} USDC budget, so this milestone needs more than one day to pay out in full. That is allowed, and it is what makes the agent hit its ceiling.`,
    );
  }

  return notes;
}

/// 1 of 4 — deploy the stream from the employer's wallet.
export function deployStream(terms: StreamTerms) {
  return {
    abi: WORK_STREAM_ABI,
    bytecode: WORK_STREAM_BYTECODE,
    args: [
      USDC,
      // Exactly one of these is set. A named stream carries a contributor and a
      // zero claim authority; a claimable one carries the reverse and binds both
      // the contributor and the payee when someone opens the link.
      terms.contributor || ZERO_ADDRESS,
      terms.claimAuthority || ZERO_ADDRESS,
      terms.agent,
      terms.milestone,
      usdc(terms.budget),
      BigInt(terms.durationSeconds),
      formatRepoSpec(terms.repo, terms.branch),
      (terms.authors ?? []).map((a) => a.trim()).filter(Boolean),
      {
        maxTranche: usdc(terms.maxTranche),
        dailyUnlockCap: usdc(terms.dailyUnlockCap),
        payee: terms.payee || ZERO_ADDRESS,
        // Public-mode payout caps. Zero on a named or claimable stream, and the
        // constructor REFUSES non-zero here on those, so this is not a default
        // to tune: it is the field the public-mode form will fill in later.
        claimCap: 0n,
        dailyClaimCap: 0n,
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
    abi: erc20Abi,
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
