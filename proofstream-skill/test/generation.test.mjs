import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const run = promisify(execFile);
test('generated references are current', async () => {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await run(process.execPath, ['scripts/generate.mjs', '--check'], { cwd });
  assert.match(result.stdout, /up to date/);
});
