// KEEPING ONE GENERATED SUITE FOR THE LIFE OF A MILESTONE.
//
// The oracle writes a fresh suite on every judgment, so one run reports 9 of 12
// and the next 11 of 14 against identical code. Both are honest; they are just
// different rulers. Anything that wants to say "three more tests pass than last
// time" needs the same suite both times, or it is comparing nothing.
//
// So the suite is generated once per milestone and reused. Two rules bound what
// that costs us:
//
//   1. A suite that stops loading is dropped. That is the real case where the
//      public interface moved and the old tests no longer resolve.
//   2. A suite is retired after MAX_USES judgments. Reuse means one poor
//      generation would otherwise shape every judgment of that milestone, and
//      this is what stops that being unbounded.
//
// NEVER CACHE A SUITE WE HAVE NOT SEEN RUN. A suite is only written after it has
// produced a real result, so a generation that fails to load is never kept.
//
// EVERY FAILURE HERE IS NON-FATAL. This is an optimisation and a measurement
// aid, not a source of truth. A corrupt file, an unreadable directory or a
// half-written entry all degrade to "no cache", which regenerates. Nothing in
// here may take a judgment down.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type CachedSuite = {
  /// Identifies the ruler. Two results are only comparable when this matches,
  /// because a regenerated suite renumbers and renames everything.
  id: string;
  tests: string;
  /// How many judgments this suite has already served.
  uses: number;
  generatedAt: string;
};

/// After this many judgments the suite is retired and the next one regenerates.
///
/// The tension: every reuse makes the evidence comparable, and every reuse also
/// extends the reach of a single poor generation. Five keeps most consecutive
/// judgments of one milestone on one ruler while ensuring a bad suite cannot
/// govern a milestone indefinitely.
export const MAX_USES = 5;

/// A suite is identified by its content, so a regenerated one is always a
/// different ruler even if the milestone text never changed.
export const suiteId = (tests: string): string =>
  createHash('sha256').update(tests).digest('hex').slice(0, 12);

/// The directory is passed in rather than read from the agent's env, so this
/// module imports nothing of ours and its tests run without an .env — the same
/// reason `metering.ts` is import-free. The one caller supplies
/// `ledgerPath('suites')`.
///
/// Filenames come from a hash, not from the key. The key contains an address
/// and a 0x hash, and building paths out of caller-supplied strings is how a
/// cache key becomes a directory traversal.
function entryPath(dir: string, key: string): string {
  mkdirSync(dir, { recursive: true });
  return join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
}

/// The cached suite for this milestone, or null if there is nothing usable.
///
/// Returns null rather than throwing for every failure mode, including a
/// retired suite, so callers have exactly one branch to handle.
export function loadSuite(dir: string, key: string): CachedSuite | null {
  try {
    const raw = JSON.parse(readFileSync(entryPath(dir, key), 'utf8')) as Partial<CachedSuite>;
    if (typeof raw.tests !== 'string' || !raw.tests.trim()) return null;
    if (typeof raw.id !== 'string' || typeof raw.uses !== 'number') return null;
    if (raw.uses >= MAX_USES) return null;
    return { id: raw.id, tests: raw.tests, uses: raw.uses, generatedAt: String(raw.generatedAt ?? '') };
  } catch {
    return null;
  }
}

/// Keep a suite that has just produced a real result. Call this only after the
/// suite has run; a suite that did not load is not worth keeping.
export function saveSuite(dir: string, key: string, tests: string): void {
  try {
    const entry: CachedSuite = { id: suiteId(tests), tests, uses: 1, generatedAt: new Date().toISOString() };
    writeFileSync(entryPath(dir, key), JSON.stringify(entry, null, 2));
  } catch {
    // A cache we cannot write is a cache we do not have.
  }
}

/// Record that the cached suite served another judgment, retiring it once it
/// reaches MAX_USES.
export function noteUse(dir: string, key: string): void {
  try {
    const current = loadSuite(dir, key);
    if (!current) return;
    writeFileSync(entryPath(dir, key), JSON.stringify({ ...current, uses: current.uses + 1 }, null, 2));
  } catch {
    // Losing a use count costs at most one extra generation.
  }
}

/// Throw a suite away, for the case where it no longer loads against the code.
export function dropSuite(dir: string, key: string): void {
  try {
    rmSync(entryPath(dir, key), { force: true });
  } catch {
    // Nothing to do: the next load returns null either way.
  }
}
