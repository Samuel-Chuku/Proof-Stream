// WHAT SUBSCRIBERS ARE TOLD, AND WHEN.
//
// Two kinds of alert. JUDGMENT alerts fire when the pipeline records an
// outcome: certified, resumed, held, refused, vetoed. TIMED alerts fire on the
// milestone's clock: a day out, twelve hours out, at the end, then every hour
// of the grace window, then when the grace has run and the employer may close.
//
// The grace window is the one that matters. It is the last chance for merged
// work to be certified and paid; after it the employer closes and reclaims
// whatever was not certified. Nobody was told it was running, which is how four
// live-test streams expired unwatched.
//
// Timed alerts are computed from the contract's own `milestoneEndsAt`, read
// for every stream ANYBODY follows, not from the registry's list, because the
// registry drops a stream at exactly the moment the last alert is about. Each
// kind fires once, recorded in the subscriptions ledger so a restart does not
// repeat it.
import { readIdentity } from './chain';
import { EMAIL_JUDGMENT_EVENTS, EMAIL_TIMED_KINDS, emailBody, emailSubject, emailWindowKey, sendEmail, stopUrl } from './email';
import { env } from './env';
import {
  adoptEarnerFollows,
  alertsSentFor,
  earnersCreditedBy,
  emailRecipients,
  emailsSentToday,
  emailsSentTodayFor,
  markAlerted,
  markEmailed,
  subscribedStreams,
  emailSubscriptions,
} from './subscriptions';
import { broadcast } from './telegram';

type Logger = (entry: Record<string, unknown>) => void;

const HOUR = 3600;

/// The timed alert kinds, in the order they come due, and the text for each.
/// `due` is seconds relative to the milestone's end (negative = before).
export function timedAlerts(graceHours: number): { kind: string; due: number; text: (link: string) => string }[] {
  const grace: { kind: string; due: number; text: (link: string) => string }[] = [];
  for (let h = 1; h < graceHours; h++) {
    grace.push({
      kind: `grace-${h}h`,
      due: h * HOUR,
      text: (link) =>
        `Grace: ${graceHours - h} hour${graceHours - h === 1 ? '' : 's'} left for merged work to be certified on this stream. ${link}`,
    });
  }
  return [
    { kind: 'ends-24h', due: -24 * HOUR, text: (link) => `This stream's milestone ends in 24 hours. Work merged after that has ${graceHours} hours of grace to be certified. ${link}` },
    { kind: 'ends-12h', due: -12 * HOUR, text: (link) => `This stream's milestone ends in 12 hours. ${link}` },
    { kind: 'ended', due: 0, text: (link) => `This stream's milestone has ended. The agent keeps certifying merged work for ${graceHours} more hours, then the employer may close it and reclaim what was not certified. ${link}` },
    ...grace,
    { kind: 'closable', due: graceHours * HOUR, text: (link) => `The grace window on this stream has run. Anything certified is owed and stays withdrawable; the employer may now close the milestone and reclaim the rest. ${link}` },
  ];
}

/// Which alerts are due now and not yet sent. Pure, so it is tested.
///
/// An alert whose moment passed while nobody was listening is NOT sent late:
/// "ends in 24 hours" a day after the end is noise, and the `ended` alert
/// already covers "it ended". The window is one sweep, plus a margin.
export function dueAlerts(
  endsAt: number,
  now: number,
  sent: ReadonlySet<string>,
  graceHours: number,
  windowSeconds: number,
): { kind: string; text: (link: string) => string }[] {
  if (endsAt <= 0) return [];
  return timedAlerts(graceHours).filter((a) => {
    const at = endsAt + a.due;
    return !sent.has(a.kind) && now >= at && now - at <= windowSeconds;
  });
}

/// EMAIL, WHICH IS RATIONED. Telegram is free and instant, so it says
/// everything; email costs and lands in a place people guard, so it says less:
/// only the kinds in EMAIL_TIMED_KINDS and EMAIL_JUDGMENT_EVENTS, at most one
/// per stream per hour, and never past the day's ceiling. When the window has
/// already been used, the alert is simply not emailed; Telegram still carried
/// it, and a second email an hour later saying the same thing is what makes
/// people unsubscribe.
async function email(
  log: Logger,
  stream: string,
  kind: string,
  sentence: string,
  where: { repo?: string; milestoneIndex?: number },
): Promise<void> {
  if (!env.emailApiUrl) return;
  if (!EMAIL_TIMED_KINDS.has(kind) && !EMAIL_JUDGMENT_EVENTS.has(kind)) return;

  const window = emailWindowKey();
  if (alertsSentFor(stream).has(window)) {
    log({ event: 'email_coalesced', stream, kind, reason: 'this stream already sent an email this hour' });
    return;
  }

  const recipients = emailRecipients(stream, earnersCreditedBy(stream));
  if (recipients.length === 0) return;

  // TWO CEILINGS, and they answer different failures. The fleet-wide one keeps
  // a free sending tier intact. The per-stream one is what stops a busy stream
  // spending the whole day's budget, which would silently cost every OTHER
  // stream its deadline warning: the alert people actually need.
  const forThisStream = emailsSentTodayFor(stream);
  if (forThisStream + recipients.length > env.emailMaxPerStreamPerDay) {
    log({ event: 'email_held', stream, kind, sentToday: forThisStream, reason: `this stream's ceiling of ${env.emailMaxPerStreamPerDay} a day would be passed` });
    return;
  }
  const sentToday = emailsSentToday();
  if (sentToday + recipients.length > env.emailDailyMax) {
    log({ event: 'email_held', stream, kind, sentToday, reason: `the daily ceiling of ${env.emailDailyMax} across all streams would be passed` });
    return;
  }

  // Marked before sending, so a crash cannot turn one alert into a repeat.
  markAlerted(stream, window);
  const link = `${env.appUrl}/stream/${stream}`;
  for (const r of recipients) {
    const target = r.stream ? ({ kind: 'stream', id: r.stream } as const) : ({ kind: 'earner', id: r.earner as string } as const);
    const stop = stopUrl(target, r.address);
    try {
      await sendEmail(
        r.address,
        emailSubject(kind, where.repo),
        emailBody({
          sentence,
          repo: where.repo,
          milestoneIndex: where.milestoneIndex,
          link,
          because: target.kind === 'stream' ? 'this stream' : 'your earnings',
          stopUrl: stop,
        }),
        stop,
      );
      markEmailed(r.address, stream, kind);
    } catch (err) {
      log({ event: 'email_failed', stream, kind, message: err instanceof Error ? err.message : String(err) });
    }
  }
  log({ event: 'emailed', stream, kind, recipients: recipients.length });
}

/// How often the clock is checked. The alerts are on the hour, so a minute is
/// plenty and the window above is a few of them.
const TICK_MS = 60_000;
const WINDOW_SECONDS = 5 * 60;

/// Check every followed stream's clock, for ever. Returns at once.
export function startAlerts(log: Logger): void {
  if (!env.telegramBotToken && !env.emailApiUrl) return;

  const tick = async () => {
    const now = Math.floor(Date.now() / 1000);
    // Every stream anybody follows, on either channel.
    const streams = new Set([
      ...subscribedStreams(),
      ...emailSubscriptions().flatMap((s) => (s.stream ? [s.stream] : [])),
    ]);
    for (const stream of streams) {
      try {
        const identity = await readIdentity(stream as `0x${string}`);
        if (identity.closed) continue;
        const link = `${env.appUrl}/stream/${stream}`;
        for (const a of dueAlerts(Number(identity.endsAt), now, alertsSentFor(stream), env.milestoneGraceHours, WINDOW_SECONDS)) {
          // Marked BEFORE sending, so a crash mid-broadcast cannot turn one
          // alert into a repeat. A lost alert is cheaper than a nagging one.
          markAlerted(stream, a.kind);
          await broadcast(log, stream, a.text(link));
          await email(log, stream, a.kind, a.text(link), { repo: identity.repo });
          log({ event: 'alerted', stream, kind: a.kind });
        }
      } catch (err) {
        log({ event: 'alert_failed', stream, message: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}

/// The judgment alerts: one line per outcome, in the ledger's own words,
/// with the figures a subscriber asked to hear.
export function judgmentText(entry: Record<string, unknown>, link: string): string | null {
  const pr = typeof entry.pr === 'number' ? `PR #${entry.pr}` : 'a pull request';
  switch (entry.event) {
    case 'unlocked':
      return entry.resumed
        ? `Certification resumed to ${entry.certifiedPercent}% of the milestone, ${entry.trancheUsdc} USDC more owed. ${link}`
        : `Certified: ${pr} brings the milestone to ${entry.certifiedPercent}%, ${entry.trancheUsdc} USDC more owed. ${link}`;
    case 'unlock_failed':
      return `A certification for ${pr} did not reach the chain. ${link}`;
    case 'declined':
      return `Refused: ${pr} was judged and earns nothing. ${link}`;
    case 'vetoed':
      return `Held: the verifier disagreed with the attestor on ${pr}, so nothing was certified. ${link}`;
    case 'escalated':
      return `Held: the agent was not confident enough about ${pr} to certify. ${link}`;
    default:
      return null;
  }
}

/// Called by the ledger writer for every row it writes.
export function onLedgerRow(log: Logger, entry: Record<string, unknown>): void {
  if ((!env.telegramBotToken && !env.emailApiUrl) || typeof entry.workStream !== 'string') return;
  // A certification that credits somebody makes their followers this
  // stream's followers, BEFORE the broadcast, so the message that says they
  // were paid is the first one they get.
  if (entry.event === 'unlocked' && typeof entry.earnerId === 'string') {
    adoptEarnerFollows(entry.workStream, entry.earnerId);
  }
  const text = judgmentText(entry, `${env.appUrl}/stream/${entry.workStream}`);
  if (!text) return;
  void broadcast(log, entry.workStream, text);
  void email(log, entry.workStream, String(entry.event), text, {
    repo: typeof entry.repo === 'string' ? entry.repo : undefined,
    milestoneIndex: typeof entry.milestoneIndex === 'number' ? entry.milestoneIndex : undefined,
  });
}
