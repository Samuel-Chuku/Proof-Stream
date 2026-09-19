// WHAT MAY BE ADDED TO THE ALLOWLIST, and why each refusal exists.
//
// This list decides whose merges the agent will even look at, so a name that
// gets in but can never match does not fail loudly — it silently withholds pay
// from exactly the person it was added to allow, and the employer has no way to
// see that from the form.
//
// `reject` mirrors the validation in web/lib/create-stream.ts, which remains the
// authority and runs again at deploy. It is duplicated so the reason arrives
// while the employer is looking at the name rather than as a blocker at the
// bottom of a nine-field form with the offending entry scrolled out of sight.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reject } from '../app/new/author-allowlist';

test('an ordinary GitHub username is accepted', () => {
  assert.equal(reject('Samuel-Chuku', []), null);
});

test('so are the awkward but legal ones', () => {
  assert.equal(reject('a', []), null, 'one character is a real login');
  assert.equal(reject('0x-1', []), null, 'digits and hyphens are fine');
  assert.equal(reject('A'.repeat(39), []), null, "39 characters is GitHub's ceiling");
});

// --- the refusal that matters most -----------------------------------------

test('AN EMAIL ADDRESS IS REFUSED, AND SAYS WHY', () => {
  // The agent compares against the pull request's `user.login`. An address can
  // never equal a login, so this would not error anywhere: it would quietly
  // reject every merge by the person it names. The one mistake here that costs
  // somebody money without telling anyone.
  const problem = reject('sam@example.com', []);
  assert.match(problem ?? '', /username, not an email/);
});

test('a GitHub noreply address is refused too, despite containing a login', () => {
  // Tempting to accept and parse, and wrong to: the allowlist holds logins, and
  // the login inside a noreply address is only ever read from a Co-authored-by
  // trailer, by coAuthorLogins.
  assert.notEqual(reject('12345+samuel@users.noreply.github.com', []), null);
});

test('a display name is refused', () => {
  // "Ada Lovelace" is not a login, and matching it against one would be guessing.
  assert.match(reject('Ada Lovelace', []) ?? '', /not a GitHub username/);
});

test('characters GitHub does not allow in a login are refused', () => {
  for (const bad of ['under_score', 'dot.name', 'slash/name', 'A'.repeat(40)]) {
    assert.notEqual(reject(bad, []), null, `${bad} should be refused`);
  }
});

// --- bounds ----------------------------------------------------------------

test('THE SIXTEENTH NAME IS THE LAST ONE', () => {
  // Mirrors MAX_AUTHORS on the contract. Past it the deploy reverts, and a
  // revert at the end of the flow is a worse way to learn this than a sentence.
  const full = Array.from({ length: 16 }, (_, i) => `dev-${i}`);
  assert.equal(reject('dev-15', full.slice(0, 15)), null, 'the sixteenth is allowed');
  assert.match(reject('one-more', full) ?? '', /At most 16/);
});

test('a duplicate is refused, case-insensitively', () => {
  // GitHub logins are case-insensitive and the agent lowercases both sides, so
  // two spellings of one account would look like two people and quietly use up
  // a slot of the sixteen.
  assert.match(reject('Samuel-Chuku', ['samuel-chuku']) ?? '', /already named/);
});

// --- agreement with the authority ------------------------------------------

test('EVERY NAME THIS ACCEPTS ALSO SURVIVES THE DEPLOY VALIDATOR', () => {
  // The two rules are written separately and would drift apart silently: this
  // one only ever runs in the browser, the other only ever at deploy. A name
  // accepted here and rejected there is a form that lets you build a list and
  // then refuses to ship it, with no indication which entry is at fault.
  const pattern = /^[A-Za-z0-9-]{1,39}$/; // create-stream.ts
  const accepted = ['Samuel-Chuku', 'a', '0x-1', 'A'.repeat(39), 'dev-15'];
  for (const name of accepted) {
    assert.equal(reject(name, []), null, `${name} accepted here`);
    assert.ok(pattern.test(name), `${name} must also pass create-stream.ts`);
  }
});
