// Bring the agents' logs down from the VPS and merge them into the local ones.
// Read-only against the VPS; it only writes the three local .jsonl files.
//
//   pnpm logs:pull
//
// WHY THIS EXISTS. The agent and verifier run on the VPS, so that is where
// verdicts.jsonl, payouts.jsonl and reviews.jsonl are actually written. But
// `pnpm evidence` builds EVIDENCE.md from the LOCAL copies. Run evidence on a
// machine that has not pulled and it silently under-reports — the run that
// produced 53 on-chain transactions reported 2, because the local logs stopped
// at a contract that had since been retired. Nothing errors; the number is just
// quietly wrong, which is the worst kind of wrong for an evidence file.
//
// Always run this immediately before `pnpm evidence`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILES = ['verdicts', 'payouts', 'reviews'] as const;

// Enough to identify a row without depending on every field surviving the trip
// through JSON. Two rows agreeing on all of these are the same event.
const KEY_FIELDS = ['at', 'workStream', 'pr', 'prNumber', 'event', 'txHash'] as const;

type Row = Record<string, unknown>;

const keyOf = (r: Row) =>
  JSON.stringify(Object.fromEntries(KEY_FIELDS.filter((k) => k in r).map((k) => [k, r[k]])));

/// Existing lines are kept as the RAW TEXT they already are, never re-parsed and
/// re-written.
///
/// An earlier version round-tripped every row through JSON.parse/stringify. The
/// rows stayed semantically identical but their bytes changed — key order and
/// spacing came out differently from what the agent had written. That made the
/// committed file differ from the VPS's copy on every single line, so `git pull`
/// on the VPS reported the whole file as conflicting and any byte-level
/// comparison of "what is new" returned everything. Only genuinely new rows get
/// serialised here; everything already present is left exactly as it was.
function readLocalLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

function parseLine(line: string): Row | null {
  try {
    return JSON.parse(line) as Row;
  } catch {
    // A half-written final line is normal while the agent is running.
    return null;
  }
}

const url = process.env.AGENT_EVENTS_URL;
if (!url) throw new Error('AGENT_EVENTS_URL is not set');

// `limit` is capped at 2000 per file by the agent itself.
const res = await fetch(`${url}?limit=2000`, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) {
  // A stopped agent answers through the tunnel with an HTML error page, so the
  // body is worse than useless in the message — say the likely cause instead.
  throw new Error(
    `${url} answered ${res.status}. Is the agent running? ` +
      'On the VPS: sudo systemctl status proofstream-agent',
  );
}
const remote = (await res.json()) as Record<string, Row[] | null>;

// Back up before touching anything. These files are tracked, and a bad merge
// would otherwise be recoverable only through git.
const backupDir = new URL('../agent/.backup/', import.meta.url).pathname;
mkdirSync(backupDir, { recursive: true });

let changed = 0;
for (const name of FILES) {
  const path = new URL(`../agent/${name}.jsonl`, import.meta.url).pathname;
  const localLines = readLocalLines(path);

  if (existsSync(path)) copyFileSync(path, `${backupDir}${name}.jsonl`);

  const seen = new Set(
    localLines.map(parseLine).flatMap((r) => (r ? [keyOf(r)] : [])),
  );
  const added = (remote[name] ?? []).filter((r) => r && !seen.has(keyOf(r)));

  // Appended, not merged in timestamp order: reordering would rewrite lines that
  // are already correct, which is the same mistake as reformatting them. The
  // logs are append-only in practice, and `evidence.ts` sorts for display.
  if (added.length > 0) {
    const lines = [...localLines, ...added.map((r) => JSON.stringify(r))];
    writeFileSync(path, `${lines.join('\n')}\n`);
  }

  changed += added.length;
  console.log(
    `  ${name.padEnd(9)} ${String(localLines.length).padStart(4)} local + ${added.length} new = ${localLines.length + added.length}`,
  );
}

console.log(`\n${changed} new rows. Backups in agent/.backup/. Now run: pnpm evidence`);
