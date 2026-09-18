import { earnerId } from '@proofstream/config';
import { type NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { SESSION_COOKIE, readSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/// The agent exposes /events for the dashboard and /bind beside it.
function bindUrl(): string | null {
  const events = process.env.AGENT_EVENTS_URL;
  if (!events) return null;
  return events.replace(/\/events\b.*$/, '/bind');
}

/// Ask the agent to authorise where this earner is paid on one stream.
///
/// The web app holds the signed-in user's GitHub token and nothing else about
/// them that the agent would trust. It forwards the token; the agent asks
/// GitHub who it belongs to and signs for THAT account. This route therefore
/// never names an earner itself, and cannot be talked into naming one.
export async function POST(req: NextRequest) {
  const session = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session?.id) return NextResponse.json({ error: 'sign in with GitHub first' }, { status: 401 });

  const url = bindUrl();
  if (!url) {
    return NextResponse.json(
      { error: 'This deployment cannot reach the agent, so it cannot authorise a payee. AGENT_EVENTS_URL is not set.' },
      { status: 503 },
    );
  }

  const { stream, payee } = (await req.json().catch(() => ({}))) as { stream?: unknown; payee?: unknown };
  if (typeof stream !== 'string' || !isAddress(stream) || typeof payee !== 'string' || !isAddress(payee)) {
    return NextResponse.json({ error: 'a stream and a payee address are required' }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stream, payee }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { earnerId?: string; error?: string };

    // The agent decided who the token belongs to on its own. If its answer is
    // not the account this session holds, something between here and there is
    // wrong, and a signature for the wrong earner must not reach a wallet.
    if (res.ok && body.earnerId?.toLowerCase() !== earnerId('github', session.id).toLowerCase()) {
      return NextResponse.json({ error: 'the agent authorised a different account than the one signed in here' }, { status: 502 });
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `the agent could not be reached: ${err.message.split('\n')[0]}` : 'the agent could not be reached' },
      { status: 502 },
    );
  }
}
