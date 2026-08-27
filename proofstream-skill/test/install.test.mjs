import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/commands/install.mjs';
import { doctor } from '../src/commands/doctor.mjs';

test('install and doctor work in a temporary project', async () => {
  const project = await mkdtemp(join(tmpdir(), 'proofstream-install-'));
  try {
    const target = join(project, '.codex', 'skills', 'proofstream-integration');
    const result = await install({ target, base: project });
    assert.equal(result.installed, target);
    const checked = await doctor({ root: target });
    assert.equal(checked.ok, true, checked.errors.join('\n'));
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('install target traversal is rejected', async () => {
  const project = await mkdtemp(join(tmpdir(), 'proofstream-install-'));
  try { await assert.rejects(install({ target: join(project, '..', 'outside'), base: project }), /must stay inside/); }
  finally { await rm(project, { recursive: true, force: true }); }
});
