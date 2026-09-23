'use client';

import { useEffect, useState } from 'react';
import { EmailIcon, TelegramIcon } from './channel-marks';

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
}: {
  target: string;
  kind: 'stream' | 'earner';
}) {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
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

  async function subscribe() {
    setBusy(true);
    setSaid(null);
    try {
      const res = await fetch('/api/alerts/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, kind, id: target }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string };
      setOk(Boolean(body.ok));
      setSaid(body.message ?? 'Something went wrong.');
      if (body.ok) setAddress('');
    } catch {
      setOk(false);
      setSaid('The request did not get through. Try again shortly.');
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
              <p className="ps-caption">
                {kind === 'stream'
                  ? 'WORK CERTIFIED OR REFUSED, A DAY AND TWELVE HOURS BEFORE THE MILESTONE ENDS, AND WHEN ITS GRACE WINDOW OPENS. TWO ADDRESSES PER STREAM.'
                  : 'WORK OF YOURS CERTIFIED OR REFUSED, AND THE LAST HOURS OF THE STREAMS THAT PAY YOU.'}
              </p>
              <input
                className="ps-input"
                type="email"
                value={address}
                placeholder="[ you@example.com ]"
                aria-label="Your email address"
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && address && !busy && subscribe()}
              />
              <button type="button" className="ps-button ps-modal-option" disabled={busy || !address} onClick={subscribe}>
                [ {busy ? 'SENDING…' : 'SEND ME A CONFIRMATION'} ]
              </button>
              {said && <p className="ps-caption">{ok ? said.toUpperCase() : said}</p>}
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
