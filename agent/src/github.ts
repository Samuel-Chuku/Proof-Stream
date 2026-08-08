import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseRepoSpec } from '@proofstream/config';
import { env } from './env';

/// Each stream gets its OWN webhook secret, derived rather than stored.
///
/// One endpoint cannot serve many repos under one shared secret: every employer
/// would hold a key that forges events for every other employer's stream. The
/// obvious fix is a secrets table, but deriving them means there is no table to
/// leak, no migration, and no state to keep in sync — the agent can always
/// recompute a stream's secret from the master and the address alone.
///
/// GITHUB_WEBHOOK_SECRET is therefore a MASTER secret. It must never be handed
/// to an employer; give them the output of this function for their stream.
export function webhookSecretFor(streamAddress: string): string {
  return createHmac('sha256', env.webhookSecret).update(streamAddress.toLowerCase()).digest('hex');
}

/// Verifies GitHub's HMAC over the raw body. Without this anyone who learns
/// the ingress URL could forge a merge event and trigger a payout.
export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string = env.webhookSecret,
): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type MergedPr = {
  number: number;
  title: string;
  body: string;
  commitSha: string;
  author: string;
  /** `owner/name` the event came from, checked against the stream's on-chain
   *  repo so one agent can serve many streams without crossing wires. */
  repo?: string;
  /** The branch this was merged INTO. Checked against the branch named in the
   *  stream's on-chain repo spec — a merge into anything else is not work the
   *  employer accepted. Undefined means we could not read it, which fails
   *  closed rather than open. */
  baseBranch?: string;
};

/// Extracts what we need from a `pull_request` event, or null if it is not a
/// merge we should act on (opened, closed-without-merge, etc.).
export function parseMergedPr(payload: any): MergedPr | null {
  if (payload?.action !== 'closed' || !payload?.pull_request?.merged) return null;
  const pr = payload.pull_request;
  return {
    number: pr.number,
    title: pr.title ?? '',
    body: pr.body ?? '',
    commitSha: pr.merge_commit_sha ?? pr.head?.sha ?? '',
    author: pr.user?.login ?? 'unknown',
    repo: payload?.repository?.full_name,
    baseBranch: pr.base?.ref,
  };
}

/// How much file content to attach alongside the diff. Whole files are small in
/// the repos this judges; the cap is a guard against someone pointing it at a
/// vendored bundle, not an expected limit.
const MAX_FILE_CHARS = 24_000;

/// Bounds on the whole context block, since it now reaches past the diff.
/// Generous for a repository a milestone is written against, and a hard stop
/// against someone pointing a stream at a monorepo.
const MAX_CONTEXT_FILES = 15;
const MAX_CONTEXT_CHARS = 90_000;

/// Files worth showing a code reviewer. Lockfiles, builds and vendored trees
/// are noise that would crowd out the work being judged.
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|c|h|cc|cpp|sol|sql|sh|md)$/i;
const IGNORED = /(^|\/)(node_modules|dist|build|out|vendor|\.next|coverage|__snapshots__)(\/|$)|lock(file)?\.|-lock\.(json|yaml)$/i;

const gh = (path: string, accept = 'application/vnd.github+json') =>
  fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.githubToken}`,
      Accept: accept,
      'User-Agent': 'proofstream-attestor',
    },
  });

/// The evidence the agents judge (T5a): the unified diff, plus the FULL current
/// content of every file it touched. `repo` comes from the stream's on-chain
/// `repo()`, never from this process's env — the employer decides what their
/// agent watches.
///
/// Why the whole file and not just the diff: `tranche_fraction` asks how much of
/// the MILESTONE is complete, and a milestone is delivered across several pull
/// requests. Earlier instalments are already in the base branch, so a diff of
/// the last one shows only the last slice — the agents were being asked a
/// cumulative question while shown an incremental answer. Measured on a real
/// two-part milestone: from the diff alone the verifier scored a finished
/// milestone 0.55 and said outright it could not see the earlier work; the
/// final state makes that verifiable instead of guessable.
export async function fetchDiff(spec: string, prNumber: number): Promise<string> {
  // ACCEPTS EITHER `owner/name` OR THE FULL ON-CHAIN SPEC `owner/name#branch`,
  // and normalises here rather than trusting four call sites to remember.
  //
  // Interpolating a spec straight into the path fails SILENTLY and badly: `#`
  // opens a URL fragment, so `/repos/acme/api#release/pulls/6` is sent as
  // `/repos/acme/api` — a 200 carrying repository metadata instead of a diff.
  // The verifier fetches its own copy and hit exactly this: it answered that it
  // had been given "repository metadata, not the unified diff itself", failed
  // to produce JSON, and 500'd. The attestor then correctly refused to release
  // without a second opinion. Normalising at the boundary is the only place
  // that fixes every caller at once.
  const repo = parseRepoSpec(spec).repo;
  const res = await gh(`/repos/${repo}/pulls/${prNumber}`, 'application/vnd.github.v3.diff');
  if (!res.ok) throw new Error(`GitHub diff fetch failed: ${res.status} ${await res.text()}`);
  const diff = await res.text();

  // WHICH COMMIT THE FILES ARE READ AT. `/contents/{path}` with no ref serves
  // the DEFAULT branch, and once streams could name a branch that stopped being
  // the branch the work landed on. A pull request merged into `testrun/1` was
  // judged against the files on `main`, so the agent saw a diff adding a
  // function and a final state without it, concluded the two disagreed, and
  // declined perfectly good work with full confidence. Pinning to the merge
  // commit reads the state this pull request actually produced, on whatever
  // branch it produced it.
  let ref = '';
  try {
    const meta = await gh(`/repos/${repo}/pulls/${prNumber}`);
    if (meta.ok) {
      const pr = (await meta.json()) as { merge_commit_sha?: string; head?: { sha?: string } };
      // An open pull request has no merge commit; its head is the closest thing
      // to the state it proposes.
      ref = pr.merge_commit_sha ?? pr.head?.sha ?? '';
    }
  } catch {
    // Fall through to the default branch, which is right for a merge into it.
  }
  const at = ref ? `?ref=${ref}` : '';

  // WHICH FILES, not just the ones this pull request touched.
  //
  // Context used to be the diff's own files. That makes "judged on the final
  // state" true only when the milestone's work happens to live in the files
  // this particular pull request edited. It bit on PR #8: a one-line comment on
  // `src/ledger.test.ts` meant the agent was shown the tests and NOT
  // `src/ledger.ts`, so it saw tests calling a function it could not see and
  // declined the milestone at confidence 1.0 — while the function had been
  // merged three pull requests earlier and was sitting right there.
  //
  // The milestone is cumulative, so the evidence has to be the repository, not
  // the changeset. Touched files come first so the diff's own subjects are
  // never the ones dropped by the cap.
  let context = '';
  try {
    const filesRes = await gh(`/repos/${repo}/pulls/${prNumber}/files?per_page=50`);
    if (filesRes.ok) {
      const touched = ((await filesRes.json()) as { filename: string; status: string }[])
        .filter((f) => f.status !== 'removed')
        .map((f) => f.filename);

      const rest: string[] = [];
      if (ref) {
        const treeRes = await gh(`/repos/${repo}/git/trees/${ref}?recursive=1`);
        if (treeRes.ok) {
          const tree = (await treeRes.json()) as { tree?: { path: string; type: string }[] };
          for (const node of tree.tree ?? []) {
            if (node.type !== 'blob') continue;
            if (touched.includes(node.path)) continue;
            if (IGNORED.test(node.path) || !SOURCE.test(node.path)) continue;
            rest.push(node.path);
          }
        }
      }

      const files = [...touched, ...rest.sort()]
        .slice(0, MAX_CONTEXT_FILES)
        .map((filename) => ({ filename, status: 'ok' }));

      for (const f of files) {
        if (context.length >= MAX_CONTEXT_CHARS) break;
        const raw = await gh(
          `/repos/${repo}/contents/${encodeURI(f.filename)}${at}`,
          'application/vnd.github.raw',
        );
        if (!raw.ok) continue;
        const body = await raw.text();
        context +=
          `\n----- ${f.filename} (current contents after the merge) -----\n` +
          (body.length > MAX_FILE_CHARS
            ? `${body.slice(0, MAX_FILE_CHARS)}\n[truncated at ${MAX_FILE_CHARS} characters]`
            : body);
      }
    }
  } catch {
    // Leave `context` empty and judge on the diff alone.
  }

  return context
    ? `${diff}\n\n===== THE REPOSITORY AFTER THIS MERGE =====\nThe milestone is judged on this FINAL ` +
        `STATE, not on the diff alone. These are the repository's source files as they stand now, so ` +
        `work delivered by EARLIER pull requests appears here even though it is absent from the diff ` +
        `above. A small diff on top of finished work is finished work.\n${context}`
    : diff;
}
