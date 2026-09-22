import { TelegramMark } from './telegram-mark';

/// THE ONE LINK THAT SUBSCRIBES. Tapping it makes the person message the bot
/// with the payload, which is the whole subscription: their consent arrives
/// with their chat id. Renders nothing when no bot is configured, so a
/// deployment without one shows no dead control.
///
/// `payload` is what the bot receives after /start: a stream address, or an
/// earner id without its 0x (Telegram allows 64 characters and a bytes32 is
/// exactly that many hex digits).
export function FollowTelegram({ payload, label }: { payload: string; label: string }) {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  if (!bot) return null;
  return (
    <a className="ps-follow" href={`https://t.me/${bot}?start=${payload}`} target="_blank" rel="noreferrer">
      <TelegramMark />
      {label}
    </a>
  );
}
