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
//      done against this milestone and must not be judged by it. THIS WAS
//      DOCUMENTED BUT NOT IMPLEMENTED until 2026-08-05, and it cost a full
//      budget; see the note at the check itself;
//   2. only within a lookback window (RECONCILE_LOOKBACK_HOURS, default 24);
//   3. at most RECONCILE_MAX_PRS per stream per run (default 5);
//   4. only PRs with no verdict already recorded for that stream.
//
// Without (1) and (2), pointing the agent at a repository with a long merge
// history would make it judge — and potentially pay for — years of old work on
// its first startup.
import { readFileSync } from 'node:fs';
import { env } from './env';
import type { MergedPr } from './github';
import { knownStreams } from './registry';

const LOG_PATH = new URL('../verdicts.jsonl', import.meta.url);

type Logger = (entry: Record<string, unknown>) => void;

/// PR numbers this stream already has a verdict for. Read fresh each run: the
/// pipeline appends to the same file while we work.
function alreadyJudged(streamAddress: string): Set<number> {
  const judged = new Set<number>();
  try {
    const raw = readFileSync(LOG_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { workStream?: string; pr?: number };
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

type GhPull = {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  user: { login: string } | null;
};

async function recentlyMerged(repo: string, sinceMs: number): Promise<MergedPr[]> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
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
    .map((p) => ({
      number: p.number,
      title: p.title ?? '',
      body: p.body ?? '',
      commitSha: p.merge_commit_sha ?? '',
      author: p.user?.login ?? 'unknown',
      repo,
    }));
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
      // Bound (1), and it was MISSING until 2026-08-05 — documented above but
      // never implemented, because the only filter was the lookback window.
      //
      // What that cost: a stream funded at 19:51 reconciled a pull request
      // merged at 12:19 the SAME DAY — seven and a half hours before its
      // milestone existed — and certified it at 100%, releasing the entire
      // budget for work that was never done against it. Nothing on chain was
      // wrong; the agent simply judged history. Any agent restart within the
      // lookback window could do this to a freshly funded stream.
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

      const merged = await recentlyMerged(entry.repo, since);
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
