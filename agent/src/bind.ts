// THE AGENT AUTHORISES WHERE AN EARNER IS PAID, on a public stream.
//
// The contract records who earned a share as an opaque id the agent computed
// from a GitHub account. Turning that credit into money needs one more fact,
// which wallet that account wants paying, and the agent is the only party the
// contract trusts to say so. This endpoint is where it says it.
//
// The proof of identity is GitHub's, not ours. The caller presents a GitHub
// user token and the agent asks GitHub who it belongs to; the web app forwards
// the token it already holds for the signed-in user and is never trusted to
// name an id itself. A compromised web server therefore cannot bind earners it
// does not hold a token for.
//
// What is signed is bounded on the contract side: the payee is inside the
// struct, the payee must send the transaction, and an earner binds once. The
// agent adds nothing to that; it only refuses the requests that could never
// succeed, so a signature is not spent on a guaranteed revert.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BINDING_TTL_SECONDS, earnerId } from '@proofstream/config';
import { isAddress } from 'viem';
import { readBindingState, signPayeeBinding } from './chain';
import { isServed } from './registry';

export type BindRequest = { stream: `0x${string}`; payee: `0x${string}`; token: string };

const ZERO = /^0x0{40}$/i;

/// What a request must carry, checked before anything costs a network call.
/// Returns a plain message on refusal so the route can answer it verbatim.
export function parseBindRequest(body: unknown, authorization: string | undefined): BindRequest | string {
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return 'a GitHub user token is required';
  const { stream, payee } = (body ?? {}) as { stream?: unknown; payee?: unknown };
  if (typeof stream !== 'string' || !isAddress(stream)) return 'stream must be an address';
  if (typeof payee !== 'string' || !isAddress(payee) || ZERO.test(payee)) return 'payee must be a non-zero address';
  return { stream: stream as `0x${string}`, payee: payee as `0x${string}`, token };
}

/// Who the token belongs to, from GitHub itself. Undefined on any failure: a
/// revoked or expired token must refuse the binding, never fall through.
async function whoIs(token: string): Promise<{ id: number; login: string } | undefined> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'proofstream-attestor',
      },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { id?: unknown; login?: unknown };
    if (typeof body.id !== 'number' || typeof body.login !== 'string') return undefined;
    return { id: body.id, login: body.login };
  } catch {
    return undefined;
  }
}

type Reply = { status: number; body: Record<string, unknown> };

export async function bind(body: unknown, authorization: string | undefined): Promise<Reply> {
  const parsed = parseBindRequest(body, authorization);
  if (typeof parsed === 'string') return { status: 400, body: { error: parsed } };

  // Refuse a stream this agent does not serve BEFORE touching GitHub or the
  // chain. 404 rather than 403: an unknown stream is not a credential failure.
  if (!isServed(parsed.stream)) return { status: 404, body: { error: 'not a stream this agent serves' } };

  const user = await whoIs(parsed.token);
  if (!user) return { status: 401, body: { error: 'GitHub did not recognise that token' } };
  const id = earnerId('github', user.id);

  const state = await readBindingState(parsed.stream, id);
  if (!state.isPublic) return { status: 400, body: { error: 'that stream names its contributor, so there is nothing to bind' } };
  if (!ZERO.test(state.payee)) {
    // Not an error from the earner's side: they already chose, and the answer
    // is where. The web app shows the bound address and offers withdrawal.
    return { status: 409, body: { error: 'already bound', earnerId: id, payee: state.payee } };
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + BINDING_TTL_SECONDS);
  const signature = await signPayeeBinding(parsed.stream, id, parsed.payee, deadline);

  // Operational, not judgment: stdout, never the verdict ledger.
  console.log(
    JSON.stringify({ at: new Date().toISOString(), event: 'payee_binding_signed', stream: parsed.stream, login: user.login, earnerId: id, payee: parsed.payee }),
  );

  return {
    status: 200,
    body: { earnerId: id, payee: parsed.payee, deadline: deadline.toString(), signature, login: user.login },
  };
}

/// Read the body, run `bind`, answer JSON. Kept apart from the pure function so
/// the decision logic is testable without a socket.
export function handleBind(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    // A binding request is two addresses. Anything larger is not one.
    if (raw.length > 4096) req.destroy();
  });
  req.on('end', async () => {
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'body must be JSON' }));
      return;
    }
    try {
      const reply = await bind(body, req.headers.authorization);
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ at: new Date().toISOString(), event: 'payee_binding_failed', message }));
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message.split('\n')[0] }));
    }
  });
}
