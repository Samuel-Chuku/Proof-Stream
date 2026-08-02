// Server-only. The GitHub App's user-facing side.
//
// Installing the App is what subscribes a repository to webhooks — there is no
// per-repo hook to create — so this module only ever READS: who the user is,
// which installations they granted, and which repositories are in them.
const API = 'https://api.github.com';

/** The App's public slug, i.e. github.com/apps/<slug>. Not a secret. */
export const appSlug = () => process.env.GITHUB_APP_SLUG || 'proofstream';

/** Where the Connect button sends people: authorize and install in one screen. */
export function installUrl(state: string): string {
  return `https://github.com/apps/${appSlug()}/installations/new?state=${encodeURIComponent(state)}`;
}

export type Repo = {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

async function gh<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'proofstream-web',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/// Trade the callback's `code` for a user access token.
export async function exchangeCode(code: string): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      code,
    }),
    cache: 'no-store',
  });

  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  // GitHub answers 200 with an `error` field rather than a failure status.
  if (!body.access_token) {
    throw new Error(body.error_description ?? body.error ?? 'no access_token in GitHub response');
  }

  return {
    token: body.access_token,
    // Apps with token expiry enabled return expires_in (8h). Without it the
    // token does not expire, but the cookie still should.
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 60 * 60 * 24 * 7),
  };
}

export async function currentUser(token: string): Promise<{ login: string; avatarUrl: string }> {
  const user = await gh<{ login: string; avatar_url: string }>('/user', token);
  return { login: user.login, avatarUrl: user.avatar_url };
}

/// Every repository the user granted this App, across all their installations.
/// Only these are selectable — a stream cannot be pointed at a repo the agent
/// has not been given access to read.
export async function grantedRepos(token: string): Promise<Repo[]> {
  const { installations } = await gh<{ installations: { id: number }[] }>('/user/installations', token);

  const repos: Repo[] = [];
  for (const installation of installations) {
    const page = await gh<{
      repositories: { id: number; full_name: string; private: boolean; default_branch: string }[];
    }>(`/user/installations/${installation.id}/repositories?per_page=100`, token);

    for (const r of page.repositories) {
      repos.push({ id: r.id, fullName: r.full_name, private: r.private, defaultBranch: r.default_branch });
    }
  }

  return repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
