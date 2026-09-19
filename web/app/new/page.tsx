'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthorAllowlist } from './author-allowlist';
import { KindGate, KindLine } from './stream-kind';
import { isAddress } from 'viem';
import { useAccount, useConfig, useDeployContract, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { AGENT_ADDRESS, EXPLORER } from '../../lib/chain';
import { advisories, approveBudget, deployStream, fundStream, registerStream, suggestedCaps, validate, type StreamTerms } from '../../lib/create-stream';
import { AddressChip } from '../address-chip';
import { Connect } from '../connect';

type Repo = { id: number; fullName: string; private: boolean; defaultBranch: string };
type Step = 'deploy' | 'register' | 'approve' | 'fund';

/// The budget the form opens on. The caps below are DERIVED from it rather than
/// typed out again: they used to be literals, and when `suggestedCaps` moved to
/// recommending the whole budget the literals stayed at a quarter. Anyone who
/// accepted the default budget therefore deployed a 7.50 ceiling on a 30 USDC
/// stream without ever seeing the number change, the agent metered their
/// certification to a quarter, and the rest refunded to the employer on close.
const INITIAL_BUDGET = '30';

const ORDER: { key: Step; label: string; detail: string }[] = [
  { key: 'deploy', label: 'DEPLOY YOUR STREAM', detail: 'Created from your wallet, so you own it.' },
  { key: 'register', label: 'ANNOUNCE IT TO THE AGENT', detail: 'Without this the agent never sees your repository.' },
  { key: 'approve', label: 'APPROVE THE BUDGET', detail: 'Lets the stream draw the USDC you are committing.' },
  { key: 'fund', label: 'FUND THE MILESTONE', detail: 'Deposits it in full. Nothing accrues until this lands.' },
];

export default function NewStream() {
  const { address, isConnected } = useAccount();

  const [repos, setRepos] = useState<Repo[] | null>(null);
  // Authorized is not the same as installed: the first says who you are, the
  // second grants the agent read access to specific repositories. Conflating
  // them left an authorized user staring at "connect GitHub" forever.
  const [connected, setConnected] = useState(false);
  const [stream, setStream] = useState<`0x${string}` | null>(null);
  const [done, setDone] = useState<Step[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  // Which step is awaiting a signature right now, and a hard guard against a
  // second concurrent run. Without the guard a second click started an
  // independent run that saw `stream` still null and DEPLOYED A SECOND
  // CONTRACT — two streams, two funded budgets, and both refused by the agent
  // for claiming the same repository.
  const [active, setActive] = useState<Step | null>(null);
  const [running, setRunning] = useState(false);
  const router = useRouter();

  // Duration as a number plus a unit. A single "hours" box coerced its own
  // value on every keystroke, so typing "0.5" became 0 the moment the decimal
  // point was entered and the character was swallowed. Whole numbers with a
  // unit sidestep that and read better anyway.
  const [durationValue, setDurationValue] = useState('30');
  const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours' | 'days'>('minutes');
  const unitSeconds = { minutes: 60, hours: 3600, days: 86400 }[durationUnit];
  const durationSeconds = Math.max(0, Math.round(Number(durationValue) || 0) * unitSeconds);

  // Edited-by-hand flags: these fields mirror another until the user disagrees,
  // and must then stop moving under them.
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // THE GATE. Nothing below the masthead renders until a kind is chosen, and
  // "change" sends you back here without losing anything typed.
  const [chosen, setChosen] = useState(false);

  // WHICH STEPS ARE OPEN. Only the first on arrival. Satisfying a step opens
  // the next one once, and after that the page never fights the reader: they
  // open and close whatever they like. `revealed` remembers which steps have
  // had their one automatic opening, so collapsing a step stays collapsed.
  const [openSteps, setOpenSteps] = useState<Set<number>>(() => new Set([1]));
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set([1]));
  const toggleStep = (n: number) =>
    setOpenSteps((o) => {
      const next = new Set(o);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const [terms, setTerms] = useState<StreamTerms>({
    mode: 'named',
    contributor: '' as `0x${string}`,
    agent: AGENT_ADDRESS,
    milestone: '',
    budget: INITIAL_BUDGET,
    durationSeconds: 1800,
    repo: '',
    branch: '',
    authors: [],
    ...suggestedCaps(INITIAL_BUDGET),
    payee: '' as `0x${string}`,
    // Open-stream payout caps. They mirror the budget the same way the
    // certification caps do, and stop moving once edited by hand.
    claimCap: suggestedCaps(INITIAL_BUDGET).maxTranche,
    dailyClaimCap: suggestedCaps(INITIAL_BUDGET).dailyUnlockCap,
  });

  // The repo list only exists once GitHub is connected; a 401 here is the
  // normal not-yet-connected state, not a failure worth shouting about.
  useEffect(() => {
    fetch('/api/github/repos')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => {
        setConnected(true);
        setRepos(body.repos);
      })
      .catch(() => setRepos([]));
  }, []);

  // Branches of whichever repo is selected. Reloaded on every change, and reset
  // first so a stale list from the previous repo can never be submitted.
  const [branches, setBranches] = useState<string[] | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  // Set once a branch has been created FROM this page. The create control then
  // goes away entirely: it has done its job, and leaving it there invites a
  // second branch nobody asked for.
  const [madeBranch, setMadeBranch] = useState<string | null>(null);

  useEffect(() => {
    setBranches(null);
    setBranchError(null);
    setMadeBranch(null);
    if (!terms.repo) return;

    let cancelled = false;
    fetch(`/api/github/branches?repo=${encodeURIComponent(terms.repo)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { branches: string[] }) => {
        if (cancelled) return;
        setBranches(body.branches);
        // Default to the repo's own default branch when it exists — the common
        // case — but never silently keep a branch the new repo does not have.
        const preferred = repos?.find((r) => r.fullName === terms.repo)?.defaultBranch;
        set('branch', body.branches.includes(preferred ?? '') ? (preferred as string) : '');
      })
      .catch(() => !cancelled && setBranches([]));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms.repo]);

  async function makeBranch() {
    const name = newBranch.trim();
    if (!name || branchBusy) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      const from = repos?.find((r) => r.fullName === terms.repo)?.defaultBranch ?? 'main';
      const res = await fetch('/api/github/branches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: terms.repo, branch: name, from }),
      });
      const body = (await res.json()) as { branch?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'could not create the branch');
      setBranches((b) => [...(b ?? []), name].sort((a, c) => a.localeCompare(c)));
      set('branch', name);
      setNewBranch('');
      setMadeBranch(name);
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : 'could not create the branch');
    } finally {
      setBranchBusy(false);
    }
  }

  const config = useConfig();
  const { deployContractAsync } = useDeployContract();
  const { writeContractAsync } = useWriteContract();

  const problems = validate({ ...terms, durationSeconds });
  const notes = advisories({ ...terms, durationSeconds });

  // WHEN A STEP IS DONE, for the check mark in its header. Each is the plain
  // condition, not a search through `problems` for a matching sentence: a
  // check mark means "nothing in this step is blocking", and that has to stay
  // true if the wording of a problem ever changes.
  const capsOk = (per: string | undefined, day: string | undefined) => {
    const a = Number(per) || 0;
    const b = Number(day) || 0;
    return a > 0 && b >= a;
  };
  const stepDone: Record<number, boolean> = {
    1: isConnected,
    2: terms.repo !== '' && terms.branch !== '',
    3:
      terms.mode === 'public'
        ? capsOk(terms.claimCap, terms.dailyClaimCap)
        : isAddress(terms.contributor) && isAddress(terms.payee),
    4:
      (Number(terms.budget) || 0) > 0 &&
      durationSeconds > 0 &&
      terms.milestone.trim() !== '' &&
      capsOk(terms.maxTranche, terms.dailyUnlockCap),
  };

  // Open the step after a newly satisfied one, once.
  useEffect(() => {
    for (const n of [1, 2, 3]) {
      if (stepDone[n] && !revealed.has(n + 1)) {
        setRevealed((r) => new Set(r).add(n + 1));
        setOpenSteps((o) => new Set(o).add(n + 1));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepDone[1], stepDone[2], stepDone[3]]);
  const ready = isConnected && problems.length === 0 && terms.repo !== '' && terms.branch !== '';

  async function run() {
    if (running) return;
    setRunning(true);
    setFailure(null);
    try {
      // 1. Deploy from the user's own wallet. This is what makes msg.sender —
      //    and therefore the immutable `employer` — actually them.
      let deployed = stream;
      if (!deployed) {
        setActive('deploy');
        const hash = await deployContractAsync(deployStream({ ...terms, durationSeconds }) as never);
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
        setActive('register');
        await writeContractAsync(registerStream(deployed) as never);
        setDone((d) => [...d, 'register']);
      }

      if (!done.includes('approve')) {
        setActive('approve');
        await writeContractAsync(approveBudget(deployed, terms.budget) as never);
        setDone((d) => [...d, 'approve']);
      }

      // 4. THIS starts the clock. Until the budget is in full the milestone
      //    accrues nothing, by design.
      if (!done.includes('fund')) {
        setActive('fund');
        await writeContractAsync(fundStream(deployed, terms.budget) as never);
        setDone((d) => [...d, 'fund']);
      }

      // The stream exists and is funded, so the place to be is its ledger —
      // not this form, still holding the values that created it.
      setActive(null);
      router.push(`/stream/${deployed}`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message.split('\n')[0] : String(err));
    } finally {
      setActive(null);
      setRunning(false);
    }
  }

  const set = <K extends keyof StreamTerms>(key: K, value: StreamTerms[K]) =>
    setTerms((t) => ({ ...t, [key]: value }));

  /// The payout address defaults to the contributor and the caps scale with the
  /// budget, until the user edits them. Most streams pay one person, so asking
  /// for the same address twice is friction with no information in it.
  function setContributor(value: `0x${string}`) {
    setTerms((t) => ({
      ...t,
      contributor: value,
      payee: touched.payee ? t.payee : value,
    }));
  }

  function setBudget(value: string) {
    const caps = suggestedCaps(value);
    setTerms((t) => ({
      ...t,
      budget: value,
      maxTranche: touched.maxTranche ? t.maxTranche : caps.maxTranche,
      dailyUnlockCap: touched.dailyUnlockCap ? t.dailyUnlockCap : caps.dailyUnlockCap,
      claimCap: touched.claimCap ? t.claimCap : caps.maxTranche,
      dailyClaimCap: touched.dailyClaimCap ? t.dailyClaimCap : caps.dailyUnlockCap,
    }));
  }

  const edit = (key: string) => setTouched((t) => ({ ...t, [key]: true }));

  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">New stream</h1>
          <p className="ps-masthead-meta ps-label">ARC TESTNET · 5042002</p>
        </div>
      </header>

      {!chosen ? (
        <KindGate
          onChoose={(mode) => {
            set('mode', mode);
            setChosen(true);
          }}
        />
      ) : (
        <>
      <KindLine
        mode={terms.mode}
        onSelect={(mode) => set('mode', mode)}
        onCompare={() => setChosen(false)}
      />

      <Step n={1} title="YOUR WALLET" done={stepDone[1]} open={openSteps.has(1)} onToggle={() => toggleStep(1)}>
      <Connect />
      {address && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          THIS ADDRESS BECOMES THE EMPLOYER AND CANNOT BE CHANGED LATER
        </p>
      )}

      </Step>

      <Step n={2} title="THE REPOSITORY" done={stepDone[2]} open={openSteps.has(2)} onToggle={() => toggleStep(2)}>
      {repos === null ? (
        <p className="ps-caption">LOADING…</p>
      ) : repos.length === 0 ? (
        <div className="ps-gate">
          <p className="ps-body" style={{ marginTop: 0 }}>
            {connected
              ? 'Connected, but the app has not been granted any repositories yet. Installing it on a repository is what lets the agent read that code — and what subscribes it, so there is no webhook to configure by hand.'
              : 'Connect GitHub and choose which repositories the agent may read. Installing the app is what subscribes a repository — there is no webhook to configure by hand.'}
          </p>
          <a className="ps-button" href={connected ? '/api/github/login?install=1' : '/api/github/login'}>
            [ {connected ? 'CHOOSE REPOSITORIES' : 'CONNECT GITHUB'} ]
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
          {terms.repo !== '' && (
            <div style={{ marginTop: 'var(--ps-3)' }}>
              <label className="ps-label" htmlFor="branch">
                THE BRANCH WORK MUST LAND ON
              </label>
              {branches === null ? (
                <p className="ps-caption">LOADING BRANCHES…</p>
              ) : branches.length === 0 ? (
                // Every repository has at least one branch, so an empty list
                // means the read failed — not that there is nothing to choose.
                // Saying "select a branch" over an empty dropdown would strand
                // someone on a form that can never become valid.
                <p className="ps-caption">
                  COULD NOT READ THE BRANCHES OF THIS REPOSITORY. RECONNECT GITHUB, OR PICK ANOTHER
                  REPOSITORY.
                </p>
              ) : (
                <select
                  id="branch"
                  className="ps-input"
                  value={terms.branch}
                  onChange={(e) => set('branch', e.target.value)}
                >
                  <option value="">[ SELECT A BRANCH ]</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              )}
              <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
                THE AGENT ONLY PAYS FOR WORK MERGED INTO THIS BRANCH. PROTECT IT ON GITHUB AND A
                CONTRIBUTOR CANNOT PAY THEMSELVES BY MERGING THEIR OWN PULL REQUEST SOMEWHERE ELSE.
              </p>

              {madeBranch === null && branches !== null && branches.length > 0 && (
                <div className="ps-repoint-row" style={{ marginTop: 'var(--ps-2)' }}>
                  <input
                    className="ps-input"
                    value={newBranch}
                    placeholder="[ or make one, e.g. proofstream/accepted ]"
                    onChange={(e) => setNewBranch(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ps-button"
                    disabled={branchBusy || newBranch.trim() === ''}
                    onClick={makeBranch}
                  >
                    [ {branchBusy ? 'CREATING…' : 'CREATE BRANCH'} ]
                  </button>
                </div>
              )}
              {branchError && <p className="ps-caption">{branchError}</p>}
            </div>
          )}

          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            REGISTERED ON-CHAIN — THE AGENT WATCHES WHAT THE CONTRACT SAYS, NOT ITS OWN CONFIG
          </p>
        </>
      )}

      </Step>

      <Step
        n={3}
        title={terms.mode === 'public' ? 'PAYOUT RULES' : 'WHO GETS PAID'}
        done={stepDone[3]}
        open={openSteps.has(3)}
        onToggle={() => toggleStep(3)}
      >
      <div className="ps-form">
        {terms.mode === 'named' ? (
          <Field
            label="THEIR WALLET"
            caption="Only this address can trigger a withdrawal."
          >
            <input
              className="ps-input"
              value={terms.contributor}
              placeholder="[ 0x… ]"
              aria-label="Contributor wallet"
              onChange={(e) => setContributor(e.target.value as `0x${string}`)}
            />
          </Field>
        ) : (
          // The two payout ceilings, side by side in one field. They default
          // to the budget so nothing throttles an earner unless the employer
          // decides it should.
          <Field
            label="PAYOUT CEILING"
            caption="The most any one earner can take per withdrawal, and the most that can leave per day across all of them."
          >
            <div className="ps-mode-caps">
              <label className="ps-mode-cap">
                <span className="ps-caption">PER WITHDRAWAL</span>
                <input
                  className="ps-input ps-num"
                  value={terms.claimCap ?? ''}
                  inputMode="decimal"
                  onChange={(e) => {
                    edit('claimCap');
                    set('claimCap', e.target.value);
                  }}
                />
              </label>
              <label className="ps-mode-cap">
                <span className="ps-caption">PER DAY</span>
                <input
                  className="ps-input ps-num"
                  value={terms.dailyClaimCap ?? ''}
                  inputMode="decimal"
                  onChange={(e) => {
                    edit('dailyClaimCap');
                    set('dailyClaimCap', e.target.value);
                  }}
                />
              </label>
            </div>
          </Field>
        )}

        <Field
          label={terms.mode === 'named' ? 'WHOSE MERGES COUNT' : 'WHO MAY EARN'}
          caption={
            terms.mode === 'named'
              ? "Optional. Empty means any author's merges are judged."
              : 'Optional. Empty means anyone. Named accounts are the only ones whose merges earn a share.'
          }
        >
          <AuthorAllowlist
            authors={terms.authors ?? []}
            onChange={(authors) => setTerms((t) => ({ ...t, authors }))}
          />
        </Field>
      </div>

      </Step>

      <Step n={4} title="THE TERMS" done={stepDone[4]} open={openSteps.has(4)} onToggle={() => toggleStep(4)}>
      <div className="ps-form">
        <Field
          label="MILESTONE BUDGET"
          caption="You deposit this in full before the stream starts. Nothing is owed until you do."
        >
          <input
            className="ps-input ps-num"
            value={terms.budget}
            inputMode="decimal"
            onChange={(e) => setBudget(e.target.value)}
          />
        </Field>

        <Field
          label="PAID OVER"
          caption={`Earns ${
            durationSeconds > 0
              ? ((Number(terms.budget || '0') / durationSeconds) * 60).toFixed(4)
              : '0.0000'
          } USDC a minute, second by second.`}
        >
          <div className="ps-duration">
            <input
              className="ps-input ps-num"
              value={durationValue}
              inputMode="numeric"
              onChange={(e) => setDurationValue(e.target.value)}
            />
            <select
              className="ps-input"
              value={durationUnit}
              onChange={(e) => setDurationUnit(e.target.value as typeof durationUnit)}
              aria-label="Duration unit"
            >
              <option value="minutes">MINUTES</option>
              <option value="hours">HOURS</option>
              <option value="days">DAYS</option>
            </select>
          </div>
        </Field>

        <Field
          label="MOST THE AGENT MAY RELEASE AT ONCE"
          caption="No single verified pull request can release more than this, however good the work."
        >
          <input
            className="ps-input ps-num"
            value={terms.maxTranche}
            inputMode="decimal"
            onChange={(e) => {
              edit('maxTranche');
              set('maxTranche', e.target.value);
            }}
          />
        </Field>

        <Field
          label="MOST THE AGENT MAY RELEASE IN A DAY"
          caption="A ceiling across every release in one day. Set to the full budget so the work can finish in a day; lower it to slow the agent down."
        >
          <input
            className="ps-input ps-num"
            value={terms.dailyUnlockCap}
            inputMode="decimal"
            onChange={(e) => {
              edit('dailyUnlockCap');
              set('dailyUnlockCap', e.target.value);
            }}
          />
        </Field>
      </div>

      {/* A payout address belongs to a named stream. On an open one each
          earner binds their own, so the field would be asking a question the
          contract cannot use the answer to. */}
      {terms.mode === 'named' && (
      <details className="ps-advanced">
        <summary className="ps-label">ADVANCED — PAYOUT ADDRESS ▾</summary>
        <div className="ps-form">
          <Field
            label="PAYOUT ADDRESS"
            caption="Where withdrawals actually land. Kept separate from the contributor so a stolen key cannot redirect the money — it can only ever push it here."
          >
            <input
              className="ps-input"
              value={terms.payee}
              placeholder="[ 0x… ]"
              onChange={(e) => {
                edit('payee');
                set('payee', e.target.value as `0x${string}`);
              }}
            />
          </Field>

        </div>
      </details>
      )}

      <Field
        lead
        label="ACCEPTANCE CRITERIA (THE MILESTONE)"
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

      </Step>

      <div className="ps-section-rule">
        <span className="ps-label">5 · CREATE IT</span>
      </div>

      {problems.length > 0 && (
        <div className="ps-blockers">
          <span className="ps-label">
            {problems.length} THING{problems.length === 1 ? '' : 'S'} STOPPING THIS DEPLOY
          </span>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="ps-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <ol className="ps-steps">
        {ORDER.map((step, i) => {
          const complete = done.includes(step.key);
          const signing = active === step.key;
          const next = !complete && !signing && done.length === i;
          return (
            <li
              key={step.key}
              className={`ps-step${complete ? ' ps-step-done' : ''}${signing ? ' ps-step-active' : ''}`}
            >
              <span className="ps-label">
                <span className="ps-step-mark" aria-hidden>
                  {complete ? '✓' : signing || next ? '→' : '○'}
                </span>{' '}
                {i + 1}. {step.label}
                {signing && ' — CONFIRM IN YOUR WALLET'}
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

      <button type="button" className="ps-button" disabled={!ready || running} onClick={run}>
        [{' '}
        {running
          ? 'WAITING FOR YOUR WALLET…'
          : done.length === 0
            ? 'CREATE STREAM'
            : 'CONTINUE'}{' '}
        ]
      </button>
      {running && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          DO NOT RELOAD OR PRESS AGAIN — EACH PRESS WOULD DEPLOY ANOTHER STREAM
        </p>
      )}

      {done.length === 4 && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-3)' }}>
          FUNDED AND ACCRUING — THE AGENT WILL JUDGE THE NEXT PULL REQUEST MERGED INTO {terms.branch} ON {terms.repo}
        </p>
      )}
        </>
      )}
    </main>
  );
}

/// One numbered step, openable and closable at will, with a check mark once
/// nothing in it is blocking. The header is the section rule the page already
/// used, so a closed step reads as the same ledger line it always was, with a
/// mark. The body is a plain block: no shadow, no panel, the fields as before.
function Step({
  n,
  title,
  done,
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <details
      className={`ps-step-fold${done ? ' ps-step-fold-done' : ''}`}
      open={open}
      onToggle={(e) => {
        // Only act on a real change, so the controlled `open` and the DOM stay
        // agreed and a re-render does not re-fire the handler.
        if ((e.currentTarget as HTMLDetailsElement).open !== open) onToggle();
      }}
    >
      <summary className="ps-section-rule ps-step-fold-head">
        <span className="ps-label">
          {n} · {title}
        </span>
        <span className="ps-step-fold-state ps-label" aria-hidden>
          {done ? '✓' : ''}
          <span className="ps-step-fold-caret">{open ? '▾' : '▸'}</span>
        </span>
      </summary>
      <div className="ps-step-fold-body">{children}</div>
    </details>
  );
}

function Field({
  label,
  caption,
  children,
  lead,
}: {
  label: string;
  caption?: string;
  children: React.ReactNode;
  /** The one field on this form that IS the product. Set on the milestone so it
   *  reads as the thing being written rather than as one setting among nine. */
  lead?: boolean;
}) {
  return (
    <div className="ps-field">
      <label className={`ps-label${lead ? ' ps-label-lead' : ''}`}>{label}</label>
      {children}
      {caption && <span className="ps-caption">{caption}</span>}
    </div>
  );
}
