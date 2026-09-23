// THE COMMENT IS THE THING TO PIN: it must never carry a figure, and it must
// be posted once. The env below is fake and required only because
// agent/src/env.ts validates at import; nothing here reaches GitHub.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: mkdtempSync(join(tmpdir(), 'ps-notify-')),
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
  PUBLIC_APP_URL: 'https://app.example.test/',
});

const { MARKER, alreadyCommented, appJwt, commentBody } = await import('../src/notify');

const STREAM = '0x26B8379cCB664f94fCAC4837D0FcB62136a8dcE8';

test('the comment carries no amount, no percentage and no verdict', () => {
  const body = commentBody(STREAM);
  // Strip the two links, which legitimately contain the stream's hex, then
  // demand that nothing numeric survives: no USDC, no %, no digits at all.
  const prose = body.replace(/https?:\/\/\S+/g, '');
  assert.ok(!/USDC/i.test(prose), 'no currency');
  assert.ok(!/%/.test(prose), 'no percentage');
  assert.ok(!/\d/.test(prose), `no digits in the prose: ${prose}`);
  assert.ok(!/confidence|verdict|reasoning/i.test(prose), 'no judgment text');
});

test('the comment links to the earnings page and the stream, on the app URL', () => {
  const body = commentBody(STREAM);
  assert.ok(body.includes('https://app.example.test/earnings'), 'earnings link');
  assert.ok(body.includes(`https://app.example.test/stream/${STREAM}`), 'stream link');
  assert.ok(!body.includes('.test//'), 'a trailing slash on the URL is not doubled');
});

test('the comment carries the marker that keeps it to one per pull request', () => {
  assert.ok(commentBody(STREAM).includes(MARKER));
  assert.equal(alreadyCommented([{ body: 'lgtm' }, { body: commentBody(STREAM) }]), true);
  assert.equal(alreadyCommented([{ body: 'lgtm' }, { body: null }]), false);
});

test('the App token is a valid RS256 JWT issued by the App, a minute in the past, for under ten minutes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  const now = 1_800_000_000;
  const jwt = appJwt('12345', pem, now);
  const [h, p, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'RS256');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(payload.iss, '12345');
  assert.equal(payload.iat, now - 60);
  assert.ok(payload.exp - payload.iat <= 600, 'GitHub refuses anything longer than ten minutes');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url'), 'signature verifies');
});
