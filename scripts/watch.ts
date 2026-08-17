// Follow the agent's decisions from any machine.
//
//   pnpm watch
//
// `journalctl -u proofstream-agent -f` only works ON the VPS — journalctl reads
// systemd's journal, which is local to the host running the service. This does
// the same job over the same HTTP endpoint the dashboard uses, so it runs on a
// laptop, on a second machine you are recording from, or anywhere with the URL.
//
// Also survives the two things that killed the curl one-liner: an empty body
// while the agent restarts, and a 502 from the tunnel.
import { AGENT_EVENTS_URL_FALLBACK } from './watch-config';

const url = process.env.AGENT_EVENTS_URL || AGENT_EVENTS_URL_FALLBACK;
// `||`, not `??`. A variable that is PRESENT BUT BLANK is the normal state of a
// freshly copied .env, and `??` only catches null and undefined: Number('') is
// 0, so a blank line here became setInterval(tick, 0) and a busy loop. `||` on
// the raw string still honours an explicit '0', because '0' is a truthy string.
const everyMs = Number(process.env.WATCH_INTERVAL_MS || 5_000);

type Verdict = {
  at?: string;
  event?: string;
  pr?: number;
  workStream?: string;
  certifiedPercent?: number;
  agreedFraction?: number;
  claimUsdc?: string;
  txHash?: string;
  reason?: string;
};

const seen = new Set<string>();
let firstPass = true;
let quiet = 0;

const key = (v: Verdict) => `${v.at}|${v.workStream}|${v.pr}|${v.event}`;

// Colour only when stdout is a terminal, so piping to a file stays clean.
const tty = process.stdout.isTTY;
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const paint = (event: string) =>
  event === 'unlocked'
    ? c('32;1', event) // green — money moved
    : event === 'unlock_failed' || event === 'declined' || event === 'vetoed'
      ? c('31;1', event) // red — nothing moved
      : event === 'escalated'
        ? c('33;1', event)
        : c('90', event);

function line(v: Verdict) {
  const at = (v.at ?? '').slice(11, 19);
  const pct = v.certifiedPercent !== undefined ? `${v.certifiedPercent}%` : '';
  const agreed = v.agreedFraction !== undefined ? `agreed ${Math.round(v.agreedFraction * 100)}%` : '';
  const usdc = v.claimUsdc ? `${v.claimUsdc} USDC` : '';
  const tx = v.txHash ? c('32', `tx ${v.txHash.slice(0, 10)}…`) : '';
  const bits = [pct, agreed, usdc, tx].filter(Boolean).join('  ');

  console.log(
    `${c('90', at)}  ${paint(v.event ?? '?').padEnd(tty ? 24 : 14)} ` +
      `${v.pr !== undefined ? `PR #${v.pr}`.padEnd(7) : '       '} ` +
      `${(v.workStream ?? '').slice(0, 10).padEnd(10)}  ${bits}`,
  );
  // The reason is where every diagnosis has actually been, and truncating it
  // has cost real time twice. Print it whole.
  if (v.reason) console.log(`${' '.repeat(10)}${c('90', v.reason)}`);
}

console.log(`watching ${url}  (every ${everyMs / 1000}s, Ctrl-C to stop)\n`);

async function tick() {
  let rows: Verdict[];
  try {
    const res = await fetch(`${url}?limit=200`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (!body.trim()) throw new Error('empty body');
    rows = (JSON.parse(body).verdicts ?? []).filter(Boolean);
  } catch (err) {
    // A restarting agent is normal, not worth a stack trace on every poll.
    if (quiet++ % 6 === 0) {
      console.log(c('90', `  … agent unreachable (${err instanceof Error ? err.message : err})`));
    }
    return;
  }

  quiet = 0;
  for (const v of rows) {
    const k = key(v);
    if (seen.has(k)) continue;
    seen.add(k);
    // The first pass seeds what is already there; only print the tail of it so
    // the screen is not flooded on startup.
    if (!firstPass || rows.indexOf(v) >= rows.length - 5) line(v);
  }
  firstPass = false;
}

await tick();
setInterval(tick, everyMs);
