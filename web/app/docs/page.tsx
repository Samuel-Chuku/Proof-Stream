import { EXPLORER_URL } from '@proofstream/config';
import Link from 'next/link';
import { AddressChip } from '../address-chip';
import { Footer } from '../footer';

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
      </header>

      <p className="ps-body">
        ProofStream pays contributors in USDC that accrues by the second but stays locked until an
        autonomous agent reads the merged work, judges it against the milestone, buys a second
        opinion from a different agent, and signs an attestation certifying how much of the
        milestone is done. Stop shipping and the money pauses itself. No human approves a payment.
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
          <b>If both agree</b>, the certified share is the <em>lower</em> of the two valuations. The
          agent signs an EIP-712 attestation and sends it from its own wallet, paying its own gas.
          The whole amount is the contributor&rsquo;s — the contract takes no cut.
        </li>
        <li className="ps-body">
          <b>The contributor collects on the stream&rsquo;s schedule.</b> Certifying raises what is
          owed; it does not move money. The clock pays it out from there, so <em>one</em>
          certification keeps paying with no further pull requests — and a contributor who finishes
          a milestone never has to invent work to collect the rest of it.
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

        <dt className="ps-label">EVERYTHING CERTIFIED IS ALREADY BACKED</dt>
        <dd className="ps-body">
          Because the budget is deposited before the clock starts, <code>withdraw()</code> can never
          fail for lack of funds.
        </dd>

        <dt className="ps-label">THE AGENT CANNOT EXCEED ITS MANDATE</dt>
        <dd className="ps-body">
          <code>maxTranche</code> caps how much a single attestation may add to what is owed,
          <code>dailyUnlockCap</code> caps a UTC day, withdrawals only reach an allowlisted payee,
          and attestations are single-use and expire after 15 minutes. Certification is also
          monotonic: it can raise a contributor&rsquo;s claim, never reduce one. These are enforced
          in the contract, not in the agent — and money still leaves only at the speed the stream
          accrues, so the clock is a second rate limit no key can bypass.
        </dd>

        <dt className="ps-label">UNSURE MEANS UNPAID</dt>
        <dd className="ps-body">
          Below its confidence threshold the agent <b>releases nothing and waits for better
          evidence</b>. It does not guess, it does not split the difference, and it does not ask
          anyone to rubber-stamp it. The work is not lost — certification is cumulative, so a later
          pull request is judged against everything already in place. The safe failure is the one
          where nobody is paid on a judgment the agent was not sure of.
        </dd>

        <dt className="ps-label">PAUSING DOES NOT STRAND EARNED PAY</dt>
        <dd className="ps-body">
          Pause stops the clock so nothing new accrues, but deliberately does not block
          certification — and closing settles whatever the agent certified, not merely what the
          clock had reached. So the worst a pause can do is delay certified pay to the deadline. It
          can never reduce it.
        </dd>

        <dt className="ps-label">CLOSING RETURNS ONLY THE UNSPENT</dt>
        <dd className="ps-body">
          <code>closeMilestone()</code> refunds only what the agent never certified, and not until
          four hours <em>after</em> the duration has run. Judging a diff, buying a second opinion and
          landing a transaction all take real time, so without that window an employer could close
          the second the clock expired and reclaim work that merged minutes earlier.
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
          <b>Judgment is only as good as the model.</b> Below the confidence threshold the agent
          releases nothing, which bounds the failure without removing it.
        </li>
        <li className="ps-body">
          <b>A held judgment has nowhere to go.</b> When the agent is not confident enough it stops
          and records why. There is no review queue and no on-chain appeal — the work waits for a
          later pull request to be judged again.
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
