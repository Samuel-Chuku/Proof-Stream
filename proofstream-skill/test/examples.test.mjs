import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/files.mjs';

test('examples use generated ABI and receipt language', async () => {
  const read = await readFile(join(PACKAGE_ROOT, 'examples/read-stream.ts'), 'utf8');
  const withdraw = await readFile(join(PACKAGE_ROOT, 'examples/contributor-withdraw.ts'), 'utf8');
  assert.match(read, /generated\/workstream\.abi\.json/);
  assert.match(withdraw, /waitForTransactionReceipt/);
});
