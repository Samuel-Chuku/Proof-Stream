'use client';

import { useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { EmailIcon, TelegramIcon } from './channel-marks';

/// What an employer signs. Must match the agent's `employerMessage` exactly,
/// byte for byte, or the signature recovers to nothing.
function employerMessage(stream: string, address: string, issuedAt: number): string {
  return [
    'ProofStream: email alerts',
    `stream: ${stream.toLowerCase()}`,
    `address: ${address.toLowerCase()}`,
    `issued: ${issuedAt}`,
    'Signing this proves you control the employer address. It moves no money.',
  ].join('\n');
}

/// GET UPDATES, on the masthead strip beside the address and the chain.
///
/// Two marks, no prose. Telegram is a link straight into the bot, because
/// tapping it IS the subscription. Email needs an address and a confirmation,
/// so it opens the smallest modal that can take one.
///
/// Renders nothing at all when neither channel is configured on a deployment.
export function GetUpdates({
  /// The stream address, or an earner id, that the alert is about.
  target,
  kind,
  /// The stream's employer, so the owner's route can be offered to the wallet
  /// that actually owns it and to nobody else.
  employer,
  /// Whether a GitHub session exists, for the contributor's route.
  signedIn = false,
  /// Who is already listening, in numbers. Null when the agent cannot be
  /// reached, which hides the counts and changes nothing else.
  status = null,
}: {
  target: string;
  kind: 'stream' | 'earner';
  employer?: string;
  signedIn?: boolean;
  status?: {
    telegram: number;
    email: number;
    emailSlots: number;
    channels: { telegram: boolean; email: boolean };
  } | null;
}) {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  const { address: wallet } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  /// Counted down after a confirmation is sent, then the modal closes itself.
  /// A dialog that stays open after it has done its job reads as a dialog that
  /// failed, which is exactly what happened the first time this was used.
  const [closing, setClosing] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (closing <= 0) return;
    const t = setTimeout(() => {
      if (closing === 1) {
        setOpen(false);
        setOk(false);
        setSaid(null);
      }
      setClosing(closing - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [closing]);

  const isOwner = Boolean(employer && wallet && employer.toLowerCase() === wallet.toLowerCase());

  async function subscribe(role: 'contributor' | 'employer') {
    setBusy(true);
    setSaid(null);
    try {
      let extra: Record<string, unknown> = {};
      if (role === 'employer') {
        // The wallet prompt is the proof. Nothing is sent until it is signed,
        // and a dismissed prompt is not an error worth shouting about.
        const issuedAt = Math.floor(Date.now() / 1000);
        const signature = await signMessageAsync({ message: employerMessage(target, wallet as string, issuedAt) });
        extra = { role: 'employer', signer: wallet, signature, issuedAt };
      }
      const res = await fetch('/api/alerts/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, kind, id: target, ...extra }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string };
      setOk(Boolean(body.ok));
      setSaid(body.message ?? 'Something went wrong.');
      if (body.ok) {
        setAddress('');
        setClosing(4);
      }
    } catch (err) {
      setOk(false);
      setSaid(
        /reject|denied|cancel/i.test(err instanceof Error ? err.message : '')
          ? 'You dismissed the signature. Nothing was sent.'
          : 'The request did not get through. Try again shortly.',
      );
    } finally {
      setBusy(false);
    }
  }

  // The Telegram payload: a stream address as it is, an earner id without its
  // 0x, which is the 64 characters a deep link can carry.
  const payload = kind === 'stream' ? target : target.replace(/^0x/, '');
  const live = (status?.telegram ?? 0) + (status?.email ?? 0) > 0;

  return (
    <>
      {/* A MARK THAT IS ALREADY ON LOOKS ON. Somebody who subscribed should be
          able to tell from the strip, without opening anything; and an owner
          checking their own stream should not have to guess whether it worked. */}
      <span className="ps-updates">
        <span className="ps-updates-label">{live ? 'UPDATES ON' : 'GET UPDATES'}</span>
        {bot && (
          <a
            className={`ps-updates-mark${(status?.telegram ?? 0) > 0 ? ' ps-updates-mark-on' : ''}`}
            href={`https://t.me/${bot}?start=${payload}`}
            target="_blank"
            rel="noreferrer"
            title={
              (status?.telegram ?? 0) > 0
                ? `${status?.telegram} following on Telegram. Tap to follow it too.`
                : 'Alerts on Telegram'
            }
            aria-label="Alerts on Telegram"
          >
            <TelegramIcon />
          </a>
        )}
        <button
          type="button"
          className={`ps-updates-mark${(status?.email ?? 0) > 0 ? ' ps-updates-mark-on' : ''}`}
          onClick={() => setOpen(true)}
          title={
            (status?.email ?? 0) > 0
              ? `${status?.email} subscribed by email, ${status?.emailSlots} place${status?.emailSlots === 1 ? '' : 's'} left`
              : 'Alerts by email'
          }
          aria-label="Alerts by email"
        >
          <EmailIcon />
        </button>
      </span>

      {open && (
        <div className="ps-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div className="ps-modal" role="dialog" aria-modal="true" aria-label="Alerts by email" onClick={(e) => e.stopPropagation()}>
            <div className="ps-modal-head">
              <h2 className="ps-label">ALERTS BY EMAIL</h2>
              <button type="button" className="ps-chip" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="ps-modal-body">
              {ok ? (
                // THE JOB IS DONE, so the form goes. A dialog that keeps its
                // form after it has succeeded reads as a dialog that failed.
                <>
                  <p className="ps-body" style={{ margin: 0 }}>
                    {said}
                  </p>
                  <p className="ps-caption">CLOSING IN {closing}…</p>
                </>
              ) : (
                <>
                  {/* WHO IS ALREADY LISTENING, before anything is asked. The
                      first person to use this could not tell whether it had
                      worked, because the modal said nothing about the state it
                      was changing. Counts only: it names nobody. */}
                  {status && (
                    <p className="ps-caption ps-updates-state">
                      {status.channels.telegram && (
                        <span>
                          <TelegramIcon />{' '}
                          {status.telegram === 0
                            ? 'NOBODY FOLLOWING YET'
                            : `${status.telegram} FOLLOWING`}
                        </span>
                      )}
                      {status.channels.email && (
                        <span>
                          <EmailIcon />{' '}
                          {status.email === 0
                            ? 'NO EMAIL YET'
                            : `${status.email} BY EMAIL`}
                          {kind === 'stream' && ` · ${status.emailSlots} PLACE${status.emailSlots === 1 ? '' : 'S'} LEFT`}
                        </span>
                      )}
                    </p>
                  )}

                  <p className="ps-caption">
                    {kind === 'stream'
                      ? 'CERTIFICATIONS, A DAY AND TWELVE HOURS BEFORE THE MILESTONE ENDS, AND THE GRACE WINDOW OPENING AND CLOSING.'
                      : 'WORK OF YOURS CERTIFIED, AND THE LAST HOURS OF THE STREAMS THAT PAY YOU.'}
                  </p>

                  {status && status.emailSlots === 0 && kind === 'stream' ? (
                    <p className="ps-body" style={{ marginTop: 0 }}>
                      Both email places on this stream are taken. Telegram has no limit.
                    </p>
                  ) : (
                    <>
                      <input
                        className="ps-input"
                        type="email"
                        value={address}
                        placeholder="[ you@example.com ]"
                        aria-label="Your email address"
                        onChange={(e) => setAddress(e.target.value)}
                      />

                      {/* WHICH SIDE YOU ARE ON, said plainly and only where it
                          can be proved. No brackets in these labels: they sit
                          inside a bordered button, and the two frames read as
                          one control stuttering. */}
                      {signedIn ? (
                        <button
                          type="button"
                          className="ps-button ps-modal-option ps-updates-choice"
                          disabled={busy || !address}
                          onClick={() => subscribe('contributor')}
                        >
                          {busy ? 'SENDING…' : 'I CONTRIBUTE HERE'}
                        </button>
                      ) : (
                        <a
                          className="ps-button ps-modal-option ps-updates-choice"
                          href={`/api/github/login?next=${encodeURIComponent(kind === 'stream' ? `/stream/${target}` : '/earnings')}`}
                        >
                          SIGN IN WITH GITHUB TO SUBSCRIBE
                        </a>
                      )}

                      {isOwner ? (
                        <button
                          type="button"
                          className="ps-button ps-modal-option ps-updates-choice"
                          disabled={busy || !address}
                          onClick={() => subscribe('employer')}
                        >
                          {busy ? 'SENDING…' : 'I OWN THIS STREAM'}
                        </button>
                      ) : (
                        employer && (
                          <p className="ps-caption">
                            THE OWNER&rsquo;S ROUTE NEEDS THE WALLET THAT CREATED THIS STREAM, CONNECTED.
                          </p>
                        )
                      )}
                    </>
                  )}

                  {said && <p className="ps-caption">{said}</p>}

                  <p className="ps-caption ps-modal-note">
                    EMAIL GOES TO THE TWO SIDES WITH A STAKE: A CONTRIBUTOR THIS STREAM HAS PAID, AND
                    THE WALLET THAT OWNS IT. ANYONE ELSE CAN FOLLOW IT ON TELEGRAM. NOTHING IS SENT
                    UNTIL YOU CLICK THE LINK IN THAT EMAIL, AND EVERY EMAIL CARRIES A WAY OUT.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
