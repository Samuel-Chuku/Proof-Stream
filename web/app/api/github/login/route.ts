import { type NextRequest, NextResponse } from 'next/server';
import { authorizeUrl, installUrl } from '../../../../lib/github';
import { STATE_COOKIE, newState } from '../../../../lib/session';

// node:crypto — not available on the edge runtime.
export const runtime = 'nodejs';

/// Start the GitHub connection.
///
/// The redirect target is built from THIS request's origin, so a local run
/// comes back to localhost and production comes back to the deployed domain.
/// Hard-coding it sent every local login to the production callback, which is
/// a dead end until that domain exists.
///
/// Each origin used must also be listed under the App's callback URLs — GitHub
/// accepts several, and rejects any redirect_uri that is not among them.
///
/// `?install=1` sends the user to the installation screen instead of plain
/// authorization. Authorizing proves who someone is; installing is what grants
/// the agent read access to specific repositories. They are separate steps and
/// a user can legitimately need the second after doing the first.
export function GET(req: NextRequest) {
  const { nonce, state } = newState();
  const origin = new URL(req.url).origin;
  const wantsInstall = new URL(req.url).searchParams.get('install') === '1';

  const target = wantsInstall
    ? installUrl(state)
    : authorizeUrl(state, `${origin}/api/github/callback`);

  const res = NextResponse.redirect(target);

  // The nonce comes back through GitHub; the callback rejects anything that
  // does not match this cookie.
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  return res;
}
