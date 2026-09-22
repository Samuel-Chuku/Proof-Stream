// WHO WANTS TO HEAR ABOUT WHICH STREAM, and what they have already been told.
//
// An append-only ledger beside verdicts.jsonl, folded on read, because that is
// how every other piece of state the agent owns works and because a
// subscription list for a handful of streams does not need a database. Rows:
//
//   { event: 'subscribed',   channel, chatId, stream }
//   { event: 'subscribed',   channel, chatId, earner }      follow ME, not a stream
//   { event: 'unsubscribed', channel, chatId, stream }     stream '*' = all
//   { event: 'alerted',      stream, kind }                 a timed alert sent
//
// AN EARNER FOLLOW is how the earnings page subscribes: not to a stream but to
// a person, by the same opaque id the contract credits. Whenever a
// certification credits that id, the chat is folded into that stream's
// subscribers (`adoptEarnerFollows`), so they hear the judgment that paid them
// and every alert about that stream afterwards, including streams that do not
// exist yet. Everything an earner follow can reveal is on chain already.
//
// `alerted` rows are what make the timed alerts fire once and survive a
// restart: a stream ending at 18:00 must not announce it again at 18:01
// because the process came back.
import { appendFileSync, readFileSync } from 'node:fs';
import { ledgerPath } from './env';

export type Subscription = { channel: 'telegram'; chatId: string; stream: string };
export type EarnerFollow = { channel: 'telegram'; chatId: string; earner: string };

type Row = Record<string, unknown>;

function rows(): Row[] {
  try {
    return readFileSync(ledgerPath('subscriptions.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Row];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function append(row: Row): void {
  appendFileSync(ledgerPath('subscriptions.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
}

/// The live set, folded from the ledger. Pure over the rows, so it is tested.
export function fold(all: readonly Row[]): Subscription[] {
  const live = new Map<string, Subscription>();
  for (const r of all) {
    if (r.channel !== 'telegram' || typeof r.chatId !== 'string') continue;
    if (r.event === 'subscribed' && typeof r.stream === 'string') {
      const stream = r.stream.toLowerCase();
      live.set(`${r.chatId}:${stream}`, { channel: 'telegram', chatId: r.chatId, stream });
    } else if (r.event === 'unsubscribed') {
      if (r.stream === '*') {
        for (const key of [...live.keys()]) if (key.startsWith(`${r.chatId}:`)) live.delete(key);
      } else if (typeof r.stream === 'string') {
        live.delete(`${r.chatId}:${r.stream.toLowerCase()}`);
      }
    }
  }
  return [...live.values()];
}

export const subscriptions = (): Subscription[] => fold(rows());

/// The live earner follows. `/stop` (all) ends these too.
export function foldEarners(all: readonly Row[]): EarnerFollow[] {
  const live = new Map<string, EarnerFollow>();
  for (const r of all) {
    if (r.channel !== 'telegram' || typeof r.chatId !== 'string') continue;
    if (r.event === 'subscribed' && typeof r.earner === 'string') {
      const earner = r.earner.toLowerCase();
      live.set(`${r.chatId}:${earner}`, { channel: 'telegram', chatId: r.chatId, earner });
    } else if (r.event === 'unsubscribed' && r.stream === '*') {
      for (const key of [...live.keys()]) if (key.startsWith(`${r.chatId}:`)) live.delete(key);
    }
  }
  return [...live.values()];
}

export const earnerFollows = (): EarnerFollow[] => foldEarners(rows());

export function followEarner(chatId: string, earner: string): void {
  append({ event: 'subscribed', channel: 'telegram', chatId, earner: earner.toLowerCase() });
}

/// Fold everyone following this earner into this stream's subscribers. Called
/// when a certification credits the earner, and when the follow is first
/// taken, for streams that already credited them. Idempotent: an existing
/// subscription is not written again.
export function adoptEarnerFollows(stream: string, earner: string): number {
  const all = rows();
  const already = new Set(fold(all).map((s) => `${s.chatId}:${s.stream}`));
  let adopted = 0;
  for (const f of foldEarners(all)) {
    if (f.earner !== earner.toLowerCase()) continue;
    if (already.has(`${f.chatId}:${stream.toLowerCase()}`)) continue;
    subscribe(f.chatId, stream);
    adopted += 1;
  }
  return adopted;
}

/// Streams that have credited this earner, from the verdict ledger: every
/// `unlocked` row carrying the id. Read on demand; it is a few hundred lines.
export function streamsCrediting(earner: string): string[] {
  const out = new Set<string>();
  try {
    for (const line of readFileSync(ledgerPath('verdicts.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as Row;
        if (r.event === 'unlocked' && typeof r.earnerId === 'string' && typeof r.workStream === 'string' && r.earnerId.toLowerCase() === earner.toLowerCase()) {
          out.add(r.workStream.toLowerCase());
        }
      } catch {
        // a truncated final line is normal mid-write
      }
    }
  } catch {
    // no ledger yet
  }
  return [...out];
}

export function subscribersOf(stream: string): Subscription[] {
  return subscriptions().filter((s) => s.stream === stream.toLowerCase());
}

/// Every stream anybody is listening to. The timed alerts run over this,
/// not over the registry's list, because the registry drops a stream once
/// its grace has run and the last alert is about exactly that moment.
export function subscribedStreams(): string[] {
  return [...new Set(subscriptions().map((s) => s.stream))];
}

export function subscribe(chatId: string, stream: string): void {
  append({ event: 'subscribed', channel: 'telegram', chatId, stream: stream.toLowerCase() });
}

export function unsubscribe(chatId: string, stream: string | '*'): void {
  append({ event: 'unsubscribed', channel: 'telegram', chatId, stream: stream === '*' ? '*' : stream.toLowerCase() });
}

/// Which timed alerts have gone out for a stream.
export function alertsSent(all: readonly Row[], stream: string): Set<string> {
  const sent = new Set<string>();
  for (const r of all) {
    if (r.event === 'alerted' && typeof r.stream === 'string' && r.stream.toLowerCase() === stream.toLowerCase() && typeof r.kind === 'string') {
      sent.add(r.kind);
    }
  }
  return sent;
}

export const alertsSentFor = (stream: string) => alertsSent(rows(), stream);

export function markAlerted(stream: string, kind: string): void {
  append({ event: 'alerted', stream: stream.toLowerCase(), kind });
}
