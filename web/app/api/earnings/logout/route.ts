import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../lib/session';

export const runtime = 'nodejs';

/// Sign out of GitHub here. The cookie is the whole session, so clearing it is
/// the whole sign-out; the token itself expires on GitHub's schedule.
export function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/earnings', new URL(req.url).origin), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
