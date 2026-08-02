import { type NextRequest, NextResponse } from 'next/server';
import { currentUser, exchangeCode } from '../../../../lib/github';
import { SESSION_COOKIE, STATE_COOKIE, seal, verifyState } from '../../../../lib/session';

export const runtime = 'nodejs';

/// Where GitHub returns the user after they authorize and install.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/?github=error&reason=${encodeURIComponent(reason)}`, url.origin));

  // The state must both carry our signature AND match the nonce we set on this
  // browser. The signature alone would let an attacker replay a state they
  // obtained; the cookie binds it to this session.
  const expectedNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!verifyState(state) || !expectedNonce || state?.split('.')[0] !== expectedNonce) {
    return fail('state mismatch');
  }

  // GitHub sends users here after a bare install too, with no code to exchange.
  if (!code) return fail('no authorization code — try connecting again');

  try {
    const { token, expiresAt } = await exchangeCode(code);
    const { login } = await currentUser(token);

    const res = NextResponse.redirect(new URL('/?github=connected', url.origin));

    res.cookies.set(SESSION_COOKIE, seal({ token, login, expiresAt }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: new Date(expiresAt * 1000),
    });
    res.cookies.delete(STATE_COOKIE);

    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'could not complete the GitHub connection');
  }
}
