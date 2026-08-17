import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pollUntilTerminal, TIMEOUT_PREFIX, type TxSnapshot } from '../src/poll';

/// A controllable clock, so a 120s timeout costs no wall time. `sleep` advances
/// it rather than waiting, which is also what keeps these tests deterministic.
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

/// Answers from a scripted list; a string is a state, an Error is thrown.
function scripted(steps: (string | Error)[]) {
  let i = 0;
  return async (): Promise<TxSnapshot | undefined> => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return { state: step, txHash: step === 'COMPLETE' ? '0xabc' : undefined };
  };
}

test('a terminal state is returned with its hash', async () => {
  const { now, sleep } = clock();
  const result = await pollUntilTerminal(scripted(['SENT', 'COMPLETE']), { now, sleep });

  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.txHash, '0xabc');
  assert.equal(result.timedOut, false);
});

test('a transient error does not end the poll', async () => {
  // THE BUG THIS FIXES. The loop called Circle unguarded, so one API hiccup
  // threw out of sendCertification, skipped the on-chain confirmation, and got
  // recorded as unlock_failed — after which alreadyJudged stops reconcile ever
  // revisiting the pull request, so a certification that landed is invisible.
  const { now, sleep } = clock();
  const seen: unknown[] = [];

  const result = await pollUntilTerminal(
    scripted([new Error('ECONNRESET'), new Error('503 Service Unavailable'), 'COMPLETE']),
    { now, sleep, onError: (e) => seen.push(e) },
  );

  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.timedOut, false);
  assert.equal(seen.length, 2);
});

test('an error every single time still times out rather than throwing', async () => {
  // The caller must always get a result, because a timeout is what routes it to
  // the on-chain confirmation. A throw routes it to unlock_failed instead.
  const { now, sleep } = clock();

  const result = await pollUntilTerminal(scripted([new Error('Circle is down')]), {
    now,
    sleep,
    timeoutMs: 30_000,
  });

  assert.equal(result.timedOut, true);
  assert.ok(result.state.startsWith(TIMEOUT_PREFIX));
});

test('the timeout names the last state actually seen', async () => {
  // "TIMEOUT_AFTER_SENT" and "TIMEOUT_AFTER_INITIATED" are different
  // operational situations, and the log is the only place that distinction
  // survives.
  const { now, sleep } = clock();

  const result = await pollUntilTerminal(scripted(['SENT']), { now, sleep, timeoutMs: 30_000 });
  assert.equal(result.state, `${TIMEOUT_PREFIX}SENT`);

  const never = await pollUntilTerminal(scripted([new Error('down')]), {
    now,
    sleep,
    timeoutMs: 30_000,
  });
  assert.equal(never.state, `${TIMEOUT_PREFIX}INITIATED`);
});

test('a state seen before an error is not forgotten', async () => {
  const { now, sleep } = clock();
  const result = await pollUntilTerminal(scripted(['SENT', new Error('blip')]), {
    now,
    sleep,
    timeoutMs: 30_000,
  });
  assert.equal(result.state, `${TIMEOUT_PREFIX}SENT`);
});

test('a failure state is terminal and carries its reason', async () => {
  // A policy revert arrives here as FAILED. That is a real answer, not a
  // problem to retry, and it must not be turned into a timeout.
  const { now, sleep } = clock();
  const result = await pollUntilTerminal(
    async () => ({ state: 'FAILED', errorReason: 'execution reverted: OverMaxTranche' }),
    { now, sleep },
  );

  assert.equal(result.state, 'FAILED');
  assert.equal(result.timedOut, false);
  assert.match(result.errorReason ?? '', /OverMaxTranche/);
});

test('a snapshot with no state at all is not mistaken for terminal', async () => {
  const { now, sleep } = clock();
  const result = await pollUntilTerminal(async () => undefined, {
    now,
    sleep,
    timeoutMs: 30_000,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.state, `${TIMEOUT_PREFIX}INITIATED`);
});
