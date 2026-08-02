import { EXPLORER_URL } from '@proofstream/config';
import Link from 'next/link';
import { AddressChip } from '../address-chip';
import { Footer } from '../footer';
import { ThemeToggle } from '../theme-toggle';

export const metadata = {
  title: 'How ProofStream works',
  description: 'The protocol, the guarantees, the contract addresses, and the limitations.',
};

const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? '';
const AGENT = process.env.NEXT_PUBLIC_AGENT_ADDRESS ?? '';

function Rule({ children }: { children: string }) {
  return (
    <div className="ps-section-rule">
      <span className="ps-label">{children}</span>
    </div>
  );
}

/// Written for a technical reader who wants to check the claims rather than be
/// sold to. Every guarantee names the function that enforces it, because a
/// guarantee without a mechanism is marketing.
export default function Docs() {
  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">How it works</h1>
          <p className="ps-masthead-meta ps-label">ARC TESTNET · 5042002</p>
        </div>
        <ThemeToggle />
      </header>

      <p className="ps-body">
        ProofStream pays contributors in USDC that accrues by the second but stays locked until an
        autonomous agent reads the merged work, judges it against the milestone, buys a second
        opinion from a different agent, and signs an attestation releasing a tranche. Stop shipping
        and the money pauses itself. No human approves a payment.
      </p>

      <Rule>THE SHAPE OF IT</Rule>
      <ol className="ps-numbered">
        <li className="ps-body">
          <b>An employer deploys a stream</b> from their own wallet and funds a milestone. The
          contract records who is paid, which repository is watched, and the caps the agent must
          obey. Deploying it yourself is what makes you its employer — there is no factory holding
          your money.
        </li>
        <li className="ps-body">
          <b>Pay accrues every second</b> as <code>budget × elapsed / duration</code>, earned but
          locked. Nothing accrues until the budget is deposited <em>in full</em>.
        </li>
        <li className="ps-body">
          <b>A pull request merges.</b> The agent fetches the diff and the milestone text itself and
          asks a model whether the work satisfies it — returning not a yes/no but how much it is
          worth.
        </li>
        <li className="ps-body">
          <b>It buys a second opinion</b> for $0.005 from a separate agent with its own wallet and a
          different model vendor, paid over x402 from its own balance. That agent gathers its own
          copy of the evidence and never sees the first one&rsquo;s answer.
        </li>
        <li className="ps-body">
          <b>If both agree</b>, the tranche is the <em>lower</em> of the two valuations, capped by
          what has actually accrued. The agent signs an EIP-712 attestation and sends the unlock
          from its own wallet, paying its own gas. 85% is credited to the contributor, 15% vests.
        </li>
      </ol>
      <p className="ps-caption">IF THE AGENT REFUSES, NO FEE IS SPENT AND NO TRANSACTION IS SENT</p>

      <Rule>WHAT THE CONTRACT GUARANTEES</Rule>
      <dl className="ps-defs">
        <dt className="ps-label">NOTHING STARTS UNTIL IT IS FUNDED IN FULL</dt>
        <dd className="ps-body">
          A partial deposit — even one unit short — leaves a milestone dormant, accruing nothing. A
          contributor checks one boolean, <code>fullyFunded()</code>, before starting. An employer
          cannot take completed work against a budget they never funded.
        </dd>

        <dt className="ps-label">EVERY RELEASED TRANCHE IS ALREADY BACKED</dt>
        <dd className="ps-body">
          Because the budget is deposited before the clock starts, <code>withdraw()</code> can never
          fail for lack of funds.
        </dd>

        <dt className="ps-label">THE AGENT CANNOT EXCEED ITS MANDATE</dt>
        <dd className="ps-body">
          <code>maxTranche</code> caps a single unlock, <code>dailyUnlockCap</code> caps a UTC day,
          withdrawals only reach an allowlisted payee, attestations are single-use and expire after
          15 minutes, and nothing above what has accrued can be released. These are enforced in the
          contract, not in the agent — a compromised agent key drains at most one day&rsquo;s cap.
        </dd>

        <dt className="ps-label">PAUSING DOES NOT STRAND EARNED PAY</dt>
        <dd className="ps-body">
          Pause stops the clock so nothing new accrues, but deliberately does not block
          certification. Otherwise an employer could watch work land, pause, and freeze pay already
          earned.
        </dd>

        <dt className="ps-label">CLOSING RETURNS ONLY THE UNSPENT</dt>
        <dd className="ps-body">
          <code>closeMilestone()</code> refunds what was never released, and only once the duration
          has run — so an employer cannot close mid-job and claw back money the agent has not yet
          certified.
        </dd>
      </dl>

      <Rule>ADDRESSES</Rule>
      <div className="ps-feed">
        <div className="ps-tx-row">
          <span className="ps-tx-action">STREAM REGISTRY</span>
          <span />
          <AddressChip address={REGISTRY} href={`${EXPLORER_URL}/address/${REGISTRY}`} />
          <span />
        </div>
        <div className="ps-tx-row">
          <span className="ps-tx-action">ATTESTOR AGENT</span>
          <span />
          <AddressChip address={AGENT} href={`${EXPLORER_URL}/address/${AGENT}`} />
          <span />
        </div>
        <div className="ps-tx-row">
          <span className="ps-tx-action">USDC</span>
          <span />
          <AddressChip
            address="0x3600000000000000000000000000000000000000"
            href={`${EXPLORER_URL}/address/0x3600000000000000000000000000000000000000`}
          />
          <span />
        </div>
      </div>
      <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
        EACH STREAM IS ITS OWN CONTRACT — FIND YOURS FROM THE <Link href="/">STREAM LIST</Link>
      </p>

      <Rule>RUNNING IT YOURSELF</Rule>
      <p className="ps-body">
        Nothing here is tied to one vendor. Both judges call{' '}
        <code>POST {'{LLM_BASE_URL}'}/chat/completions</code>, so any OpenAI-compatible endpoint
        works — Ollama, Groq, Together, or a local model, in which case no inference leaves your
        machine. The defaults are free models. Clone the repository and run{' '}
        <code>forge test</code> to check every guarantee above with no API key, no wallet and no
        cost.
      </p>
      <p className="ps-body">
        Every action in this interface also exists as a terminal command. The UI is a second front
        door, never a replacement.
      </p>

      <Rule>LIMITATIONS, NAMED</Rule>
      <ul className="ps-numbered">
        <li className="ps-body">
          <b>The attestor is a single trusted key.</b> One key signing attestations is a centralised
          oracle. The damage is bounded on-chain rather than solved. Production would need multiple
          attestors and a stake to slash.
        </li>
        <li className="ps-body">
          <b>Both agents are operated by the same party.</b> The verifier is independent in
          construction — its own wallet, process, model vendor, and it gathers its own evidence —
          but it is not independently operated.
        </li>
        <li className="ps-body">
          <b>Verification fees are batched.</b> They settle through Circle Gateway in bulk, so they
          do not appear as one transaction each and are not counted as such.
        </li>
        <li className="ps-body">
          <b>The model that ran cannot be proven.</b> Real proof needs TEE attestation or
          provider-signed inference, and neither exists on commodity APIs.
        </li>
        <li className="ps-body">
          <b>Judgment is only as good as the model.</b> Low confidence escalates to a human rather
          than releasing funds, which bounds the failure without removing it.
        </li>
      </ul>

      <Rule>GETTING STARTED</Rule>
      <p className="ps-body">
        You need testnet USDC on Arc and a wallet. Everything on this site is testnet — none of it
        is real money.
      </p>
      <p style={{ marginTop: 'var(--ps-3)' }}>
        <Link className="ps-button" href="/new">
          [ CREATE A STREAM ]
        </Link>
      </p>

      <Footer />
    </main>
  );
}
