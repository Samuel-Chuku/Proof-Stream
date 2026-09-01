// Recovering pull requests the agent never saw.
//
// GitHub retries a webhook delivery a handful of times and then discards it
// forever. So if the agent is down when a PR merges — a deploy, a crash, a
// reboot — that work is never judged and the contributor is never paid, with
// no error anywhere. It is the difference between a demo and something you
// would trust with payroll.
//
// THIS SPENDS MONEY WITHOUT BEING ASKED, so it is bounded on four axes:
//
//   1. only PRs merged AFTER the milestone activated — earlier work was not
//      done against this milestone and must not be judged by it — see the note
//      at the check itself for what its absence releases;
//   2. only within a lookback window (RECONCILE_LOOKBACK_HOURS, default 24);
//   3. at most RECONCILE_MAX_PRS per stream per run (default 5);
//   4. only PRs with no verdict already recorded for that stream.
//
// Without (1) and (2), pointing the agent at a repository with a long merge
// history would make it judge — and potentially pay for — years of old work on
// its first startup.
import { readFileSync } from 'node:fs';
import { parseRepoSpec } from '@proofstream/config';
import { env, ledgerPath } from './env';
import type { Evidence } from './adjudicate';
import type { MergedPr } from './github';
import { knownStreams } from './registry';

const LOG_PATH = ledgerPath('verdicts.jsonl');

type Logger = (entry: Record<string, unknown>) => void;

/// PR numbers this stream already has a verdict for. Read fresh each run: the
/// pipeline appends to the same file while we work.
///
/// `judged: false` marks a row where the judgment never happened at all — the
/// LLM call threw, the ledger was read-only, the diff could not be fetched. Such
/// a row must NOT count, or the pull request can never be retried by the very
/// mechanism that exists to recover from those failures: an LLM 404 writes one
/// of these, and every restart afterwards skips the pull request as judged.
///
/// Everything else counts, including a certification that reached the chain and
/// reverted. Those bought a second opinion and produced a verdict; re-judging
/// them would pay for the same work twice.
export function alreadyJudged(streamAddress: string): Set<number> {
  const judged = new Set<number>();
  try {
    const raw = readFileSync(LOG_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { workStream?: string; pr?: number; judged?: boolean };
        if (entry.judged === false) continue;
        if (entry.pr && entry.workStream?.toLowerCase() === streamAddress.toLowerCase()) {
          judged.add(entry.pr);
        }
      } catch {
        // A truncated final line is normal while the pipeline is writing.
      }
    }
  } catch {
    // No log yet — nothing has been judged.
  }
  return judged;
}

/// What the last CONCLUSIVE correctness check said about this stream.
///
/// Read from the ledger rather than kept in memory, because the agent restarts
/// and the comparison has to survive that. Only `passes` and `fails` count: an
/// inconclusive or void run established nothing, so treating it as a baseline
/// would hold a later judgment against a measurement that never happened.
///
/// Returns null on any failure. This feeds a gate that WITHHOLDS PAY, so an
/// unreadable ledger must mean "no baseline" and let the judgment proceed.
export function lastEvidence(streamAddress: string): Evidence | null {
  try {
    let latest: Evidence | null = null;
    for (const line of readFileSync(LOG_PATH, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as {
          workStream?: string;
          correctness?: {
            outcome?: string;
            suiteId?: string;
            passed?: number;
            total?: number;
            ownTests?: { passed?: number };
          };
        };
        if (entry.workStream?.toLowerCase() !== streamAddress.toLowerCase()) continue;
        const c = entry.correctness;
        if (!c || (c.outcome !== 'passes' && c.outcome !== 'fails')) continue;
        latest = {
          suiteId: c.suiteId,
          passed: c.passed ?? 0,
          total: c.total ?? 0,
          ownPassed: c.ownTests?.passed,
        };
      } catch {
        // A truncated final line is normal while the pipeline is writing.
      }
    }
    return latest;
  } catch {
    return null;
  }
}

export type GhPull = {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  user: { login: string } | null;
  base: { ref: string } | null;
};

/// One GitHub pull request as the pipeline needs it.
///
/// Exported because a wrong answer here is SILENT: a field dropped in this
/// mapping does not throw, it quietly gives the pipeline less to work with than
/// a webhook would, and reconciliation stops being the same standard by a
/// different door.
export function toMergedPr(p: GhPull, repo: string): MergedPr {
  return {
    number: p.number,
    title: p.title ?? '',
    body: p.body ?? '',
    commitSha: p.merge_commit_sha ?? '',
    author: p.user?.login ?? 'unknown',
    repo,
    baseBranch: p.base?.ref,
  };
}

async function recentlyMerged(repo: string, branch: string, sinceMs: number): Promise<MergedPr[]> {
  // `base` narrows the listing to the branch the employer nominated. The
  // pipeline checks it again — this is only so a repo full of feature-branch
  // merges does not fill every sweep with pull requests that will be skipped.
  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=closed&base=${encodeURIComponent(branch)}` +
      `&sort=updated&direction=desc&per_page=50`,
    {
      headers: {
        Authorization: `Bearer ${env.githubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'proofstream-attestor',
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub pulls list failed: ${res.status} ${await res.text()}`);

  const pulls = (await res.json()) as GhPull[];
  return pulls
    .filter((p) => p.merged_at && Date.parse(p.merged_at) >= sinceMs)
    .map((p) => toMergedPr(p, repo));
}

/// Judge anything merged that has no verdict. `process` is injected rather than
/// imported so this module stays testable and cannot accidentally be the thing
/// that pulls the whole pipeline into a script.
export async function reconcile(
  log: Logger,
  process: (pr: MergedPr) => Promise<unknown>,
): Promise<void> {
  const lookbackHours = Number(env.reconcileLookbackHours);
  const maxPerStream = Number(env.reconcileMaxPrs);
  if (lookbackHours <= 0 || maxPerStream <= 0) {
    log({ event: 'reconcile_disabled', reason: 'lookback or max is zero' });
    return;
  }

  const cutoff = Date.now() - lookbackHours * 3600_000;

  for (const entry of knownStreams()) {
    try {
      // Bound (1), and the lookback window alone does NOT provide it.
      //
      // Without this check a freshly funded stream reconciles pull requests
      // merged before its milestone existed and certifies them at 100%,
      // releasing the entire budget for work never done against it. Nothing on
      // chain is wrong; the agent is simply judging history. Any restart inside
      // the lookback window can do it.
      //
      // A milestone that has not activated has `activatedAt == 0`, which would
      // make every past merge eligible — so an unfunded stream reconciles
      // nothing at all.
      if (entry.activatedAt === 0n) {
        log({
          event: 'reconcile_skipped',
          stream: entry.stream,
          repo: entry.repo,
          reason: 'milestone has not started — nothing has been earned against it yet',
        });
        continue;
      }

      const activatedMs = Number(entry.activatedAt) * 1000;
      const since = Math.max(cutoff, activatedMs);

      const spec = parseRepoSpec(entry.repo);
      const merged = await recentlyMerged(spec.repo, spec.branch, since);
      const judged = alreadyJudged(entry.stream);
      const missed = merged.filter((pr) => !judged.has(pr.number)).slice(0, maxPerStream);

      if (missed.length === 0) continue;

      log({
        event: 'reconcile_found',
        stream: entry.stream,
        repo: entry.repo,
        missed: missed.map((p) => p.number),
        reason: `merged since ${new Date(since).toISOString()} with no verdict — webhook likely missed`,
      });

      for (const pr of missed) {
        // Straight through the same gates a webhook would hit, including the
        // milestone-not-funded and wrong-repo checks. Reconciliation is a
        // different DOOR, never a different standard.
        await process(pr).catch((err) =>
          log({
            event: 'reconcile_failed',
            stream: entry.stream,
            pr: pr.number,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } catch (err) {
      log({
        event: 'reconcile_failed',
        stream: entry.stream,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
