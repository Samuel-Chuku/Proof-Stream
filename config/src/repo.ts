/// Which repository, and which branch, a stream's work has to land on.
///
/// WHY A BRANCH AT ALL. Until 2026-08-07 the agent judged any merged pull
/// request in the repository, whatever it was merged INTO. That is a hole: a
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
