// Server-only. How many people a stream's alerts reach.
//
// Counts, never identities: the page says "your alerts are on" and "one place
// left", and nothing here could tell a stranger who follows a stream.
import { agentRoute } from './agent-url';

export type AlertStatus = {
  telegram: number;
  email: number;
  emailSlots: number;
  channels: { telegram: boolean; email: boolean };
};

export async function readAlertStatus(stream: string): Promise<AlertStatus | null> {
  const url = agentRoute('/alerts/status');
  if (!url) return null;
  try {
    const res = await fetch(`${url}?stream=${stream}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return (await res.json()) as AlertStatus;
  } catch {
    // An agent that cannot be reached is not a reason to fail the page: the
    // control still works, it simply cannot say who is already listening.
    return null;
  }
}
