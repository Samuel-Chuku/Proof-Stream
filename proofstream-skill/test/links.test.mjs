import test from 'node:test';
import assert from 'node:assert/strict';
import { findInternalLinks } from '../src/lib/integrity.mjs';
import { PACKAGE_ROOT } from '../src/lib/files.mjs';

test('internal documentation links resolve', async () => {
  const missing = await findInternalLinks(PACKAGE_ROOT);
  assert.deepEqual(missing, []);
});
