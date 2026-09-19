import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorIsAllowed, coAuthorLogins, DEFAULT_BRANCH, formatRepoSpec, matchesRepoSpec, parseRepoSpec } from '../src/repo';

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

// --- whose merges count -----------------------------------------------------

test('an empty allowlist means any author, so old streams keep working', () => {
  assert.equal(authorIsAllowed([], 'anyone'), true);
  assert.equal(authorIsAllowed([], undefined), true);
});

test('a named author is matched, and anyone else is not', () => {
  assert.equal(authorIsAllowed(['ada'], 'ada'), true);
  assert.equal(authorIsAllowed(['ada'], 'mallory'), false);
});

test('MATCHING IS CASE-INSENSITIVE, because GitHub logins are', () => {
  // Refusing to pay someone over capitalisation would be absurd.
  assert.equal(authorIsAllowed(['Ada'], 'ada'), true);
  assert.equal(authorIsAllowed(['ada'], 'ADA'), true);
});

test('any account on the list counts, which is the point of a list', () => {
  const both = ['ada', 'ada-at-work'];
  assert.equal(authorIsAllowed(both, 'ada'), true);
  assert.equal(authorIsAllowed(both, 'ada-at-work'), true);
  assert.equal(authorIsAllowed(both, 'someone-else'), false);
});

test('AN AUTHOR WE CANNOT READ FAILS CLOSED', () => {
  // Same direction as the branch check: a fact we could not establish is not
  // treated as a fact in the contributor's favour.
  assert.equal(authorIsAllowed(['ada'], undefined), false);
  assert.equal(authorIsAllowed(['ada'], ''), false);
});

test('surrounding whitespace does not decide who gets paid', () => {
  assert.equal(authorIsAllowed([' ada '], 'ada'), true);
  assert.equal(authorIsAllowed(['ada'], ' ada '), true);
});

// --- co-authors -------------------------------------------------------------

test('a co-author on the list is paid, because pairing is normal', () => {
  // Only one person can open a pull request. Judging solely by the opener would
  // refuse work the stream is plainly for.
  assert.equal(authorIsAllowed(['ada'], 'grace', ['ada']), true);
});

test('a co-author NOT on the list changes nothing', () => {
  assert.equal(authorIsAllowed(['ada'], 'grace', ['mallory']), false);
});

test('co-authors do not weaken the empty-list case', () => {
  assert.equal(authorIsAllowed([], 'anyone', ['anyone-else']), true);
});

test("GitHub's noreply address carries the login, and that is what we trust", () => {
  const msg = 'Fix the thing\n\nCo-authored-by: Ada Lovelace <12345+ada@users.noreply.github.com>';
  assert.deepEqual(coAuthorLogins([msg]), ['ada']);
});

test('a noreply address without the numeric prefix also resolves', () => {
  assert.deepEqual(coAuthorLogins(['x\n\nCo-authored-by: ada <ada@users.noreply.github.com>']), ['ada']);
});

test('AN ARBITRARY EMAIL YIELDS NO LOGIN', () => {
  // It tells us nothing about which account it belongs to, and guessing here
  // would decide who gets paid.
  assert.deepEqual(coAuthorLogins(['x\n\nCo-authored-by: Ada Lovelace <ada@example.com>']), []);
});

test('a display name is used only when it could be a login at all', () => {
  assert.deepEqual(coAuthorLogins(['x\n\nCo-authored-by: ada <ada@example.com>']), ['ada']);
  assert.deepEqual(coAuthorLogins(['x\n\nCo-authored-by: Ada Lovelace <a@b.com>']), []);
});

test('the trailer is matched case-insensitively and across several commits', () => {
  const logins = coAuthorLogins([
    'a\n\nCO-AUTHORED-BY: grace <grace@users.noreply.github.com>',
    'b\n\nco-authored-by: ada <ada@users.noreply.github.com>',
    'c\n\nCo-authored-by: ada <ada@users.noreply.github.com>',
  ]);
  assert.deepEqual(logins.sort(), ['ada', 'grace'], 'duplicates collapse');
});

test('a commit with no trailer yields nothing', () => {
  assert.deepEqual(coAuthorLogins(['just a normal commit message']), []);
});

// --- who is credited, and under what name ------------------------------------
//
// On a public stream the earner is PAID. That inverts the safety property the
// allowlist relied on: a Co-authored-by trailer is no longer only a way to make
// someone else be paid. So the earner is the first candidate the allowlist
// accepts — the person whose presence let the merge through — never simply the
// author.

import { allowedEarner, earnerId } from '../src/repo';

test('with no allowlist the author is the earner', () => {
  assert.equal(allowedEarner([], 'ada', ['bob']), 'ada');
});

test('an allowed author is the earner even when a co-author is also allowed', () => {
  assert.equal(allowedEarner(['ada', 'bob'], 'ada', ['bob']), 'ada');
});

test('THE EARNER IS THE FIRST ALLOWED CANDIDATE, NOT THE AUTHOR', () => {
  // The author is not on the list; the merge counted because Bob co-authored.
  // Crediting Ada would pay somebody the employer never allowed.
  assert.equal(allowedEarner(['bob'], 'ada', ['bob']), 'bob');
});

test('co-authors are tried in trailer order', () => {
  assert.equal(allowedEarner(['carol', 'bob'], 'ada', ['bob', 'carol']), 'bob');
});

test('nobody allowed means nobody, never a fallback to the author', () => {
  // The caller must refuse to certify. Sending the author here would credit
  // exactly the person the allowlist excluded.
  assert.equal(allowedEarner(['bob'], 'ada', ['carol']), undefined);
});

test('matching is case-insensitive, like the allowlist itself', () => {
  assert.equal(allowedEarner(['Samuel-Chuku'], 'samuel-chuku'), 'samuel-chuku');
});

test('an unreadable author is skipped, not matched', () => {
  assert.equal(allowedEarner(['bob'], undefined, ['bob']), 'bob');
  assert.equal(allowedEarner([], undefined, []), undefined);
});

test('EARNER ID MATCHES THE CONTRACT BYTE FOR BYTE', () => {
  // WorkStreamPublic.t.sol uses keccak256("github:1001") as ALICE. If this
  // ever disagrees, every credit the agent writes lands under a key the earner
  // page cannot find, with no error anywhere. Pinned against `cast keccak`.
  assert.equal(
    earnerId('github', 1001),
    '0x15a2dae246512208989449537f1e3d3f6f2d8faa159c7c51df01a6d09efdd05e',
  );
});

test('the numeric id and its bigint form hash identically', () => {
  assert.equal(earnerId('github', 12345), earnerId('github', 12345n));
});

test('platforms are namespaced, so the same id on two platforms never collides', () => {
  assert.notEqual(earnerId('github', 1), earnerId('gitlab', 1));
});

test('earnerId refuses what could not be an identity', () => {
  assert.throws(() => earnerId('github', 0), /positive/);
  assert.throws(() => earnerId('github', -5), /positive/);
  assert.throws(() => earnerId('GitHub', 1), /bad platform/, 'the namespace is lowercase, once, forever');
  assert.throws(() => earnerId('git hub', 1), /bad platform/);
});
