// EMAIL ALERTS, and the consent that has to come first.
//
// A chat id arrives from the person who owns it. An email address does not:
// anyone can type anyone's. So nothing is ever sent to an address until its
// owner has clicked a link we sent them, and every alert carries a working
// way out. Both are legal requirements in most places, not polish.
//
// THE STATE IS A SIGNED TOKEN, NOT A ROW. An unconfirmed address is not
// written anywhere: the confirmation link carries the address, the target and
// an expiry, signed, and only the click writes a subscription. That way a
// stranger typing somebody's address leaves nothing behind but one email.
//
// Deliberately vendor-neutral: EMAIL_API_URL, EMAIL_API_KEY and EMAIL_FROM are
// the whole surface, and any provider taking {from,to,subject,text,headers}
// works. No provider name appears anywhere in this repository.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';
import { alertsSentFor, countEmailSubscribers, emailSubscribe, emailUnsubscribe } from './subscriptions';

type Logger = (entry: Record<string, unknown>) => void;

/// How long a confirmation link lives. Long enough to find the email in a spam
/// folder tomorrow, short enough that a leaked link is not a standing key.
const TOKEN_TTL_SECONDS = 48 * 3600;

/// At most this many addresses per stream, so one stream cannot spend the
/// day's whole send budget.
export const MAX_EMAILS_PER_STREAM = 2;

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const looksLikeEmail = (value: string) => ADDRESS.test(value.trim()) && value.length <= 254;

/// The secret the links are signed with. Reuses the webhook secret rather than
/// adding another: it is already required, already strong, and already lives
/// only on this host. A token signed with it proves the link came from here.
const secret = () => env.webhookSecret;

export type Target = { kind: 'stream'; id: string } | { kind: 'earner'; id: string };

/// `<action>.<kind>.<id>.<address>.<expires>.<signature>`, base64url for the
/// address so an email with a dot in it cannot split the token.
export function signToken(action: 'confirm' | 'stop', target: Target, address: string, expiresAt: number): string {
  const body = `${action}.${target.kind}.${target.id.toLowerCase()}.${Buffer.from(address.toLowerCase()).toString('base64url')}.${expiresAt}`;
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}

export function verifyToken(token: string, now = Math.floor(Date.now() / 1000)):
  | { action: 'confirm' | 'stop'; target: Target; address: string }
  | { error: string } {
  const parts = token.split('.');
  if (parts.length !== 6) return { error: 'that link is not one of ours' };
  const [action, kind, id, encoded, expires, signature] = parts;
  const body = `${action}.${kind}.${id}.${encoded}.${expires}`;
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: 'that link is not one of ours' };
  if (Number(expires) < now) return { error: 'that link has expired; ask for a new one' };
  if (action !== 'confirm' && action !== 'stop') return { error: 'that link is not one of ours' };
  if (kind !== 'stream' && kind !== 'earner') return { error: 'that link is not one of ours' };
  return { action, target: { kind, id }, address: Buffer.from(encoded, 'base64url').toString() };
}

/// One email. Never throws to the caller's caller: a failed alert is a log
/// line, and the thing it was about has already happened.
export async function sendEmail(to: string, subject: string, text: string, unsubscribeUrl?: string): Promise<void> {
  if (!env.emailApiUrl || !env.emailApiKey || !env.emailFrom) throw new Error('email is not configured');
  const res = await fetch(env.emailApiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.emailApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [to],
      subject,
      text,
      // One-click unsubscribe, which is what keeps mail out of spam folders
      // as much as it is a courtesy.
      ...(unsubscribeUrl
        ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`email send ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const confirmUrl = (token: string) => `${env.appUrl}/alerts/confirm?t=${token}`;
export const stopUrl = (target: Target, address: string) =>
  `${env.appUrl}/alerts/confirm?t=${signToken('stop', target, address, Math.floor(Date.now() / 1000) + 365 * 24 * 3600)}`;

/// Ask an address to confirm. Returns what to tell the person, and never says
/// whether the address was already subscribed: that would turn this into a
/// way to test whether somebody follows a stream.
export async function requestSubscription(log: Logger, address: string, target: Target): Promise<{ ok: boolean; message: string }> {
  if (!env.emailApiUrl || !env.emailApiKey || !env.emailFrom) {
    return { ok: false, message: 'Email alerts are not configured on this deployment.' };
  }
  if (!looksLikeEmail(address)) return { ok: false, message: 'That does not look like an email address.' };

  if (target.kind === 'stream' && countEmailSubscribers(target.id) >= MAX_EMAILS_PER_STREAM) {
    return { ok: false, message: `This stream already has ${MAX_EMAILS_PER_STREAM} email subscribers, which is the limit. Telegram has no limit.` };
  }

  const token = signToken('confirm', target, address, Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS);
  const what = target.kind === 'stream' ? `stream ${target.id}` : 'your earnings';
  try {
    await sendEmail(
      address,
      'Confirm your ProofStream alerts',
      [
        `Somebody asked for ProofStream alerts about ${what} to be sent here.`,
        '',
        'If it was you, confirm with this link. Nothing is sent until you do:',
        confirmUrl(token),
        '',
        'If it was not you, ignore this. Your address was not stored and you will hear nothing more.',
      ].join('\n'),
    );
    log({ event: 'email_confirmation_sent', target: target.kind, id: target.id });
    return { ok: true, message: 'Check your email and confirm the link. Nothing is sent until you do.' };
  } catch (err) {
    log({ event: 'email_failed', message: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: 'The confirmation could not be sent. Try again shortly.' };
  }
}

/// A click on a confirm or stop link.
export function actOnToken(log: Logger, token: string): { ok: boolean; title: string; message: string } {
  const parsed = verifyToken(token);
  if ('error' in parsed) return { ok: false, title: 'THAT LINK DID NOT WORK', message: parsed.error };

  if (parsed.action === 'stop') {
    emailUnsubscribe(parsed.address, parsed.target);
    log({ event: 'email_unsubscribed', target: parsed.target.kind });
    return { ok: true, title: 'UNSUBSCRIBED', message: 'You will get no further email about this. Nothing else changes.' };
  }

  if (parsed.target.kind === 'stream' && countEmailSubscribers(parsed.target.id) >= MAX_EMAILS_PER_STREAM) {
    return {
      ok: false,
      title: 'THIS STREAM IS FULL',
      message: `A stream takes ${MAX_EMAILS_PER_STREAM} email subscribers and both places were taken before you confirmed. Telegram has no limit.`,
    };
  }

  emailSubscribe(parsed.address, parsed.target);
  log({ event: 'email_subscribed', target: parsed.target.kind, id: parsed.target.id });
  return {
    ok: true,
    title: 'CONFIRMED',
    message:
      parsed.target.kind === 'stream'
        ? 'You will hear when work on this stream is certified or refused, a day and twelve hours before the milestone ends, and when its grace window starts. Every email has an unsubscribe link.'
        : 'You will hear when a stream certifies or refuses work of yours, and about that stream as its milestone ends. Every email has an unsubscribe link.',
  };
}

/// Alerts that go out by email. A SUBSET of what Telegram sends, chosen to
/// stay well inside a free sending tier: the two judgments that matter to a
/// contributor, the two warnings before a deadline, and the start of grace.
/// Not every grace hour, and not the resume or veto detail.
export const EMAIL_TIMED_KINDS = new Set(['ends-24h', 'ends-12h', 'ended']);
export const EMAIL_JUDGMENT_EVENTS = new Set(['unlocked', 'declined']);

/// Subject lines. Short enough to read whole in a notification, and each one
/// NAMES THE REPOSITORY: somebody following three streams reads the sender and
/// the subject and nothing else, so "milestone ends in 24 hours" alone makes
/// them open the mail to find out which.
export function emailSubject(kind: string, repo?: string): string {
  const where = repo ? ` · ${repo}` : '';
  switch (kind) {
    case 'unlocked':
      return `ProofStream: work certified${where}`;
    case 'declined':
      return `ProofStream: work refused${where}`;
    case 'ends-24h':
      return `ProofStream: 24 hours left${where}`;
    case 'ends-12h':
      return `ProofStream: 12 hours left${where}`;
    case 'ended':
      return `ProofStream: milestone ended, grace window open${where}`;
    default:
      return `ProofStream${where}`;
  }
}

/// THE BODY. Plain text, because an alert that renders as a wall of HTML in a
/// phone's preview defeats the point, and because a payments notification that
/// looks like marketing is the shape people have been taught to distrust.
///
/// Four parts, in the order they are read: what happened, which stream, where
/// to look, and why this arrived with the way out. The sentence is the same one
/// Telegram carries; everything around it is what an inbox needs and a chat
/// does not, since a chat already knows which conversation it is.
export function emailBody(opts: {
  sentence: string;
  repo?: string;
  milestoneIndex?: number;
  link: string;
  because: string;
  stopUrl: string;
}): string {
  const where = [opts.repo, opts.milestoneIndex !== undefined ? `milestone ${opts.milestoneIndex}` : null]
    .filter(Boolean)
    .join(' · ');
  return [
    opts.sentence,
    '',
    ...(where ? [where] : []),
    opts.link,
    '',
    `You are getting this because somebody confirmed alerts about ${opts.because} to this address.`,
    `Stop them: ${opts.stopUrl}`,
  ].join('\n');
}

/// Whether this stream has already had an email in the coalescing window.
/// Reuses the alert ledger: an `email-<hour>` mark per stream.
export function emailWindowKey(now = Date.now()): string {
  return `email-${Math.floor(now / 3600_000)}`;
}

export const emailedThisHour = (stream: string, now?: number) => alertsSentFor(stream).has(emailWindowKey(now));
