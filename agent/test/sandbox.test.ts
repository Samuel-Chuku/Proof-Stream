import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UntrustedCodeLocally, runInSandbox } from '../src/sandbox';

const local = { seconds: 20 };

test('it writes the files and runs the command', async () => {
  const r = await runInSandbox(
    [{ path: 'hello.txt', contents: 'from the sandbox' }],
    'cat hello.txt',
    local,
    { trusted: true },
  );
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /from the sandbox/);
  assert.equal(r.timedOut, false);
});

test('nested paths are created, so a src/ tree survives', async () => {
  const r = await runInSandbox(
    [{ path: 'src/deep/mod.ts', contents: 'export const x = 1;' }],
    'cat src/deep/mod.ts',
    local,
    { trusted: true },
  );
  assert.match(r.stdout, /export const x = 1/);
});

test('a failing command reports its exit code rather than throwing', async () => {
  const r = await runInSandbox([], 'exit 3', local, { trusted: true });
  assert.equal(r.exitCode, 3);
});

// THE GUARD THAT MATTERS. `local` runs on this machine and is not a sandbox.
// Handing it a contributor's code would execute a stranger's script next to the
// agent's wallet, so it refuses rather than trusting a caller to remember.
test('the local driver REFUSES untrusted code', async () => {
  await assert.rejects(
    () => runInSandbox([], 'echo hi', local, { trusted: false }),
    UntrustedCodeLocally,
  );
});

test('the refusal happens before anything is written or run', async () => {
  // A guard that fires after the command has already executed is not a guard.
  await assert.rejects(
    () => runInSandbox([{ path: 'evil.sh', contents: 'echo pwned' }], 'sh evil.sh', local, { trusted: false }),
    (err: Error) => err.name === 'UntrustedCodeLocally',
  );
});

test('the working directory is thrown away after the run', async () => {
  const r = await runInSandbox([{ path: 'a.txt', contents: 'x' }], 'pwd', local, { trusted: true });
  const dir = r.stdout.trim();
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(dir), false, 'the run directory must not survive the run');
});

// --- the remote driver ---------------------------------------------------
//
// These do not call Beam. Reaching the vendor needs a key, costs money and
// makes the suite depend on someone else's uptime; none of that tells us
// anything about the controls, which is what can actually hurt us here.
//
// Control 1 is asserted against the SOURCE on purpose. "The sandbox must never
// receive our environment" is an invariant, not a behaviour, and the way it
// breaks is somebody adding `...process.env` while debugging a PATH problem and
// never taking it out. A behavioural test would not catch that; reading the
// file does.

import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/sandbox.ts', import.meta.url), 'utf8');
const remote = source.slice(source.indexOf('async function runRemotely'));

test('CONTROL 1: the remote run never inherits our environment', () => {
  // The agent process holds a Circle entity secret, a funded wallet id and a
  // GitHub token. A contributor's "test" that prints process.env would be the
  // whole robbery, and it needs no cleverness at all.
  assert.ok(!/\.\.\.process\.env/.test(remote), 'runRemotely must never spread process.env');
  assert.ok(!/env:\s*process\.env/.test(remote), 'runRemotely must never pass process.env as env');
  assert.match(remote, /env:\s*\{\s*PATH:/, 'env must be an explicit literal');
});

test('CONTROL 3: the sandbox is terminated even when the run throws', () => {
  assert.match(remote, /finally\s*\{[\s\S]*terminate\(\)/, 'terminate() must be in a finally');
});

test('CONTROL 3: our deadline fires before Beam reaps the sandbox', () => {
  // If Beam's keepWarmSeconds were the tighter of the two, a slow suite would be
  // reaped mid-run and reported as a failure rather than a timeout — blaming a
  // contributor for our own ceiling.
  assert.match(remote, /keepWarmSeconds:\s*limits\.seconds\s*\+/);
});

test('CONTROL 4: egress is cut before any contributor code can run', () => {
  // Ordering is the point. `npm install` runs postinstall scripts, so it is
  // arbitrary code execution, and it must not be the thing that gets out.
  const cut = remote.indexOf('updateNetworkPermissions');
  const write = remote.indexOf('fs.writeText');
  const run = remote.indexOf('execShell');
  assert.ok(cut > 0 && write > 0 && run > 0, 'all three steps must be present');
  assert.ok(cut < write, 'network must be blocked before files are written');
  assert.ok(cut < run, 'network must be blocked before the command runs');
});

test('a timeout is reported as a timeout, not as a test failure', () => {
  assert.match(remote, /timedOut:\s*true/);
  assert.ok(/kill\(\)/.test(remote), 'a timed-out process must be killed');
});

test('the vendor is IMPORTED only inside runRemotely', () => {
  // The seam's promise: swapping vendors is a one-function change. Prose may
  // name Beam anywhere — the doc comment above runRemotely does, deliberately.
  // What must not escape is the IMPORT and the TYPES, because those are what
  // make a caller depend on the vendor.
  const imports = [...source.matchAll(/@beamcloud/g)].map((m) => m.index ?? 0);
  assert.equal(imports.length, 1, 'the vendor should be imported exactly once');
  assert.ok(
    imports[0] > source.indexOf('async function runRemotely'),
    'the vendor import must live inside runRemotely, not at the top of the file',
  );
  assert.ok(
    !/^import .*@beamcloud/m.test(source),
    'the vendor must be imported dynamically, so nothing else pays to load it',
  );
});

test('a missing BEAM_TOKEN fails with an instruction, not a vendor error', async () => {
  // The SDK authenticates off a mutable module object and reads no env var of
  // its own, so a missing token surfaces as "Beam token is not set" on the first
  // live judgment. That is both too late and too cryptic.
  const saved = { d: process.env.SANDBOX_DRIVER, t: process.env.BEAM_TOKEN };
  process.env.SANDBOX_DRIVER = 'remote';
  delete process.env.BEAM_TOKEN;
  try {
    await assert.rejects(
      runInSandbox([], 'true', { seconds: 5 }, { trusted: false }),
      /BEAM_TOKEN is not set/,
    );
  } finally {
    saved.d === undefined ? delete process.env.SANDBOX_DRIVER : (process.env.SANDBOX_DRIVER = saved.d);
    if (saved.t !== undefined) process.env.BEAM_TOKEN = saved.t;
  }
});
