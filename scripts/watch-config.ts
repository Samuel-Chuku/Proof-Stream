/// Where the agent publishes its decisions. Overridden by AGENT_EVENTS_URL, so
/// a second machine only needs this file — no .env, no secrets. /events is a
/// public read of the same log the dashboard shows.
export const AGENT_EVENTS_URL_FALLBACK = 'https://agent.proofstream.site/events';
