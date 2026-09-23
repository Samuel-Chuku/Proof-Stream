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
}: {
  target: string;
  kind: 'stream' | 'earner';
  employer?: string;
  signedIn?: boolean;
}) {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  const { address: wallet } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
      if (body.ok) setAddress('');
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

  return (
    <>
      <span className="ps-updates">
        <span className="ps-updates-label">GET UPDATES</span>
        {bot && (
          <a
            className="ps-updates-mark"
            href={`https://t.me/${bot}?start=${payload}`}
            target="_blank"
            rel="noreferrer"
            title="Alerts on Telegram"
            aria-label="Alerts on Telegram"
          >
            <TelegramIcon />
          </a>
        )}
        <button
          type="button"
          className="ps-updates-mark"
          onClick={() => setOpen(true)}
          title="Alerts by email"
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
              {/* WHO YOU ARE DECIDES WHAT YOU GET, so it is asked plainly and
                  only where it can be proved. A contributor hears the deadline
                  that ends their chance to be paid; an owner hears the moment
                  they may close and reclaim. */}
              <p className="ps-caption">
                {kind === 'stream'
                  ? 'CERTIFICATIONS, A DAY AND TWELVE HOURS BEFORE THE MILESTONE ENDS, AND THE GRACE WINDOW OPENING AND CLOSING. TWO ADDRESSES PER STREAM.'
                  : 'WORK OF YOURS CERTIFIED, AND THE LAST HOURS OF THE STREAMS THAT PAY YOU.'}
              </p>

              <input
                className="ps-input"
                type="email"
                value={address}
                placeholder="[ you@example.com ]"
                aria-label="Your email address"
                onChange={(e) => setAddress(e.target.value)}
              />

              {signedIn ? (
                <button
                  type="button"
                  className="ps-button ps-modal-option"
                  disabled={busy || !address}
                  onClick={() => subscribe('contributor')}
                >
                  [ {busy ? 'SENDING…' : 'I CONTRIBUTE HERE'} ]
                </button>
              ) : (
                <a className="ps-button ps-modal-option" href={`/api/github/login?next=${encodeURIComponent(kind === 'stream' ? `/stream/${target}` : '/earnings')}`}>
                  [ SIGN IN WITH GITHUB TO SUBSCRIBE AS A CONTRIBUTOR ]
                </a>
              )}

              {isOwner && (
                <button
                  type="button"
                  className="ps-button ps-modal-option"
                  disabled={busy || !address}
                  onClick={() => subscribe('employer')}
                >
                  [ {busy ? 'SENDING…' : 'I OWN THIS STREAM'} ]
                </button>
              )}

              {said && <p className="ps-caption">{ok ? said.toUpperCase() : said}</p>}

              <p className="ps-caption ps-modal-note">
                EMAIL GOES TO THE TWO SIDES WITH A STAKE: A CONTRIBUTOR THIS STREAM HAS PAID, AND THE
                WALLET THAT OWNS IT. ANYONE ELSE CAN FOLLOW IT ON TELEGRAM.
              </p>
              <p className="ps-caption ps-modal-note">
                NOTHING IS SENT UNTIL YOU CLICK THE LINK IN THAT EMAIL, AND EVERY EMAIL CARRIES A WAY OUT.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
