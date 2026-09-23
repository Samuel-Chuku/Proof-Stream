import { type NextRequest, NextResponse } from 'next/server';
import { agentRoute } from '../../../../lib/agent-url';
import { SESSION_COOKIE, readSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/// Ask the agent to send a confirmation email.
///
/// EMAIL IS GATED, Telegram is not. A chat id costs nothing and arrives with
/// consent; an email costs money and lands somewhere people guard, so it goes
/// only to the two parties with a stake in a stream, each proving it the way
/// their side can. This route assembles that proof and forwards it:
///
///   contributor  the GitHub token in this session's cookie, which the AGENT
///                checks with GitHub. The browser never sees it and cannot
///                name an account it does not hold a token for.
///   employer     an address and a signature the browser collected, which the
///                agent checks against the contract's own `employer`.
export async function POST(req: NextRequest) {
  const url = agentRoute('/email/subscribe');
  if (!url) return NextResponse.json({ ok: false, message: 'Email alerts are not configured on this deployment.' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as {
    address?: string;
    kind?: string;
    id?: string;
    role?: string;
    signature?: string;
    signer?: string;
    issuedAt?: number;
  };

  let proof: Record<string, unknown>;
  if (body.role === 'employer') {
    proof = { role: 'employer', address: body.signer, signature: body.signature, issuedAt: body.issuedAt };
  } else {
    const session = readSession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session?.token) {
      return NextResponse.json(
        { ok: false, message: 'Sign in with GitHub first, or follow this stream on Telegram, which is open to anyone.' },
        { status: 401 },
      );
    }
    proof = { role: 'contributor', githubToken: session.token };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: body.address, kind: body.kind, id: body.id, proof }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, message: 'The agent could not be reached. Try again shortly.' }, { status: 502 });
  }
}
