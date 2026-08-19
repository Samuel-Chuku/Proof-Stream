// Poll a Circle transaction until it reaches a terminal state.
//
// Deliberately import-free, like json.ts and serialize.ts, so its test runs
// without an .env. That matters here more than usual: this loop sits directly
// in front of the money path and had no test, because chain.ts validates its
// environment at import and cannot be loaded by a test at all.
//
// WHY THE FETCH IS WRAPPED. The loop used to call Circle unguarded, so one
// transient API error threw straight out of `sendCertification`. That skipped
// the on-chain confirmation entirely and produced the exact chain the
// confirmation exists to prevent: the pipeline logs `unlock_failed`,
// EVIDENCE.md loses a real transaction, and `alreadyJudged` sees the row so
// reconcile never revisits that pull request. A certification that landed stays
// invisible forever while the contributor's claim really did rise.
//
// A failed poll is not an answer about the transaction, so it is not treated as
// one. Keep polling; if the deadline passes with nothing terminal, hand back a
// timeout and let the caller ask the chain, which knew all along.

/** Circle's terminal states. Anything else means "still working". */
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

/** Prefix on the state a timeout reports, so callers can recognise one. */
export const TIMEOUT_PREFIX = 'TIMEOUT_AFTER_';

/** The fields this loop reads from a Circle transaction. */
export type TxSnapshot = {
  state?: string;
  txHash?: string;
  errorReason?: string;
};

export type PollResult = {
  /** A terminal state, or `TIMEOUT_AFTER_<last seen state>`. */
  state: string;
  txHash?: string;
  errorReason?: string;
  /** True when the deadline passed with no terminal state. The caller should
   *  confirm against the chain rather than record an outcome. */
  timedOut: boolean;
};

export type PollOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  /** Injected so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so tests can drive the clock. */
  now?: () => number;
  /** Called once per failed fetch, for logging. Must not throw. */
  onError?: (err: unknown) => void;
};

export async function pollUntilTerminal(
  fetchSnapshot: () => Promise<TxSnapshot | undefined>,
  options: PollOptions = {},
): Promise<PollResult> {
  const {
    timeoutMs = 120_000,
    intervalMs = 3_000,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    onError,
  } = options;

  const deadline = now() + timeoutMs;
  let last = 'INITIATED';

  while (now() < deadline) {
    await sleep(intervalMs);
    try {
      const tx = await fetchSnapshot();
      last = tx?.state ?? last;
      if (TERMINAL.has(last)) {
        return { state: last, txHash: tx?.txHash, errorReason: tx?.errorReason, timedOut: false };
      }
    } catch (err) {
      // Swallowed on purpose. See the note at the top: throwing here is the bug.
      onError?.(err);
    }
  }

  return { state: `${TIMEOUT_PREFIX}${last}`, timedOut: true };
}
