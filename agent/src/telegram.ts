// THE TELEGRAM BOT: how a person subscribes, and how they are told.
//
// Telegram is the cheap channel because it is opt-in by construction. The
// stream page shows a link, `t.me/<bot>?start=<stream>`; tapping it makes the
// PERSON message the bot first, which hands us their chat id with their consent
// attached. There is nothing to verify and nobody to spam: a chat id only ever
// arrives from the person who owns it.
//
// The agent polls Telegram for messages rather than taking a webhook. It
// already runs as a long-lived process, `getUpdates` with a long timeout is one
// idle request at a time, and it means no new public route and no new secret
// on the ingress.
//
// Commands, kept to what a person needs and nothing more:
//   /start <stream>   subscribe to one stream (what the deep link sends)
//   /stop <stream>    unsubscribe from one
//   /stop             unsubscribe from all
//   /list             what you are subscribed to
//
// TELEGRAM_BOT_TOKEN off means none of this runs, and the agent says so once.
import { env } from './env';
import { adoptEarnerFollows, earnerFollows, followEarner, streamsCrediting, subscribe, subscribersOf, subscriptions, unsubscribe } from './subscriptions';

type Logger = (entry: Record<string, unknown>) => void;

const API = () => `https://api.telegram.org/bot${env.telegramBotToken}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/// An earner id arrives WITHOUT its 0x: Telegram allows a start payload of 64
/// characters, and a bytes32 is exactly 64 hex digits.
const EARNER = /^[0-9a-fA-F]{64}$/;

/// One message to one chat. Plain text: Telegram's markdown modes turn an
/// underscore in a repository name into formatting, and a stream address is
/// exactly the kind of string that gets mangled.
export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const res = await fetch(`${API()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`telegram sendMessage ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/// Everyone listening to a stream gets the same text. Never throws: a
/// notification that fails is a log line, and the thing it was about has
/// already happened.
export async function broadcast(log: Logger, stream: string, text: string): Promise<void> {
  if (!env.telegramBotToken) return;
  for (const s of subscribersOf(stream)) {
    try {
      await sendTelegram(s.chatId, text);
    } catch (err) {
      log({ event: 'telegram_failed', chatId: s.chatId, stream, message: err instanceof Error ? err.message : String(err) });
    }
  }
}

/// What to say back to a command. Pure, so the tests can hold it.
export function reply(chatId: string, text: string): { text: string; act?: () => void } {
  const [cmd, arg] = text.trim().split(/\s+/, 2);
  const command = (cmd ?? '').toLowerCase().replace(/@\w+$/, '');

  if (command === '/start' && arg && ADDRESS.test(arg)) {
    return {
      text: `Subscribed to stream ${arg}. You will hear when the agent certifies or refuses work on it, and as its milestone ends. /stop ${arg} to leave, /list to see what you follow.`,
      act: () => subscribe(chatId, arg),
    };
  }
  if (command === '/start' && arg && EARNER.test(arg)) {
    const earner = `0x${arg.toLowerCase()}`;
    return {
      text: 'Following your earnings. You will hear whenever a stream certifies work of yours, and about that stream from then on. /stop to leave everything, /list to see what you follow.',
      act: () => {
        followEarner(chatId, earner);
        // Streams that already credited them: subscribe now, not at the next
        // certification, so the grace alerts on a finished milestone arrive.
        for (const stream of streamsCrediting(earner)) adoptEarnerFollows(stream, earner);
      },
    };
  }
  if (command === '/start') {
    return {
      text: `ProofStream alerts. Open a stream on ${env.appUrl} and use its Telegram link to follow it here, or send /start followed by the stream address.`,
    };
  }
  if (command === '/stop' && arg && ADDRESS.test(arg)) {
    return { text: `Unsubscribed from ${arg}.`, act: () => unsubscribe(chatId, arg) };
  }
  if (command === '/stop') {
    return { text: 'Unsubscribed from every stream.', act: () => unsubscribe(chatId, '*') };
  }
  if (command === '/list') {
    const mine = subscriptions().filter((s) => s.chatId === chatId);
    const me = earnerFollows().some((f) => f.chatId === chatId);
    const lines = [
      ...(me ? [`Your own earnings: ${env.appUrl}/earnings`] : []),
      ...mine.map((s) => `${s.stream}\n${env.appUrl}/stream/${s.stream}`),
    ];
    return { text: lines.length === 0 ? 'You follow nothing yet.' : `You follow:\n${lines.join('\n\n')}` };
  }
  return { text: 'Commands: /start <stream>, /stop <stream>, /stop, /list.' };
}

let said = false;

/// Poll for messages, for ever. Returns immediately; the loop runs behind.
export function startTelegram(log: Logger): void {
  if (!env.telegramBotToken) {
    if (!said) {
      said = true;
      log({ event: 'telegram_disabled', reason: 'TELEGRAM_BOT_TOKEN is not set; no alerts are sent and no subscriptions are taken' });
    }
    return;
  }

  let offset = 0;
  const poll = async () => {
    for (;;) {
      try {
        const res = await fetch(`${API()}/getUpdates?timeout=25&offset=${offset}&allowed_updates=%5B%22message%22%5D`);
        if (!res.ok) throw new Error(`getUpdates ${res.status}`);
        const body = (await res.json()) as { result?: { update_id: number; message?: { chat: { id: number }; text?: string } }[] };
        for (const u of body.result ?? []) {
          offset = u.update_id + 1;
          const chatId = String(u.message?.chat.id ?? '');
          const text = u.message?.text;
          if (!chatId || !text) continue;
          const r = reply(chatId, text);
          r.act?.();
          await sendTelegram(chatId, r.text);
          log({ event: 'telegram_command', chatId, command: text.split(/\s+/)[0] });
        }
      } catch (err) {
        log({ event: 'telegram_poll_failed', message: err instanceof Error ? err.message : String(err) });
        // Back off rather than hammer a failing endpoint.
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  };
  void poll();
  log({ event: 'telegram_started' });
}
