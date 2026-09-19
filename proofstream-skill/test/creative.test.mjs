import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCreativeBrief } from '../src/commands/creative-check.mjs';

const example = JSON.parse(await readFile(new URL('../templates/media/creative-brief.example.json', import.meta.url), 'utf8'));

test('creative example passes brand and production checks', () => {
  const result = validateCreativeBrief(example);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('creative check rejects prohibited guarantees', () => {
  const brief = structuredClone(example);
  brief.copy.headline = 'Guaranteed payout for every task';
  const result = validateCreativeBrief(brief);
  assert.equal(result.ok, false);
  assert.match(result.errors.map((entry) => entry.message).join(' '), /prohibited/i);
});

test('official mark requires confirmed rights', () => {
  const brief = structuredClone(example);
  brief.visual.markUse = 'official';
  brief.compliance.assetRights = 'pending';
  const result = validateCreativeBrief(brief);
  assert.equal(result.ok, false);
  assert.match(result.errors.map((entry) => entry.message).join(' '), /redistribution rights/i);
});

test('motion requires captions and transcript', () => {
  const brief = structuredClone(example);
  brief.medium = 'video';
  brief.format = { width: 1920, height: 1080, unit: 'px', orientation: 'landscape', fps: 30, durationSeconds: 15 };
  brief.compliance.accessibility.captions = false;
  brief.compliance.accessibility.transcript = false;
  const result = validateCreativeBrief(brief);
  assert.equal(result.ok, false);
  assert.match(result.errors.map((entry) => entry.message).join(' '), /captions and a transcript/i);
});

test('creative check reads a JSON brief from disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'proofstream-creative-'));
  const path = join(root, 'brief.json');
  await writeFile(path, JSON.stringify(example));
  const { creativeCheck } = await import('../src/commands/creative-check.mjs');
  const result = await creativeCheck(path, { json: true });
  assert.equal(result.ok, true);
  assert.equal(result.json, true);
});
