import test from 'node:test';
import assert from 'node:assert/strict';
import { docs } from '../src/commands/docs.mjs';

test('documentation topics are discoverable', async () => {
  const result = await docs();
  assert.ok(result.topics.includes('certification'));
  assert.ok(result.topics.includes('security'));
  const path = await docs('react', { path: true });
  assert.match(path, /ui-ux\.md$/);
});
