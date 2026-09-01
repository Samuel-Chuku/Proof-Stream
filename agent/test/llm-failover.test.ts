// When the provider says THIS MODEL cannot serve you, move to the next one.
//
// Until 2026-08-23 only 429 did that, so a busy model was survivable and a
// withdrawn one was fatal. A provider retired the primary's slug, both
// fallbacks had been retired too, and a live run lost an hour to it.
//
// `fetch` is stubbed, so nothing here reaches a provider. The env is fake and
// needed only because agent/src/env.ts validates at import time.
import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(process.env, {
  REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000001',
  CIRCLE_API_KEY: 'x',
  ENTITY_SECRET: 'x',
  AGENT_WALLET_ID: 'x',
  AGENT_ADDRESS: '0x0000000000000000000000000000000000000002',
  GITHUB_TOKEN: 'x',
  GITHUB_WEBHOOK_SECRET: 'x',
  LLM_API_KEY: 'x',
  LLM_BASE_URL: 'https://example.invalid/v1',
  AGENT_MODEL: 'test/model',
  VERIFIER_MODEL: 'test/other-model',
  VERIFIER_ADDRESS: '0x0000000000000000000000000000000000000003',
  AGENT_FALLBACK_MODELS: 'second-choice,third-choice',
});

const { callLlm } = await import('../src/verdict');

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

/// Records every model the caller tried, in order.
function provider(reply: (model: string, n: number) => Response) {
  const tried: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: any) => {
    const model = JSON.parse(init.body).model as string;
    tried.push(model);
    return reply(model, tried.length);
  }) as typeof fetch;
  return { tried, restore: () => { globalThis.fetch = real; } };
}

const call = (model = 'first-choice') => callLlm({ model, messages: [] }, 'key');

test('a WITHDRAWN model (404) fails over to the next', async () => {
  // The exact 2026-08-23 failure: a retired `:free` slug.
  const p = provider((m) => (m === 'first-choice' ? new Response('gone', { status: 404 }) : ok('{}')));
  try {
    await call();
    assert.deepEqual(p.tried, ['first-choice', 'second-choice']);
  } finally { p.restore(); }
});

test('a GATED model (403) fails over', async () => {
  const p = provider((m) => (m === 'first-choice' ? new Response('no', { status: 403 }) : ok('{}')));
  try {
    await call();
    assert.deepEqual(p.tried, ['first-choice', 'second-choice']);
  } finally { p.restore(); }
});

test('an unpayable model (402) fails over', async () => {
  const p = provider((m) => (m === 'first-choice' ? new Response('pay', { status: 402 }) : ok('{}')));
  try {
    await call();
    assert.equal(p.tried[1], 'second-choice');
  } finally { p.restore(); }
});

test('a provider 5xx fails over', async () => {
  const p = provider((m) => (m === 'first-choice' ? new Response('boom', { status: 503 }) : ok('{}')));
  try {
    await call();
    assert.equal(p.tried[1], 'second-choice');
  } finally { p.restore(); }
});

test('a 400 does NOT fail over — our request is wrong, every model rejects it', async () => {
  // Burning the fallback list on a malformed request helps nobody and hides
  // the real cause behind the last model's name.
  const p = provider(() => new Response('bad request', { status: 400 }));
  try {
    await assert.rejects(call(), /400/);
    assert.deepEqual(p.tried, ['first-choice']);
  } finally { p.restore(); }
});

test('it walks the whole list before giving up, and names the model it died on', async () => {
  const p = provider(() => new Response('gone', { status: 404 }));
  try {
    await assert.rejects(call(), (e: Error) => /third-choice/.test(e.message) && /404/.test(e.message));
    assert.deepEqual(p.tried, ['first-choice', 'second-choice', 'third-choice']);
  } finally { p.restore(); }
});

test('a working primary is never failed over', async () => {
  const p = provider(() => ok('{"ok":true}'));
  try {
    await call();
    assert.deepEqual(p.tried, ['first-choice']);
  } finally { p.restore(); }
});
