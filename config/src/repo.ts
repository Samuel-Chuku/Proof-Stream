import { keccak256, toHex } from 'viem';
/// Which repository, and which branch, a stream's work has to land on.
///
/// WHY A BRANCH AT ALL. Judging any merged pull request in the repository,
/// whatever it was merged INTO, is a hole: a
/// contributor could open a pull request from one throwaway branch into
/// another, merge it themselves — non-default branches are not protected and
/// need nobody's approval — and be judged and paid without the employer ever
/// seeing the code. Naming a branch puts the employer back in the loop, because
/// the branch they name is one they control merges into.
///
/// WHY IT IS ENCODED IN THE `repo` STRING. The employer's mandate to the agent
/// must come from the contract, not from the agent's own environment — an agent
/// that decides which branch it watches is deciding its own mandate. `repo` is
/// already an employer-owned on-chain string, so `owner/name#branch` puts the
/// branch under exactly the same control as the repository, with no contract
/// change and no redeploy. A spec with no `#` means `main`, so every stream
/// deployed before this existed keeps working unchanged.
export const DEFAULT_BRANCH = 'main';

export type RepoSpec = {
  /** `owner/name`, the form GitHub uses in `repository.full_name`. */
  repo: string;
  /** The branch a pull request must be merged INTO to count. */
  branch: string;
};

/// Split an on-chain `repo()` value into repository and branch.
/// `acme/api#release` → `{ repo: 'acme/api', branch: 'release' }`
/// `acme/api`         → `{ repo: 'acme/api', branch: 'main' }`
export function parseRepoSpec(spec: string): RepoSpec {
  const hash = spec.indexOf('#');
  if (hash === -1) return { repo: spec.trim(), branch: DEFAULT_BRANCH };
  return {
    repo: spec.slice(0, hash).trim(),
    // A trailing `#` with nothing after it is a typo, not an instruction to
    // watch every branch. Fall back to the default rather than open the hole.
    branch: spec.slice(hash + 1).trim() || DEFAULT_BRANCH,
  };
}

/// The inverse, for writing a spec on deployment.
export function formatRepoSpec(repo: string, branch: string): string {
  const trimmed = branch.trim();
  return !trimmed || trimmed === DEFAULT_BRANCH ? repo.trim() : `${repo.trim()}#${trimmed}`;
}

/// Does a merged pull request belong to this stream? Both halves must match:
/// the right repository AND the branch the employer nominated.
///
/// `baseBranch` is undefined for events we could not read a base from. That is
/// treated as NOT a match: an unreadable base is exactly the case this check
/// exists to catch, so it fails closed.
export function matchesRepoSpec(spec: string, repo: string, baseBranch: string | undefined): boolean {
  const want = parseRepoSpec(spec);
  if (repo.toLowerCase() !== want.repo.toLowerCase()) return false;
  return baseBranch !== undefined && baseBranch === want.branch;
}

/// WHOSE MERGES COUNT FOR A STREAM.
///
/// Several streams on one repository is a supported configuration, and nothing
/// used to tie a pull request's AUTHOR to a stream's contributor. Two streams on
/// the same repo and branch meant one person's merge was judged against both,
/// and could certify and pay the other person's stream. The branch check does
/// not help there: both name the same branch.
///
/// EMPTY MEANS ANY AUTHOR. Every stream created before this existed has an empty
/// list, and they must keep working exactly as they did.
///
/// Case-insensitive, because GitHub logins are. `Ada` and `ada` are one account
/// and refusing to pay over capitalisation would be absurd.
///
/// CO-AUTHORS COUNT, provided they are on the list. Pairing is normal and only
/// one person can open the pull request, so judging solely by the opener would
/// refuse to pay work the stream is plainly for.
///
/// The residual, and it is worth knowing: a `Co-authored-by` trailer is just
/// text in a commit message, and anybody can write one. So somebody not on the
/// list can get their merge judged against this stream by naming someone who is.
/// Two things bound it. The merge still has to be approved into the branch the
/// employer named, and the money still goes to the stream's single payee, so the
/// writer of the trailer cannot pay themselves. It is a way to make someone
/// ELSE be paid, not a way to be paid.
///
/// An author we cannot read is treated as no match, so this fails closed in the
/// same direction as the branch check.
export function authorIsAllowed(
  authors: string[],
  prAuthor: string | undefined,
  coAuthors: string[] = [],
): boolean {
  if (authors.length === 0) return true;
  const allowed = new Set(authors.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const candidates = [prAuthor, ...coAuthors].map((c) => c?.trim().toLowerCase()).filter(Boolean);
  return candidates.some((c) => allowed.has(c as string));
}

/// WHO MADE THIS MERGE COUNT, and is therefore the one credited for it.
///
/// On a public stream the earner is PAID, which inverts the safety property
/// the allowlist relied on above: a co-author trailer is no longer only a way to
/// make someone else be paid. So the earner cannot simply be the pull request's
/// author. It is the first candidate the allowlist accepts, author first and
/// then co-authors in trailer order — the person whose presence let this merge
/// through. With no allowlist everyone is accepted, so that is the author.
///
/// One merge, one earner. Splitting one pull request's credit between its
/// co-authors is a fairness question with no obvious answer, and is deferred
/// until there is a real case to decide it on.
///
/// Returns undefined when nobody is accepted, which the caller treats as
/// "cannot certify", never as "credit the author anyway".
export function allowedEarner(
  authors: string[],
  prAuthor: string | undefined,
  coAuthors: string[] = [],
): string | undefined {
  const candidates = [prAuthor, ...coAuthors].map((c) => c?.trim()).filter((c): c is string => Boolean(c));
  if (authors.length === 0) return candidates[0];
  const allowed = new Set(authors.map((a) => a.trim().toLowerCase()).filter(Boolean));
  return candidates.find((c) => allowed.has(c.toLowerCase()));
}

/// The opaque identity the contract credits.
///
/// `keccak256("github:12345")`. Namespaced by platform so a GitLab id can never
/// collide with a GitHub one, and hashed so the contract stores 32 bytes it
/// does not have to interpret. The NUMERIC id, never the login: logins can be
/// renamed and reassigned to somebody else, and a credit that followed the
/// login would follow it to them.
///
/// Shared between the agent, which puts it in the attestation, and the web,
/// which will need the same value to show an earner what they are owed. Two
/// implementations of this would drift and the drift would be invisible.
export function earnerId(platform: string, numericId: number | bigint): `0x${string}` {
  if (!/^[a-z][a-z0-9-]*$/.test(platform)) throw new Error(`earnerId: bad platform "${platform}"`);
  const n = BigInt(numericId);
  if (n <= 0n) throw new Error(`earnerId: id must be positive, got ${numericId}`);
  return keccak256(toHex(`${platform}:${n}`));
}

/// The GitHub logins named in `Co-authored-by` trailers.
///
/// GitHub's own co-author trailers carry a noreply address that CONTAINS the
/// login, either `12345+login@users.noreply.github.com` or
/// `login@users.noreply.github.com`. That is the only form this trusts for an
/// email, because an arbitrary address tells us nothing about which account it
/// belongs to.
///
/// The display name is also offered, but only when it could be a login at all:
/// no spaces, and within GitHub's own character rules. "Ada Lovelace" is not a
/// login and matching it against one would be guessing.
export function coAuthorLogins(commitMessages: string[]): string[] {
  const found = new Set<string>();
  const trailer = /^\s*co-authored-by:\s*(.*?)\s*<([^>]+)>\s*$/gim;

  for (const message of commitMessages) {
    for (const [, name, email] of message.matchAll(trailer)) {
      const noreply = email.match(/^(?:\d+\+)?([A-Za-z0-9-]{1,39})@users\.noreply\.github\.com$/i);
      if (noreply) found.add(noreply[1].toLowerCase());
      else if (/^[A-Za-z0-9-]{1,39}$/.test(name)) found.add(name.toLowerCase());
    }
  }
  return [...found];
}
