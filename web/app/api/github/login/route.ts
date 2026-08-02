import { type NextRequest, NextResponse } from 'next/server';
import { installUrl } from '../../../../lib/github';
import { STATE_COOKIE, newState } from '../../../../lib/session';

// node:crypto — not available on the edge runtime.
export const runtime = 'nodejs';

/// Start the GitHub connection. One screen on GitHub's side handles both
/// authorization and installation, because the App has "Request user
/// authorization during installation" enabled — so the user picks which
/// repositories to grant in the same step, and no webhook is ever configured
/// by hand.
export function GET(_req: NextRequest) {
  const { nonce, state } = newState();

  const res = NextResponse.redirect(installUrl(state));

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
