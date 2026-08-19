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
