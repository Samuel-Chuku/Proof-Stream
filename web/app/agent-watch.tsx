import { AgentMark } from './agent-mark';
import { LiveRefresh } from './live-refresh';

/// "The agent is watching this stream" — stated only when the agent's own
/// /health says it is serving this address.
///
/// The temptation is a decorative pulse that animates whether or not anything
/// is running. That would be the one dishonest pixel in the product: a
/// contributor would read it as a promise that their next merge gets judged.
/// `serving` comes from the agent's fleet, so when the agent is down, or has
/// retired this stream past its grace window, this says so instead.
export function AgentWatch({
  watching,
  reachable,
  repo,
  branch,
  settled,
}: {
  watching: boolean;
  reachable: boolean;
  repo: string;
  branch: string;
  settled: boolean;
}) {
  if (settled) return null;

  const state = !reachable ? 'down' : watching ? 'watching' : 'idle';

  return (
    <div className={`ps-watch ps-watch-${state}`}>
      <span className="ps-watch-mark" aria-hidden>
        <AgentMark role="attestor" />
      </span>

      {state === 'watching' && (
        <>
          {/* Four cells sweeping left to right — the same pixel vocabulary as
              the stream bar, so it reads as this product rather than a spinner
              borrowed from somewhere else. */}
          <span className="ps-scan" aria-hidden>
            <i /><i /><i /><i />
          </span>
          <span className="ps-watch-text">
            <b>WATCHING</b> {repo} · WAITING FOR A MERGE INTO {branch}
          </span>
        </>
      )}

      {state === 'idle' && (
        <span className="ps-watch-text">
          THE AGENT IS RUNNING BUT NOT SERVING THIS STREAM — IT IS UNREGISTERED, UNFUNDED, OR PAST
          ITS GRACE WINDOW. MERGES WILL NOT BE JUDGED.
        </span>
      )}

      {state === 'down' && (
        <span className="ps-watch-text">
          THE AGENT IS UNREACHABLE. MERGES LANDING NOW WILL BE PICKED UP WHEN IT RETURNS.
        </span>
      )}

      <LiveRefresh />
    </div>
  );
}
