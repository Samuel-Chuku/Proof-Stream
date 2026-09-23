// Server-only. The agent's own base URL, derived from the one variable that
// already points at it.
//
// AGENT_EVENTS_URL is how the web app has always reached the agent; every
// other route hangs off the same origin. Deriving them rather than adding a
// variable per route means one thing to set when the agent moves.
export function agentRoute(path: string): string | null {
  const events = process.env.AGENT_EVENTS_URL;
  if (!events) return null;
  return events.replace(/\/events\b.*$/, path);
}
