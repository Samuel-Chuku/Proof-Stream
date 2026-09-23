import { type NextRequest, NextResponse } from 'next/server';
import { agentRoute } from '../../../../lib/agent-url';

export const runtime = 'nodejs';

/// Ask the agent to send a confirmation email.
///
/// The app fronts this so the address is typed on the domain people already
/// trust, and so the confirmation link is on that domain too. The agent owns
/// the subscription ledger, so the write has to reach it; the URL does not.
export async function POST(req: NextRequest) {
  const url = agentRoute('/email/subscribe');
  if (!url) return NextResponse.json({ ok: false, message: 'Email alerts are not configured on this deployment.' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { address?: string; kind?: string; id?: string };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, message: 'The agent could not be reached. Try again shortly.' }, { status: 502 });
  }
}
