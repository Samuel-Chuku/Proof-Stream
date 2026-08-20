'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { erc20Abi } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { USDC, arcTestnet } from '../lib/chain';
import { Connect } from './connect';

/// First-run guidance, as a checklist that reads real state rather than a
/// scripted overlay.
///
/// Deliberately NOT a modal tour with a dark backdrop and "next" buttons: those
/// interrupt before anyone knows what they are looking at, cannot be resumed,
/// and lie the moment the app changes. This inspects the four things that
/// actually gate a first stream, so a returning user sees exactly the step they
/// stopped at — and someone who has done it all sees nothing at all.
export function GettingStarted({ hasStreams }: { hasStreams: boolean }) {
  const { address, isConnected } = useAccount();
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  // Granted at least one repository — authorizing alone is not enough for the
  // agent to read anything.
  const [hasRepos, setHasRepos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem('ps-guide-dismissed') === '1');
  }, []);

  useEffect(() => {
    fetch('/api/github/repos')
      .then(async (r) => {
        setGithubConnected(r.ok);
        if (r.ok) setHasRepos(((await r.json()).repos ?? []).length > 0);
      })
      .catch(() => setGithubConnected(false));
  }, []);

  const { data: balance } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(address) },
  });

  const funded = typeof balance === 'bigint' && balance > 0n;

  const steps = [
    {
      done: isConnected,
      label: 'CONNECT A WALLET',
      detail: 'This address becomes the employer of any stream you create.',
      action: <Connect />,
    },
    {
      done: funded,
      label: 'GET TESTNET USDC',
      detail:
        'You fund the whole milestone budget up front — that is what the contributor checks before starting work. None of it is real money.',
      action: (
        <a className="ps-button" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
          [ OPEN FAUCET ↗ ]
        </a>
      ),
    },
    {
      done: githubConnected === true && hasRepos,
      label: 'CONNECT GITHUB',
      detail:
        githubConnected && !hasRepos
          ? 'Connected, but no repositories granted yet. Installing the app on one is what lets the agent read that code.'
          : 'Choose which repositories the agent may read. Installing the app is what subscribes them — there is no webhook to configure.',
      action: (
        <a
          className="ps-button"
          href={githubConnected && !hasRepos ? '/api/github/login?install=1' : '/api/github/login'}
        >
          [ {githubConnected && !hasRepos ? 'CHOOSE REPOSITORIES' : 'CONNECT GITHUB'} ]
        </a>
      ),
    },
    {
      done: hasStreams,
      label: 'CREATE A STREAM',
      detail:
        'Four transactions from your own wallet: deploy it, announce it to the agent, approve the budget, fund it. The clock starts on the last one.',
      action: (
        <Link className="ps-button" href="/new">
          [ CREATE A STREAM ]
        </Link>
      ),
    },
  ];

  // Everything done, or explicitly dismissed — get out of the way.
  const remaining = steps.filter((s) => !s.done);
  if (dismissed || remaining.length === 0) return null;

  // The first incomplete step is the only one showing an action. Presenting
  // four buttons at once would make the order look optional when it is not.
  const current = steps.findIndex((s) => !s.done);

  return (
    <section className="ps-guide">
      <div className="ps-guide-head">
        <h2 className="ps-label">GETTING STARTED — {remaining.length} STEP{remaining.length === 1 ? '' : 'S'} LEFT</h2>
        <button
          type="button"
          className="ps-chip"
          onClick={() => {
            localStorage.setItem('ps-guide-dismissed', '1');
            setDismissed(true);
          }}
          aria-label="Dismiss the getting started guide"
        >
          ×
        </button>
      </div>

      <ol className="ps-steps">
        {steps.map((step, i) => (
          <li key={step.label} className="ps-step">
            <span className="ps-label">
              {step.done ? '●' : i === current ? '◆' : '○'} {i + 1}. {step.label}
            </span>
            {i === current && <span className="ps-caption">{step.detail}</span>}
            {i === current && <span className="ps-guide-action">{step.action}</span>}
          </li>
        ))}
      </ol>

      <p className="ps-caption">
        NEW HERE? <Link href="/docs">READ HOW IT WORKS</Link> FIRST — IT TAKES TWO MINUTES
      </p>
    </section>
  );
}
