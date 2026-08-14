// Run tasks that share a key one at a time, in arrival order.
//
// Deliberately import-free, like json.ts, so its test runs without a .env.
//
// WHY THIS EXISTS. `judgeForStream` reads a stream's `nonce`, `certifiedBps` and
// `target`, then spends tens of seconds on inference, a PAID second opinion, an
// EIP-712 signature and a transaction. Two judgments for the same stream
// overlapping inside that window both read the same nonce and the same standing
// certification, so both believe they are raising it: both pay the verifier
// $0.005 of the agent's own money, both sign nonce N, the first `certify` lands
// and the second reverts BadNonce and logs `unlock_failed`. Nobody is paid twice,
// but the agent is out two fees and the ledger carries a failure that was really
// a duplicate.
//
// Overlapping calls are ordinary rather than exotic. The webhook handler fires
// `processPr` unawaited (index.ts), and `reconcile()` runs concurrently with live
// deliveries at startup (index.ts, unawaited on purpose).
//
// KEYED PER STREAM, NOT PER PULL REQUEST. The nonce is a property of the
// contract, not of the PR, so two different pull requests merged a minute apart
// collide in exactly the way a redelivery of one does. Keying on the PR would
// leave the ordinary case unprotected.
//
// IN-PROCESS ONLY, and that is sufficient rather than lazy: exactly one attestor
// may run at a time, because two writing the same append-only ledger produce two
// histories that cannot be merged (deploy/README.md). For a second process the
// on-chain nonce IS the lock — it reverts, which is why the failure this prevents
// was a wasted fee and never a double payout.
const queues = new Map<string, Promise<unknown>>();

/// Queue `task` behind anything already running under `key`. Returns what the
/// task returns, and rejects with what it throws, so callers cannot tell they
/// waited.
export function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const tail = queues.get(key) ?? Promise.resolve();

  // Same handler on both branches: a queue that stops when one task throws
  // would strand every judgment behind it, which is a worse failure than the
  // one this module exists to prevent.
  const run = tail.then(task, task);

  // The queue tracks completion, not success, and must never reject: an
  // unhandled rejection stored in a Map would take the process down.
  const settled = run.then(
    () => {},
    () => {},
  );
  queues.set(key, settled);

  // Only the tail clears the key, so a burst keeps its order and the map does
  // not grow with every stream the agent has ever served.
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });

  return run;
}

/// Keys with work still queued. Observability only — nothing branches on it.
export function pendingKeys(): string[] {
  return [...queues.keys()];
}
