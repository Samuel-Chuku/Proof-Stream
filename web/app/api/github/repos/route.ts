import { type NextRequest, NextResponse } from 'next/server';
import { grantedRepos } from '../../../../lib/github';
import { SESSION_COOKIE, readSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/// The repositories the create-stream form can choose from.
///
/// Only repos the user actually granted the App appear here. That is the whole
/// point of the install step: the agent can never be pointed at a repository it
/// has not been given permission to read.
export async function GET(req: NextRequest) {
  const session = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: 'not connected to GitHub' }, { status: 401 });
  }

  try {
    return NextResponse.json({ login: session.login, repos: await grantedRepos(session.token) });
  } catch (err) {
    // A revoked or expired token looks like any other API failure; say so
    // plainly so the UI can offer to reconnect rather than showing an empty list.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'could not read repositories' },
      { status: 502 },
    );
  }
}
