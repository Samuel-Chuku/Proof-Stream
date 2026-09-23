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
import { earnerId } from '@proofstream/config';
import { verifyMessage } from 'viem';
import { readEmployer } from './chain';
import { env } from './env';
import {
  alertsSentFor,
  countEmailSubscribers,
  emailSubscribe,
  emailUnsubscribe,
  streamsCrediting,
  type EmailRole,
} from './subscriptions';

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

/// WHO IS ALLOWED TO GET EMAIL, and how they prove it.
///
/// Telegram is free and open to anyone: a chat id costs nothing and arrives
/// with consent. Email costs money and lands somewhere people guard, so it
/// goes only to the two parties with a stake, each proving it the way their
/// side actually can:
///
///   contributor  a GitHub token, checked with GitHub, whose earner id this
///                stream has already credited. The same proof that binds a
///                payee, so it is as strong as the money path.
///   employer     a signature from the address the contract itself calls
///                `employer`. Immutable, verifiable on chain, no gas.
///
/// Anyone else is told to use Telegram. That is also what keeps a stranger
/// from spending the day's send budget.
export type Proof =
  | { role: 'contributor'; githubToken: string }
  | { role: 'employer'; address: string; signature: string; issuedAt: number };

/// What an employer signs. Plain text a wallet will show them, naming the
/// stream and the moment, so a signature lifted from elsewhere is useless.
export function employerMessage(stream: string, address: string, issuedAt: number): string {
  return [
    'ProofStream: email alerts',
    `stream: ${stream.toLowerCase()}`,
    `address: ${address.toLowerCase()}`,
    `issued: ${issuedAt}`,
    'Signing this proves you control the employer address. It moves no money.',
  ].join('\n');
}

/// Five minutes: long enough to read a wallet prompt, short enough that a
/// signature left in a log is not a standing key.
const SIGNATURE_TTL_SECONDS = 300;

/// Who GitHub says a token belongs to. Undefined on any failure: a revoked
/// token must refuse, never fall through.
async function githubUser(token: string): Promise<number | undefined> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'proofstream-attestor' },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'number' ? body.id : undefined;
  } catch {
    return undefined;
  }
}

/// Check a proof against the target. Returns the role, or why not.
export async function checkProof(target: Target, proof: Proof): Promise<{ role: EmailRole } | { error: string }> {
  if (proof.role === 'employer') {
    if (target.kind !== 'stream') return { error: 'the employer of a stream can only follow that stream.' };
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - proof.issuedAt) > SIGNATURE_TTL_SECONDS) return { error: 'that signature has expired. Try again.' };
    let ok = false;
    try {
      ok = await verifyMessage({
        address: proof.address as `0x${string}`,
        message: employerMessage(target.id, proof.address, proof.issuedAt),
        signature: proof.signature as `0x${string}`,
      });
    } catch {
      ok = false;
    }
    if (!ok) return { error: 'that signature does not match that address.' };
    const employer = await readEmployer(target.id as `0x${string}`);
    if (employer.toLowerCase() !== proof.address.toLowerCase()) {
      return { error: 'that address does not own this stream. Use Telegram to follow a stream you do not own.' };
    }
    return { role: 'employer' };
  }

  const id = await githubUser(proof.githubToken);
  if (id === undefined) return { error: 'GitHub did not recognise that sign-in.' };
  const earner = earnerId('github', id);
  const credited = streamsCrediting(earner);
  if (credited.length === 0) {
    return { error: 'no stream has credited this GitHub account yet. Telegram alerts are open to anyone.' };
  }
  if (target.kind === 'stream' && !credited.includes(target.id.toLowerCase())) {
    return { error: 'this stream has not credited that GitHub account. Telegram alerts are open to anyone.' };
  }
  return { role: 'contributor' };
}

/// `<action>.<kind>.<id>.<address>.<expires>.<role>.<signature>`, base64url
/// for the address so an email with a dot in it cannot split the token. The
/// ROLE rides along because the proof was checked when the link was made, and
/// checking it again at the click would mean asking for a wallet signature or
/// a GitHub session the person no longer has in front of them.
export function signToken(
  action: 'confirm' | 'stop',
  target: Target,
  address: string,
  expiresAt: number,
  role: EmailRole = 'contributor',
): string {
  const body = `${action}.${target.kind}.${target.id.toLowerCase()}.${Buffer.from(address.toLowerCase()).toString('base64url')}.${expiresAt}.${role}`;
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}

export function verifyToken(token: string, now = Math.floor(Date.now() / 1000)):
  | { action: 'confirm' | 'stop'; target: Target; address: string; role: EmailRole }
  | { error: string } {
  const parts = token.split('.');
  if (parts.length !== 7) return { error: 'that link is not one of ours' };
  const [action, kind, id, encoded, expires, role, signature] = parts;
  const body = `${action}.${kind}.${id}.${encoded}.${expires}.${role}`;
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: 'that link is not one of ours' };
  if (Number(expires) < now) return { error: 'that link has expired; ask for a new one' };
  if (action !== 'confirm' && action !== 'stop') return { error: 'that link is not one of ours' };
  if (kind !== 'stream' && kind !== 'earner') return { error: 'that link is not one of ours' };
  if (role !== 'contributor' && role !== 'employer') return { error: 'that link is not one of ours' };
  return { action, target: { kind, id }, address: Buffer.from(encoded, 'base64url').toString(), role };
}

/// One email. Never throws to the caller's caller: a failed alert is a log
/// line, and the thing it was about has already happened.
export async function sendEmail(to: string, subject: string, text: string, unsubscribeUrl?: string, html?: string): Promise<void> {
  if (!env.emailApiUrl || !env.emailApiKey || !env.emailFrom) throw new Error('email is not configured');
  const res = await fetch(env.emailApiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.emailApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
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
export async function requestSubscription(
  log: Logger,
  address: string,
  target: Target,
  proof: Proof,
): Promise<{ ok: boolean; message: string }> {
  if (!env.emailApiUrl || !env.emailApiKey || !env.emailFrom) {
    return { ok: false, message: 'Email alerts are not configured on this deployment.' };
  }
  if (!looksLikeEmail(address)) return { ok: false, message: 'That does not look like an email address.' };

  // THE GATE, before anything is sent. Email goes to the two parties with a
  // stake, and each proves it; everybody else has Telegram, which is free.
  const checked = await checkProof(target, proof);
  if ('error' in checked) return { ok: false, message: checked.error };
  const role = checked.role;

  if (target.kind === 'stream' && countEmailSubscribers(target.id) >= MAX_EMAILS_PER_STREAM) {
    return { ok: false, message: `This stream already has ${MAX_EMAILS_PER_STREAM} email subscribers, which is the limit. Telegram has no limit.` };
  }

  const token = signToken('confirm', target, address, Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS, role);
  const what = target.kind === 'stream' ? `stream ${target.id}` : 'your earnings';
  try {
    const sentence = `Somebody asked for ProofStream alerts about ${what} to be sent here. Nothing is sent until you confirm.`;
    await sendEmail(
      address,
      'Confirm your ProofStream alerts',
      [
        sentence,
        '',
        `Confirm: ${confirmUrl(token)}`,
        '',
        'If it was not you, ignore this. Your address was not stored and you will hear nothing more.',
      ].join('\n'),
      undefined,
      renderHtml({
        heading: 'CONFIRM YOUR ALERTS',
        sentence,
        action: { label: 'CONFIRM THESE ALERTS', href: confirmUrl(token) },
        footer: 'If it was not you, ignore this. Your address was not stored and you will hear nothing more.',
      }),
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

  emailSubscribe(parsed.address, parsed.target, parsed.role);
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

/// WHAT GOES BY EMAIL, AND TO WHICH SIDE.
///
/// A subset of what Telegram carries, and each kind addressed to the people it
/// is actually for. A refusal is deliberately absent: it is the one alert that
/// is never good news and never actionable by email, and the pull request
/// already says it. A resume, a veto and the hourly grace countdown stay on
/// Telegram, where another message costs nothing.
export const EMAIL_KINDS: Record<string, EmailRole[]> = {
  /// Accepted certifications only. The contributor is owed more; the employer
  /// has spent more.
  unlocked: ['contributor', 'employer'],
  'ends-24h': ['contributor', 'employer'],
  'ends-12h': ['contributor'],
  /// The grace window opening is a contributor's last chance to have merged
  /// work certified.
  ended: ['contributor', 'employer'],
  /// And its closing is the employer's moment: they may close and reclaim.
  closable: ['employer'],
};

export const EMAIL_TIMED_KINDS = new Set(['ends-24h', 'ends-12h', 'ended', 'closable']);
export const EMAIL_JUDGMENT_EVENTS = new Set(['unlocked']);
export const rolesFor = (kind: string): EmailRole[] => EMAIL_KINDS[kind] ?? [];

/// Subject lines. Short enough to read whole in a notification, and each one
/// NAMES THE REPOSITORY: somebody following three streams reads the sender and
/// the subject and nothing else, so "milestone ends in 24 hours" alone makes
/// them open the mail to find out which.
export function emailSubject(kind: string, repo?: string): string {
  const where = repo ? ` · ${repo}` : '';
  switch (kind) {
    case 'unlocked':
      return `ProofStream: work certified${where}`;
    case 'ends-24h':
      return `ProofStream: 24 hours left${where}`;
    case 'ends-12h':
      return `ProofStream: 12 hours left${where}`;
    case 'ended':
      return `ProofStream: grace window open${where}`;
    case 'closable':
      return `ProofStream: grace window closed${where}`;
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

// ------------------------------------------------------------------ html
//
// WHY THIS LOOKS LIKE 2004. Mail clients are not browsers: several strip
// <style> blocks entirely, most ignore flexbox and grid, and one major desktop
// client still renders through a word processor. So the layout is a table, the
// styles are inline, and the whole thing is one column that survives being
// squeezed to 320px. Every email also carries the plain-text part above, which
// is what a watch, a terminal client and a spam filter actually read.
//
// The palette is the app's own: paper, ink, and the one green, used ONLY on a
// certification, where it means the same thing it means everywhere else in
// this product. A deadline warning is ink on paper.
const PAPER = '#EFEDE3';
const SURFACE = '#F0F0F0';
const INK = '#333333';
const DIM = '#666666';
const RULE = '#CCCCCC';
const GREEN = '#00FF00';
const GREEN_DEEP = '#00CC00';

/// THE MARK, BUILT OUT OF TABLE CELLS. No image file and no SVG: most clients
/// hide remote images until a reader asks, and one major provider strips
/// inline SVG entirely, so a logo drawn either way is a blank space on first
/// open. Ours is four rectangles, which is the one kind of logo a mail client
/// renders perfectly, every time, with images off.
///
/// The geometry is the favicon's: four ascending bars, the lower two green.
/// That is the product's own stream bar, and it means the same here as it does
/// on a stream page, outlined for certified and still arriving, green for
/// released. Do not recolour the ink bars.
function markHtml(): string {
  const bar = (indent: number, colour: string, border: string) =>
    `<tr><td style="padding:0 0 4px ${indent}px"><div style="width:34px;height:10px;background:${colour};border:1px solid ${border};font-size:0;line-height:0">&nbsp;</div></td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    ${bar(0, INK, INK)}
    ${bar(6, INK, INK)}
    ${bar(12, GREEN, GREEN_DEEP)}
    ${bar(18, GREEN, GREEN_DEEP)}
  </table>`;
}

const escape = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

export function renderHtml(o: {
  heading: string;
  sentence: string;
  /// Repository and milestone, shown as the ledger line the app uses.
  where?: string;
  action: { label: string; href: string };
  /// Certifications get the green key; everything else is ink.
  accent?: boolean;
  footer: string;
  stopUrl?: string;
}): string {
  const button = `<a href="${escape(o.action.href)}" style="display:inline-block;padding:12px 20px;background:${o.accent ? GREEN : PAPER};color:${INK};border:2px solid ${INK};box-shadow:4px 4px 0 0 ${INK};font:700 13px/1 ${MONO};letter-spacing:1px;text-decoration:none">[ ${escape(o.action.label)} ]</a>`;

  return `<!doctype html><html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:${PAPER}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${SURFACE};border:2px solid ${INK};box-shadow:4px 4px 0 0 ${INK}">
  <tr><td style="padding:24px 24px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:12px" valign="middle">${markHtml()}</td>
      <td valign="middle" style="font:700 15px/1.2 ${MONO};letter-spacing:3px;color:${INK}">PROOFSTREAM</td>
    </tr></table>
    <div style="font:700 20px/1.3 ${MONO};letter-spacing:1px;color:${INK};padding-top:16px">${escape(o.heading)}</div>
  </td></tr>
  <tr><td style="padding:16px 24px 0">
    <div style="border-top:1px solid ${RULE}"></div>
  </td></tr>
  <tr><td style="padding:16px 24px 0;font:16px/1.6 ${MONO};color:${INK}">${escape(o.sentence)}</td></tr>
  ${o.where ? `<tr><td style="padding:12px 24px 0;font:13px/1.5 ${MONO};color:${DIM}">${escape(o.where)}</td></tr>` : ''}
  <tr><td style="padding:24px 24px 8px">${button}</td></tr>
  <tr><td style="padding:16px 24px 24px;font:12px/1.6 ${MONO};color:${DIM}">
    ${escape(o.footer)}${o.stopUrl ? `<br><a href="${escape(o.stopUrl)}" style="color:${DIM}">Stop these emails</a>` : ''}
  </td></tr>
</table>
<div style="max-width:560px;padding-top:12px;font:11px/1.5 ${MONO};color:${DIM};text-align:left">Arc Testnet · nothing here asks you to sign or approve anything.</div>
</td></tr></table></body></html>`;
}

/// Whether this stream has already had an email in the coalescing window.
/// Reuses the alert ledger: an `email-<hour>` mark per stream.
export function emailWindowKey(now = Date.now()): string {
  return `email-${Math.floor(now / 3600_000)}`;
}

export const emailedThisHour = (stream: string, now?: number) => alertsSentFor(stream).has(emailWindowKey(now));
