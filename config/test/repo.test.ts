import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BRANCH, formatRepoSpec, matchesRepoSpec, parseRepoSpec } from '../src/repo';

test('a spec with no branch means the default', () => {
  assert.deepEqual(parseRepoSpec('acme/api'), { repo: 'acme/api', branch: DEFAULT_BRANCH });
});

test('a spec with a branch splits on the hash', () => {
  assert.deepEqual(parseRepoSpec('acme/api#release'), { repo: 'acme/api', branch: 'release' });
});

test('a branch may contain slashes, as GitHub allows', () => {
  assert.deepEqual(parseRepoSpec('acme/api#proofstream/accepted'), {
    repo: 'acme/api',
    branch: 'proofstream/accepted',
  });
});

test('a trailing hash falls back to the default rather than matching anything', () => {
  assert.equal(parseRepoSpec('acme/api#').branch, DEFAULT_BRANCH);
  assert.equal(parseRepoSpec('acme/api#   ').branch, DEFAULT_BRANCH);
});

test('formatting round-trips', () => {
  assert.equal(formatRepoSpec('acme/api', 'release'), 'acme/api#release');
  assert.deepEqual(parseRepoSpec(formatRepoSpec('acme/api', 'release')), {
    repo: 'acme/api',
    branch: 'release',
  });
});

test('the default branch is written bare, so old streams keep their exact spec', () => {
  assert.equal(formatRepoSpec('acme/api', 'main'), 'acme/api');
  assert.equal(formatRepoSpec('acme/api', ''), 'acme/api');
});

test('a merge into the named branch matches', () => {
  assert.equal(matchesRepoSpec('acme/api#release', 'acme/api', 'release'), true);
});

test('a merge into any other branch does not', () => {
  // THE HOLE THIS CLOSES: a contributor merging their own pull request into a
  // branch nobody protects, and being paid for work the employer never saw.
  assert.equal(matchesRepoSpec('acme/api#release', 'acme/api', 'scratch'), false);
  assert.equal(matchesRepoSpec('acme/api', 'acme/api', 'scratch'), false);
});

test('a stream with no branch in its spec still only accepts main', () => {
  assert.equal(matchesRepoSpec('acme/api', 'acme/api', 'main'), true);
  assert.equal(matchesRepoSpec('acme/api', 'acme/api', 'develop'), false);
});

test('an unreadable base branch fails closed', () => {
  assert.equal(matchesRepoSpec('acme/api#release', 'acme/api', undefined), false);
  assert.equal(matchesRepoSpec('acme/api', 'acme/api', undefined), false);
});

test('the repository still has to match', () => {
  assert.equal(matchesRepoSpec('acme/api#release', 'evil/api', 'release'), false);
});

test('repository comparison is case-insensitive, branch comparison is not', () => {
  // GitHub repo names are case-insensitive; refs are not — `Main` and `main`
  // are two different branches and treating them as one would reopen the hole.
  assert.equal(matchesRepoSpec('Acme/API#release', 'acme/api', 'release'), true);
  assert.equal(matchesRepoSpec('acme/api#release', 'acme/api', 'Release'), false);
});
