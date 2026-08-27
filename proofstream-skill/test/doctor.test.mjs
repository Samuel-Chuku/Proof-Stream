import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/files.mjs';
import { doctor } from '../src/commands/doctor.mjs';

test('doctor detects a corrupt or incomplete package', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'proofstream-doctor-'));
  try {
    await copyFile(join(PACKAGE_ROOT, 'manifest.json'), join(temp, 'manifest.json'));
    const result = await doctor({ root: temp });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('Missing required file')));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('doctor is offline by default', async () => {
  const result = await doctor({ root: PACKAGE_ROOT });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.checked.networkRequested, false);
});
