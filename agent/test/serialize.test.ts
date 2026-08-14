import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pendingKeys, serialize } from '../src/serialize';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('tasks on one key never overlap, and keep arrival order', async () => {
  // THE FAILURE THIS PREVENTS. Two judgments for one stream both read the same
  // nonce and the same certifiedBps, both pay the verifier $0.005, both sign
  // nonce N, and the second certify reverts BadNonce. Overlap is the bug, so
  // overlap is what this asserts.
  const events: string[] = [];
  let live = 0;

  const job = (name: string, ms: number) => async () => {
    live += 1;
    assert.equal(live, 1, `${name} ran while another task held the key`);
    events.push(`${name}:start`);
    await tick(ms);
    events.push(`${name}:end`);
    live -= 1;
    return name;
  };

  // The slow one first: without a queue it would still be running when the
  // fast one starts, which is exactly the stale-read window.
  const results = await Promise.all([
    serialize('stream-a', job('first', 20)),
    serialize('stream-a', job('second', 1)),
    serialize('stream-a', job('third', 1)),
  ]);

  assert.deepEqual(results, ['first', 'second', 'third']);
  assert.deepEqual(events, [
    'first:start',
    'first:end',
    'second:start',
    'second:end',
    'third:start',
    'third:end',
  ]);
});

test('different keys run concurrently', async () => {
  // Two streams are two contracts with two nonces. Serializing across them
  // would turn a fan-out into a traffic jam for no safety gain.
  let live = 0;
  let peak = 0;

  const job = async () => {
    live += 1;
    peak = Math.max(peak, live);
    await tick(10);
    live -= 1;
  };

  await Promise.all([serialize('stream-a', job), serialize('stream-b', job)]);
  assert.equal(peak, 2);
});

test('a thrown task does not strand the work behind it', async () => {
  // A judgment can throw for reasons that have nothing to do with the next one:
  // an RPC hiccup, a GitHub 502. If a rejection broke the chain, one bad webhook
  // would silently stop every later judgment on that stream.
  const ran: string[] = [];

  const boom = serialize('stream-a', async () => {
    ran.push('boom');
    throw new Error('rpc fell over');
  });
  const after = serialize('stream-a', async () => {
    ran.push('after');
    return 'ok';
  });

  await assert.rejects(boom, /rpc fell over/);
  assert.equal(await after, 'ok');
  assert.deepEqual(ran, ['boom', 'after']);
});

test('the caller sees the task’s own result, not the queue’s', async () => {
  assert.equal(await serialize('stream-c', async () => 42), 42);
  await assert.rejects(
    serialize('stream-c', async () => {
      throw new TypeError('mine');
    }),
    TypeError,
  );
});

test('a finished key is forgotten, so the map does not grow forever', async () => {
  // One agent serves many streams over its life. A Map entry per stream ever
  // seen is a slow leak in a process meant to run for weeks.
  await serialize('stream-transient', async () => 'done');
  await tick();
  assert.equal(pendingKeys().includes('stream-transient'), false);
});

test('a key in flight is reported as pending', async () => {
  const held = serialize('stream-held', async () => {
    await tick(10);
    return 'done';
  });
  assert.equal(pendingKeys().includes('stream-held'), true);
  await held;
  await tick();
  assert.equal(pendingKeys().includes('stream-held'), false);
});
