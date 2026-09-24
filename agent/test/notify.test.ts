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

const { MARKER, alreadyCommented, appJwt, commentBody, fenced } = await import('../src/notify');

const STREAM = '0x26B8379cCB664f94fCAC4837D0FcB62136a8dcE8';
const MILESTONE = 'Milestone 1: add rateOver(entries, seconds) to src/rate.ts, and zero when seconds is zero.';
/// The words, with every run of whitespace flattened. What the fence is allowed
/// to change is where the lines break; what it may never change is these.
const words = (text: string) => text.replace(/\s+/g, ' ').trim();
/// The text between the fences.
const inside = (block: string) => block.split('\n').slice(1, -1).join('\n');

test('the comment carries no amount, no percentage and no verdict', () => {
  const body = commentBody(STREAM, MILESTONE);
  // Strip the links, which legitimately contain the stream's hex, and the
  // fenced milestone, which is the employer's own words and not ours. What is
  // left is everything WE say, and nothing numeric may survive in it.
  const prose = body.replace(/https?:\/\/\S+/g, '').replace(/```[\s\S]*?```/g, '');
  assert.ok(!/USDC/i.test(prose), 'no currency');
  assert.ok(!/%/.test(prose), 'no percentage');
  assert.ok(!/\d/.test(prose), `no digits in the prose: ${prose}`);
  assert.ok(!/confidence|verdict|reasoning/i.test(prose), 'no judgment text');
});

// THE MILESTONE IS SOMEBODY ELSE'S TEXT, posted under our App's name on a
// repository we do not own. A fence is what makes that safe, so the fence has
// to survive text written to break it.
test('the milestone is fenced verbatim, and cannot escape the fence', () => {
  const nasty = 'See [our sponsor](https://evil.test) ``` and <img src=x> and # a heading';
  const block = fenced(nasty);
  const [open, ...rest] = block.split('\n');
  assert.ok(open.length > 3, 'the fence outgrows the backticks in the text');
  assert.equal(rest.at(-1), open, 'it closes with the same fence');
  assert.equal(rest.slice(0, -1).join('\n'), nasty, 'the text is untouched inside');
  assert.ok(!nasty.includes(open), 'nothing in the text can close the fence');
});

test('a long milestone is cut, and a short one is not', () => {
  const long = `Milestone: ${'work '.repeat(200)}`;
  assert.ok(fenced(long).length < long.length, 'cut');
  assert.ok(fenced(long).includes('…'), 'and says so');
  assert.equal(words(inside(fenced(MILESTONE))), words(MILESTONE), 'a real milestone keeps every word');
});

// A FENCE DOES NOT SOFT-WRAP, so one long line would give the comment a
// horizontal scrollbar. Wrapping is allowed to move the line breaks and
// nothing else.
test('the milestone is wrapped to a readable width, and only at spaces', () => {
  const oneLine = `Milestone: ${'alpha beta gamma '.repeat(12)}`.trim();
  const lines = inside(fenced(oneLine)).split('\n');
  assert.ok(lines.length > 1, 'it wrapped');
  for (const line of lines) assert.ok(line.length <= 76, `within the column: ${line.length}`);
  assert.equal(lines.join(' '), oneLine, 'the words are the same words, in the same order');
});

test('a word longer than the column is left whole rather than cut in half', () => {
  const url = `x ${'z'.repeat(120)}`;
  assert.ok(fenced(url).includes('z'.repeat(120)), 'the long token survives intact');
});

test('the comment quotes the milestone it was judged against', () => {
  const body = commentBody(STREAM, MILESTONE);
  assert.equal(words(body).includes(words(MILESTONE)), true, 'the milestone is in the comment');
  assert.ok(body.includes('```'), 'inside a fence');
});

// GITHUB RENDERS A SINGLE NEWLINE AS A HARD BREAK. Prose split across source
// lines keeps those breaks in the rendered comment and will not reflow, which
// is what made the first draft look thrown together in a narrow column.
test('no paragraph is hard-wrapped, so the comment reflows to the reader', () => {
  const outside = commentBody(STREAM, MILESTONE).replace(/```[\s\S]*?```/g, '<fence>').split('\n');
  for (let i = 1; i < outside.length; i++) {
    const pair = [outside[i - 1], outside[i]];
    assert.ok(
      pair.some((line) => line === '' || line === '<fence>' || line === MARKER),
      `two prose lines run together and GitHub will break between them: ${pair.join(' / ')}`,
    );
  }
});

test('the comment links to the earnings page and the stream, on the app URL', () => {
  const body = commentBody(STREAM, MILESTONE);
  assert.ok(body.includes('https://app.example.test/earnings'), 'earnings link');
  assert.ok(body.includes(`https://app.example.test/stream/${STREAM}`), 'stream link');
  assert.ok(!body.includes('.test//'), 'a trailing slash on the URL is not doubled');
});

test('the comment carries the marker that keeps it to one per pull request', () => {
  assert.ok(commentBody(STREAM, MILESTONE).includes(MARKER));
  assert.equal(alreadyCommented([{ body: 'lgtm' }, { body: commentBody(STREAM, MILESTONE) }]), true);
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
