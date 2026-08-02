'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConfig, useDeployContract, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { AGENT_ADDRESS, EXPLORER } from '../../lib/chain';
import { approveBudget, deployStream, fundStream, registerStream, validate, type StreamTerms } from '../../lib/create-stream';
import { AddressChip } from '../address-chip';
import { Connect } from '../connect';
import { ThemeToggle } from '../theme-toggle';

type Repo = { id: number; fullName: string; private: boolean };
type Step = 'deploy' | 'register' | 'approve' | 'fund';

const ORDER: { key: Step; label: string; detail: string }[] = [
  { key: 'deploy', label: 'DEPLOY YOUR STREAM', detail: 'Created from your wallet, so you own it.' },
  { key: 'register', label: 'ANNOUNCE IT TO THE AGENT', detail: 'Without this the agent never sees your repository.' },
  { key: 'approve', label: 'APPROVE THE BUDGET', detail: 'Lets the stream draw the USDC you are committing.' },
  { key: 'fund', label: 'FUND THE MILESTONE', detail: 'Deposits it in full. Nothing accrues until this lands.' },
];

export default function NewStream() {
  const { address, isConnected } = useAccount();

  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [stream, setStream] = useState<`0x${string}` | null>(null);
  const [done, setDone] = useState<Step[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const [terms, setTerms] = useState<StreamTerms>({
    contributor: '' as `0x${string}`,
    agent: AGENT_ADDRESS,
    vestingVault: '' as `0x${string}`,
    milestone: '',
    budget: '40',
    durationSeconds: 21600,
    repo: '',
    maxTranche: '4',
    dailyUnlockCap: '50',
    payee: '' as `0x${string}`,
  });

  // The repo list only exists once GitHub is connected; a 401 here is the
  // normal not-yet-connected state, not a failure worth shouting about.
  useEffect(() => {
    fetch('/api/github/repos')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => setRepos(body.repos))
      .catch(() => setRepos([]));
  }, []);

  const config = useConfig();
  const { deployContractAsync } = useDeployContract();
  const { writeContractAsync } = useWriteContract();

  const problems = validate(terms);
  const ready = isConnected && problems.length === 0 && terms.repo !== '';

  async function run() {
    setFailure(null);
    try {
      // 1. Deploy from the user's own wallet. This is what makes msg.sender —
      //    and therefore the immutable `employer` — actually them.
      let deployed = stream;
      if (!deployed) {
        const hash = await deployContractAsync(deployStream(terms) as never);
        // The deploy has to be awaited: the next step needs the address, and
        // it only exists once the receipt lands.
        const receipt = await waitForTransactionReceipt(config, { hash });
        deployed = receipt.contractAddress as `0x${string}`;
        setStream(deployed);
        setDone((d) => [...d, 'deploy']);
      }

      // 2. Announce it. A stream that is deployed but never registered is
      //    invisible to the agent — the one way to end up with an orphan.
      if (!done.includes('register')) {
        await writeContractAsync(registerStream(deployed) as never);
        setDone((d) => [...d, 'register']);
      }

      if (!done.includes('approve')) {
        await writeContractAsync(approveBudget(deployed, terms.budget) as never);
        setDone((d) => [...d, 'approve']);
      }

      // 4. THIS starts the clock. Until the budget is in full the milestone
      //    accrues nothing, by design.
      if (!done.includes('fund')) {
        await writeContractAsync(fundStream(deployed, terms.budget) as never);
        setDone((d) => [...d, 'fund']);
      }
    } catch (err) {
      setFailure(err instanceof Error ? err.message.split('\n')[0] : String(err));
    }
  }

  const set = <K extends keyof StreamTerms>(key: K, value: StreamTerms[K]) =>
    setTerms((t) => ({ ...t, [key]: value }));

  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">New stream</h1>
          <p className="ps-masthead-meta ps-label">ARC TESTNET · 5042002</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="ps-section-rule">
        <span className="ps-label">1 · YOUR WALLET</span>
      </div>
      <Connect />
      {address && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          THIS ADDRESS BECOMES THE EMPLOYER AND CANNOT BE CHANGED LATER
        </p>
      )}

      <div className="ps-section-rule">
        <span className="ps-label">2 · THE REPOSITORY</span>
      </div>
      {repos === null ? (
        <p className="ps-caption">LOADING…</p>
      ) : repos.length === 0 ? (
        <div className="ps-gate">
          <p className="ps-body" style={{ marginTop: 0 }}>
            Connect GitHub and choose which repositories the agent may read. Installing the app is
            what subscribes a repository — there is no webhook to configure by hand.
          </p>
          <a className="ps-button" href="/api/github/login">
            [ CONNECT GITHUB ]
          </a>
        </div>
      ) : (
        <>
          <select
            className="ps-input"
            value={terms.repo}
            onChange={(e) => set('repo', e.target.value)}
            aria-label="Repository"
          >
            <option value="">[ SELECT A REPOSITORY ]</option>
            {repos.map((r) => (
              <option key={r.id} value={r.fullName}>
                {r.fullName}
                {r.private ? ' (private)' : ''}
              </option>
            ))}
          </select>
          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            REGISTERED ON-CHAIN — THE AGENT WATCHES WHAT THE CONTRACT SAYS, NOT ITS OWN CONFIG
          </p>
        </>
      )}

      <div className="ps-section-rule">
        <span className="ps-label">3 · THE TERMS</span>
      </div>

      <div className="ps-form">
        <Field label="CONTRIBUTOR ADDRESS" caption="Who gets paid when the agent releases a tranche.">
          <input
            className="ps-input"
            value={terms.contributor}
            placeholder="[ 0x… ]"
            onChange={(e) => set('contributor', e.target.value as `0x${string}`)}
          />
        </Field>

        <Field label="PAYEE" caption="The only address withdraw() may pay. Usually the contributor.">
          <input
            className="ps-input"
            value={terms.payee}
            placeholder="[ 0x… ]"
            onChange={(e) => set('payee', e.target.value as `0x${string}`)}
          />
        </Field>

        <Field label="VESTING VAULT" caption="Receives 15% of every tranche.">
          <input
            className="ps-input"
            value={terms.vestingVault}
            placeholder="[ 0x… ]"
            onChange={(e) => set('vestingVault', e.target.value as `0x${string}`)}
          />
        </Field>

        <Field label="MILESTONE BUDGET" caption="Deposited in full before the stream begins accruing.">
          <input
            className="ps-input ps-num"
            value={terms.budget}
            inputMode="decimal"
            onChange={(e) => set('budget', e.target.value)}
          />
        </Field>

        <Field
          label="DURATION (HOURS)"
          caption={`Accrues at ${
            terms.durationSeconds > 0
              ? ((Number(terms.budget || '0') / terms.durationSeconds) * 3600).toFixed(6)
              : '0.000000'
          } USDC / hour.`}
        >
          <input
            className="ps-input ps-num"
            value={terms.durationSeconds / 3600}
            inputMode="numeric"
            onChange={(e) => set('durationSeconds', Math.max(0, Number(e.target.value) * 3600))}
          />
        </Field>

        <Field label="PER-UNLOCK CAP" caption="The agent can never release more than this in one go.">
          <input
            className="ps-input ps-num"
            value={terms.maxTranche}
            inputMode="decimal"
            onChange={(e) => set('maxTranche', e.target.value)}
          />
        </Field>

        <Field label="DAILY CAP" caption="Bounds what a compromised agent key could drain in a day.">
          <input
            className="ps-input ps-num"
            value={terms.dailyUnlockCap}
            inputMode="decimal"
            onChange={(e) => set('dailyUnlockCap', e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="ACCEPTANCE CRITERIA"
        caption="The agent reads this verbatim when deciding whether a merged pull request satisfies the milestone. This field is the product — be specific."
      >
        <textarea
          className="ps-input"
          rows={6}
          value={terms.milestone}
          placeholder="[ Implement transfer() with balance and overdraft checks in src/ledger.ts, with unit tests covering both. ]"
          onChange={(e) => set('milestone', e.target.value)}
        />
      </Field>

      <div className="ps-section-rule">
        <span className="ps-label">4 · CREATE IT</span>
      </div>

      {problems.length > 0 && (
        <ul className="ps-problems">
          {problems.map((p) => (
            <li key={p} className="ps-body">
              {p}
            </li>
          ))}
        </ul>
      )}

      <ol className="ps-steps">
        {ORDER.map((step, i) => {
          const complete = done.includes(step.key);
          const current = !complete && done.length === i;
          return (
            <li key={step.key} className="ps-step">
              <span className="ps-label">
                {complete ? '●' : current ? '◆' : '○'} {i + 1}. {step.label}
              </span>
              <span className="ps-caption">{step.detail}</span>
            </li>
          );
        })}
      </ol>

      {stream && (
        <p className="ps-caption" style={{ marginBottom: 'var(--ps-3)' }}>
          STREAM <AddressChip address={stream} href={`${EXPLORER}/address/${stream}`} />
        </p>
      )}

      {failure && (
        <div className="ps-invert" style={{ marginBottom: 'var(--ps-3)' }}>
          <p className="ps-label" style={{ marginBottom: 'var(--ps-2)' }}>
            ⚠ STEP FAILED
          </p>
          <p className="ps-body" style={{ margin: 0 }}>
            {failure}
          </p>
          <p className="ps-body" style={{ marginBottom: 0 }}>
            Nothing above was undone. Press continue to resume from where it stopped — the form is
            intact and completed steps are not repeated.
          </p>
        </div>
      )}

      <button type="button" className="ps-button" disabled={!ready} onClick={run}>
        [ {done.length === 0 ? 'CREATE STREAM' : done.length === 4 ? 'DONE' : 'CONTINUE'} ]
      </button>

      {done.length === 4 && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-3)' }}>
          FUNDED AND ACCRUING — THE AGENT WILL JUDGE THE NEXT MERGED PULL REQUEST ON {terms.repo}
        </p>
      )}
    </main>
  );
}

function Field({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ps-field">
      <label className="ps-label">{label}</label>
      {children}
      {caption && <span className="ps-caption">{caption}</span>}
    </div>
  );
}
