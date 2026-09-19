import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/files.mjs';

test('machine-readable metadata has required top-level shape', async () => {
  const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, 'manifest.json')));
  const compatibility = JSON.parse(await readFile(join(PACKAGE_ROOT, 'generated/compatibility.json')));
  assert.equal(manifest.name, 'proofstream-integration');
  assert.match(manifest.skillVersion, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.proofstream.commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.proofstream.commit, compatibility.proofstreamCommit);
  assert.equal(compatibility.chain.chainId, 5042002);
});
