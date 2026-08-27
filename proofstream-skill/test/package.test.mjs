import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT, REQUIRED_FILES } from '../src/lib/files.mjs';
import { verifyIntegrity } from '../src/lib/integrity.mjs';

test('package payload and checksums are complete', async () => {
  for (const file of REQUIRED_FILES) await readFile(join(PACKAGE_ROOT, file));
  const result = await verifyIntegrity(PACKAGE_ROOT);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.ok(result.checked.length > 30);
});
