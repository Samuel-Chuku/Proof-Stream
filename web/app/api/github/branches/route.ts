import { type NextRequest, NextResponse } from 'next/server';
import { createBranch, listBranches } from '../../../../lib/github';
import { SESSION_COOKIE, readSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/// The branches of one granted repository.
///
/// A stream names a branch as well as a repository, because the agent only pays
/// for work merged into the branch the employer nominated — see `config/repo.ts`
/// for what that closes.
export async function GET(req: NextRequest) {
  const session = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'not connected to GitHub' }, { status: 401 });

  const repo = req.nextUrl.searchParams.get('repo');
  // `owner/name` and nothing else. This value is interpolated into a GitHub API
  // path, so a `..` or a stray slash here would address a different endpoint.
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: 'a repo of the form owner/name is required' }, { status: 400 });
  }

  try {
    return NextResponse.json({ branches: await listBranches(session.token, repo) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'could not read branches' },
      { status: 502 },
    );
  }
}

/// Create a branch, so an employer can make an integration branch without
/// leaving the form. Needs `contents: write` on the App; a 403 comes back as a
/// plain message telling them to create it on GitHub instead.
export async function POST(req: NextRequest) {
  const session = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'not connected to GitHub' }, { status: 401 });

  const { repo, branch, from } = (await req.json().catch(() => ({}))) as {
    repo?: string;
    branch?: string;
    from?: string;
  };

  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: 'a repo of the form owner/name is required' }, { status: 400 });
  }
  // Git's own ref rules, trimmed to what a form should allow: no spaces, no
  // `..`, no leading or trailing slash, no tilde/caret/colon/question/asterisk.
  if (!branch || !/^[\w.-]+(\/[\w.-]+)*$/.test(branch) || branch.includes('..')) {
    return NextResponse.json({ error: 'that is not a valid branch name' }, { status: 400 });
  }
  if (!from || !/^[\w.-]+(\/[\w.-]+)*$/.test(from)) {
    return NextResponse.json({ error: 'a source branch is required' }, { status: 400 });
  }

  try {
    await createBranch(session.token, repo, branch, from);
    return NextResponse.json({ branch });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not create the branch';
    const forbidden = message.includes(' 403 ');
    return NextResponse.json(
      {
        error: forbidden
          ? 'The GitHub App does not have write access to this repository, so it cannot create a branch. Create it on GitHub and it will appear in the list.'
          : message,
      },
      { status: forbidden ? 403 : 502 },
    );
  }
}
