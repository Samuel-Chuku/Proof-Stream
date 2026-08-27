import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'bin', 'proofstream-skill.mjs');

test('version and help are available without network', async () => {
  const version = await run(process.execPath, [bin, 'version', '--json']);
  const value = JSON.parse(version.stdout);
  assert.equal(value.skill, 'proofstream-integration');
  assert.equal(value.proofstreamCommit.length, 40);
  const help = await run(process.execPath, [bin, 'help']);
  assert.match(help.stdout, /doctor/);
});

test('install is clean-room safe and doctor passes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'proofstream-skill-'));
  try {
    const target = join(project, '.agents', 'skills', 'proofstream-integration');
    const installed = await run(process.execPath, [bin, 'install', '--target', target, '--json'], { cwd: project });
    assert.equal(JSON.parse(installed.stdout).installed, target);
    const doctor = await run(process.execPath, [bin, 'doctor', '--path', target, '--json'], { cwd: project });
    assert.equal(JSON.parse(doctor.stdout).ok, true);
    const skill = await readFile(join(target, 'SKILL.md'), 'utf8');
    assert.match(skill, /ProofStream/);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('repeated install refuses unrelated overwrite', async () => {
  const project = await mkdtemp(join(tmpdir(), 'proofstream-skill-'));
  try {
    const target = join(project, 'skill');
    await run(process.execPath, [bin, 'install', '--target', target], { cwd: project });
    await assert.rejects(run(process.execPath, [bin, 'install', '--target', target], { cwd: project }), (error) => error.stderr.includes('already exists'));
    await run(process.execPath, [bin, 'install', '--target', target, '--force'], { cwd: project });
  } finally { await rm(project, { recursive: true, force: true }); }
});
