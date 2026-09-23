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
/// An address that has CONFIRMED. Nothing unconfirmed is ever written here;
/// see email.ts for why the pending state is a signed token instead.
export type EmailRole = 'contributor' | 'employer';
export type EmailSubscription = {
  channel: 'email';
  address: string;
  /// WHICH SIDE THEY ARE ON, and therefore which alerts reach them. A
  /// contributor wants the deadline that ends their chance to be paid; an
  /// employer wants the moment they may close and reclaim. Both want a
  /// certification, for opposite reasons.
  role: EmailRole;
  stream?: string;
  earner?: string;
};
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

// ----------------------------------------------------------------- email
//
// Same ledger, same fold, a different channel. Kept beside the Telegram rows
// rather than in a store of its own: one question, one source of truth.

type EmailTarget = { kind: 'stream' | 'earner'; id: string };
const asRole = (v: unknown): EmailRole => (v === 'employer' ? 'employer' : 'contributor');

const emailKey = (address: string, t: EmailTarget) => `${address.toLowerCase()}:${t.kind}:${t.id.toLowerCase()}`;

export function foldEmails(all: readonly Row[]): EmailSubscription[] {
  const live = new Map<string, EmailSubscription>();
  for (const r of all) {
    if (r.channel !== 'email' || typeof r.address !== 'string') continue;
    const kind = typeof r.stream === 'string' ? 'stream' : typeof r.earner === 'string' ? 'earner' : null;
    if (!kind) continue;
    const id = String(kind === 'stream' ? r.stream : r.earner).toLowerCase();
    const key = emailKey(r.address, { kind, id });
    if (r.event === 'subscribed') {
      live.set(key, {
        channel: 'email',
        address: r.address.toLowerCase(),
        role: asRole(r.role),
        ...(kind === 'stream' ? { stream: id } : { earner: id }),
      });
    } else if (r.event === 'unsubscribed') {
      live.delete(key);
    }
  }
  return [...live.values()];
}

export const emailSubscriptions = (): EmailSubscription[] => foldEmails(rows());

/// Everyone who will get an email about this stream: the addresses subscribed
/// to it, plus the addresses of earners it has credited.
export function emailRecipients(stream: string, creditedEarners: readonly string[] = []): EmailSubscription[] {
  const wanted = new Set(creditedEarners.map((e) => e.toLowerCase()));
  return emailSubscriptions().filter(
    (s) => s.stream === stream.toLowerCase() || (s.earner !== undefined && wanted.has(s.earner)),
  );
}

/// WHO IS LISTENING TO THIS STREAM, in numbers only.
///
/// Counts, never addresses or chat ids: the page needs to say "your alerts are
/// on" and "one place left", and nothing it shows should let a stranger learn
/// who follows a stream. Everything the contract holds is already public; who
/// asked to be told about it is not.
export function alertAudience(stream: string): { telegram: number; email: number; emailSlots: number } {
  const email = countEmailSubscribers(stream);
  return {
    telegram: subscribersOf(stream).length,
    email,
    emailSlots: Math.max(0, MAX_EMAILS_PER_STREAM - email),
  };
}

/// At most this many addresses per stream, so one stream cannot spend the
/// day's whole send budget. It lives here, beside the count it bounds, because
/// two places now read it.
export const MAX_EMAILS_PER_STREAM = 2;

export const countEmailSubscribers = (stream: string): number =>
  emailSubscriptions().filter((s) => s.stream === stream.toLowerCase()).length;

export function emailSubscribe(address: string, target: EmailTarget, role: EmailRole): void {
  append({
    event: 'subscribed',
    channel: 'email',
    address: address.toLowerCase(),
    role,
    ...(target.kind === 'stream' ? { stream: target.id.toLowerCase() } : { earner: target.id.toLowerCase() }),
  });
}

export function emailUnsubscribe(address: string, target: EmailTarget): void {
  append({
    event: 'unsubscribed',
    channel: 'email',
    address: address.toLowerCase(),
    ...(target.kind === 'stream' ? { stream: target.id.toLowerCase() } : { earner: target.id.toLowerCase() }),
  });
}

/// Every earner id a stream has credited, from the verdict ledger. Used to
/// find the earner-followers of a stream whose milestone is ending.
export function earnersCreditedBy(stream: string): string[] {
  const out = new Set<string>();
  try {
    for (const line of readFileSync(ledgerPath('verdicts.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as Row;
        if (r.event === 'unlocked' && typeof r.earnerId === 'string' && typeof r.workStream === 'string' && r.workStream.toLowerCase() === stream.toLowerCase()) {
          out.add(r.earnerId.toLowerCase());
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

/// How many emails have gone out today, so a free sending tier is respected
/// rather than discovered from a rejection.
export function emailsSentToday(all: readonly Row[] = rows(), today = new Date().toISOString().slice(0, 10)): number {
  return all.filter((r) => r.event === 'emailed' && typeof r.at === 'string' && r.at.startsWith(today)).length;
}

/// Judgments only: the timed alerts are exempt from the per-stream ration.
/// There are exactly four of them in a stream's life and each one is the
/// reason somebody subscribed, so a counter must never be what drops them.
export function judgmentEmailsSentTodayFor(
  stream: string,
  all: readonly Row[] = rows(),
  today = new Date().toISOString().slice(0, 10),
): number {
  return all.filter(
    (r) =>
      r.event === 'emailed' &&
      r.kind === 'unlocked' &&
      typeof r.at === 'string' &&
      r.at.startsWith(today) &&
      typeof r.stream === 'string' &&
      r.stream.toLowerCase() === stream.toLowerCase(),
  ).length;
}

/// And how many of those were about ONE stream. The fleet-wide ceiling alone
/// lets a busy stream spend the whole day's budget and leave every other
/// stream's deadline unannounced, which is the alert that matters most.
export function emailsSentTodayFor(
  stream: string,
  all: readonly Row[] = rows(),
  today = new Date().toISOString().slice(0, 10),
): number {
  return all.filter(
    (r) =>
      r.event === 'emailed' &&
      typeof r.at === 'string' &&
      r.at.startsWith(today) &&
      typeof r.stream === 'string' &&
      r.stream.toLowerCase() === stream.toLowerCase(),
  ).length;
}

export function markEmailed(address: string, stream: string, kind: string): void {
  append({ event: 'emailed', channel: 'email', address: address.toLowerCase(), stream: stream.toLowerCase(), kind });
}
