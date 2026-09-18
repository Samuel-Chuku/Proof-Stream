import { EXPLORER_URL } from '@proofstream/config';
import Link from 'next/link';
import { AddressChip } from '../address-chip';
import { ArcTools } from '../arc-tools';
import { Footer } from '../footer';
import { FillStates, Flow, Kinds, TwoClocks } from './diagrams';

export const metadata = {
  title: 'How ProofStream works',
  description: 'The protocol, the guarantees, the three kinds of stream, the contract addresses, and the limitations.',
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

/// A sub-heading inside a section. Full ink and bold, because the dim caption
/// style it replaced faded into the paragraph beneath it and a reader scanning
/// for one guarantee could not find it.
function H({ children }: { children: string }) {
  return <h3 className="ps-docs-h">{children}</h3>;
}

/// Written for a technical reader who wants to check the claims rather than be
/// sold to. Every guarantee names the function that enforces it, because a
/// guarantee without a mechanism is marketing. Every diagram is built from the
/// interface's own parts, so what is learned here is recognised on a stream.
export default function Docs() {
  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">How it works</h1>
          <p className="ps-masthead-meta ps-label">ARC TESTNET · 5042002</p>
        </div>
      </header>

      <p className="ps-body ps-docs-lede">
        ProofStream pays contributors in USDC that accrues by the second but stays locked until an
        autonomous agent reads the merged work, judges it against the milestone, runs tests it
        wrote itself against the code, buys a second opinion from a different agent, and signs an
        attestation certifying how much of the milestone is done. Stop shipping and the money pauses
        itself. No human approves a payment.
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>THE SHAPE OF IT</Rule>

      <Flow
        steps={[
          { n: '1', label: 'FUND', note: 'employer deploys and deposits in full' },
          { n: '2', label: 'MERGE', note: 'a pull request lands on the named branch' },
          { n: '3', label: 'JUDGE', note: 'the agent reads the diff against the milestone' },
          { n: '4', label: 'RUN', note: 'a suite written blind, in a sandbox' },
          { n: '5', label: 'SECOND OPINION', note: 'bought from a separate agent' },
          { n: '6', label: 'ATTEST', note: 'EIP-712, from the agent’s own wallet' },
          { n: '7', label: 'WITHDRAW', note: 'on the stream’s own schedule' },
        ]}
      />

      <ol className="ps-numbered">
        <li className="ps-body">
          <b>An employer deploys a stream</b> from their own wallet and funds a milestone. The
          contract records what kind of stream it is, which repository and branch are watched, and
          the caps the agent must obey. Deploying it yourself is what makes you its employer; there
          is no factory holding your money.
        </li>
        <li className="ps-body">
          <b>Pay accrues every second</b> as <code>budget × elapsed / duration</code>, earned but
          locked. Nothing accrues until the budget is deposited <em>in full</em>.
        </li>
        <li className="ps-body">
          <b>A pull request merges.</b> The agent fetches the diff and the milestone text and asks a
          model whether the work satisfies it, returning not a yes or no but how much it is worth.
        </li>
        <li className="ps-body">
          <b>It runs the code.</b> A separate model that has never seen the implementation writes a
          test suite from the milestone text alone, and the suite executes against the merged code
          in an isolated environment with none of the agent&rsquo;s keys and no network. What fails
          becomes evidence in the judgment. See <em>what the agent checks</em> below.
        </li>
        <li className="ps-body">
          <b>It buys a second opinion</b> for $0.005 from a separate agent with its own wallet, paid
          over x402 from its own balance. That agent gathers its own copy of the evidence and never
          sees the first one&rsquo;s answer.
        </li>
        <li className="ps-body">
          <b>If both agree</b>, the certified share is the <em>lower</em> of the two valuations. The
          agent signs an EIP-712 attestation and sends it from its own wallet, paying its own gas.
          The whole amount is the contributor&rsquo;s; the contract takes no cut.
        </li>
        <li className="ps-body">
          <b>The contributor collects on the stream&rsquo;s schedule.</b> Certifying raises what is
          owed; it does not move money. The clock pays it out from there.
        </li>
      </ol>
      <p className="ps-caption">IF THE AGENT REFUSES, NO FEE IS SPENT AND NO TRANSACTION IS SENT</p>

      {/* ------------------------------------------------------------ */}
      <Rule>THREE KINDS OF STREAM</Rule>

      <Kinds />

      <H>Named</H>
      <p className="ps-body">
        You know who is doing the work. Their wallet is set when the stream is created and only that
        wallet can ever withdraw. This is how every stream worked until September, and it is
        unchanged.
      </p>

      <H>Public</H>
      <p className="ps-body">
        Nobody is named. Anyone whose merge the agent accepts earns a share of the milestone,
        credited on chain to an opaque identity derived from their GitHub account, never their
        login, since logins are renamed and reassigned. Each earner chooses where to be paid, once,
        later, themselves. The employer sets two payout ceilings, per withdrawal and per day, and
        the contract refuses to deploy a public stream without them, so that forgetting to name
        anyone can never silently create a stream open to the world. See <em>earners and shares</em>{' '}
        below.
      </p>

      <H>Claimable</H>
      <p className="ps-body">
        You know who, but not their wallet. The contract supports a stream that is funded now and
        bound later by someone presenting a signed authorisation over their own address, which makes
        the authorisation useless to anyone who copies it. The contract half is live and tested. No
        product flow for making the link has been accepted yet, so the interface shows this kind,
        names it, and does not offer it.
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>WHAT A STREAM BAR MEANS</Rule>

      <p className="ps-body">
        Every stream page carries a bar of cells, one cell per unit of the budget. Each cell is in
        exactly one of four states, and green means one thing everywhere in this interface: USDC the
        agent has released. Nothing else is ever green.
      </p>

      <FillStates />

      <H>Two rulers decide what can be taken</H>
      <p className="ps-body">
        The agent decides how much of the milestone is done. The clock decides how much of the
        budget has been released so far. A contributor may take the smaller of the two. So a
        certification does not pay out; it raises what is owed, and the clock pays it from there.
        One certification keeps paying with no further pull requests, and someone who finishes a
        milestone never has to invent work to collect the rest. The exception is 100%: complete work
        ends the schedule and the whole certified amount becomes withdrawable at once.
      </p>

      <TwoClocks />

      {/* ------------------------------------------------------------ */}
      <Rule>WHAT THE AGENT CHECKS</Rule>

      <p className="ps-body">
        Reading a diff can establish that work is <em>present</em>. It cannot establish that it is
        <em> correct</em>: an implementation that is subtly wrong, carrying a test that agrees with
        it, reads exactly like one that is right. So the agent also runs the code.
      </p>

      <Flow
        steps={[
          { label: 'MILESTONE TEXT', note: 'and the public interface of the repo, nothing more' },
          { label: 'A SUITE IS WRITTEN', note: 'by a model that never sees the implementation' },
          { label: 'RUN ON THE MERGE', note: 'isolated, no keys, no network' },
          { label: 'RUN ON THE PARENT', note: 'the code the employer already accepted' },
          { label: 'FILTER', note: 'a test that fails on both is unfair and is discarded' },
          { label: 'EVIDENCE', note: 'what survives goes to the judge, named' },
        ]}
      />

      <H>The filter, and why it is not a prompt</H>
      <p className="ps-body">
        Generated tests over-specify. They assert things the milestone never said and then condemn
        correct code for choosing differently. Asking the model to be fairer does not fix that. So
        the unfair tests are removed mechanically: a fair test passes correct code by definition, and
        the version of the repository the employer already accepted is correct by definition, so
        anything that fails there too is testing something the milestone never required. Nothing is
        rewritten; it is a set difference on test names.
      </p>

      <H>Which way it is allowed to be wrong</H>
      <p className="ps-body">
        A false accusation withholds an honest contributor&rsquo;s pay on the strength of a bug we
        wrote, and certification is a monotonic ratchet, so it is expensive in a way a false pass is
        not. Every rule leans the same way: the filter can only discard failures, never invent them;
        anything it cannot adjudicate is reported as inconclusive rather than as a defect; a failing
        test is handed to the judgment, never wired to the payout. The judge is also told, by name,
        every test that passed, so it cannot assume what was and was not exercised.
      </p>

      <H>The contributor&rsquo;s own tests count too</H>
      <p className="ps-body">
        The generated suite is written from the milestone and never shown the repository&rsquo;s
        test files, so it cannot see whether a contributor wrote tests. A milestone that asks for
        them would be invisible to it. So the repository&rsquo;s own suite is run as well, as a
        second and independent ruler, and certification may rise when either improves.
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>CERTIFICATION RISES ON EVIDENCE, NOT ON A RETRY</Rule>

      <p className="ps-body">
        Certified share only ever rises, so repeated judgments do not converge on the truth; they
        climb toward the highest number the model ever produced. Observed live: a merge that changed
        a single comment took a standing 95% to 100%, because the second roll of the dice landed
        higher and monotonicity made it permanent.
      </p>
      <p className="ps-body">
        The fix is to stop treating a re-ask as new information. Certification may rise when the
        <b> evidence</b> improves: more generated tests passing, or more of the repository&rsquo;s
        own tests passing, measured against the same suite as last time. A comment-only merge has
        the same tests passing as before and cannot move the number. Also observed live, on the same
        day: held at 50% through three consecutive merges, one of them a single comment, at almost no
        cost, because the agent declined to buy a second opinion it could not use.
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>EARNERS AND SHARES</Rule>

      <p className="ps-body">
        On a public stream two facts are recorded at two different times. <b>Who earned it</b> is
        written when the agent certifies: the attestation carries an opaque earner identity and the
        share of the milestone credited to them. <b>Who gets paid</b> is written when the earner
        chooses, once, permanently.
      </p>

      <H>Proportional shares</H>
      <p className="ps-body">
        When the clock has released less than the total owed, every earner may take their fraction
        of what is released, pro rata to what they were credited. Two earners credited 40% and 30%
        with half the budget released may take 28.57 and 21.43 of a 100 budget. Nothing to race, and
        nobody is punished for being asleep. First-come was rejected because the fastest bot would
        win, not the earliest earner.
      </p>

      <H>Binding a payee</H>
      <p className="ps-body">
        An earner binds their payee with an agent-signed authorisation that names the payee
        <em> inside</em> the signed data, so a copy lifted from the mempool authorises somebody
        else&rsquo;s address and is useless. The transaction must be sent <em>by</em> the payee, so a
        mistyped or dead address can never be bound, which is what makes the binding safe to make
        permanent. There is no second trusted key: the attestor signs, bounded exactly as it is
        bounded on certification.
      </p>

      <H>Payout ceilings</H>
      <p className="ps-body">
        Paying out is capped per withdrawal and per day, mirroring the caps on certification. A
        compromised agent that bound itself to an unclaimed earner would drain at that rate until the
        employer closed the milestone, which refunds everything not yet withdrawn. Same shape as the
        bound on a compromised certifier, and stated with the same honesty.
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>WHO MAY EARN</Rule>

      <p className="ps-body">
        A stream may name up to sixteen GitHub accounts whose merges count. Empty means anyone.
        Co-authors count: a merge opened by anyone still counts if a named account appears in a
        <code> Co-authored-by</code> trailer, because pairing is normal and only one person can open
        a pull request. Logins only, never email addresses: the agent matches on the pull
        request&rsquo;s login, so an address could never match and would silently exclude the very
        person it was added to allow. The interface refuses one by name.
      </p>
      <p className="ps-body">
        On a public stream the allowlist does one more thing: the earner is the first account it
        accepts, author first and then co-authors in trailer order. A trailer used to be only a way
        to make somebody <em>else</em> be paid. On a public stream the earner is paid, so crediting
        the author when only a co-author was allowed would pay somebody the employer never permitted.
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>WHAT THE CONTRACT GUARANTEES</Rule>

      <H>Nothing starts until it is funded in full</H>
      <p className="ps-body">
        A partial deposit, even one unit short, leaves a milestone dormant, accruing nothing. A
        contributor checks one boolean, <code>fullyFunded()</code>, before starting. An employer
        cannot take completed work against a budget they never funded.
      </p>

      <H>Everything certified is already backed</H>
      <p className="ps-body">
        Because the budget is deposited before the clock starts, <code>withdraw()</code> can never
        fail for lack of funds.
      </p>

      <H>The agent cannot exceed its mandate</H>
      <p className="ps-body">
        <code>maxTranche</code> caps how much a single attestation may add to what is owed,
        <code> dailyUnlockCap</code> caps a UTC day, withdrawals only reach an allowlisted payee, and
        attestations are single-use and expire after fifteen minutes. Certification is monotonic: it
        can raise a contributor&rsquo;s claim, never reduce one. These are enforced in the contract,
        not in the agent, and money still leaves only at the speed the stream accrues, so the clock
        is a second rate limit no key can bypass.
      </p>

      <H>A cap may throttle the rate, never strand the budget</H>
      <p className="ps-body">
        The constructor refuses a per-certification cap below the budget, and a daily cap that could
        not reach the budget within the duration. Before this, a stream with a cap below its budget
        certified a finished milestone for a fraction and refunded the rest to the employer. That
        took real money from a real contributor, once, and is the only guard here that did.
      </p>

      <H>Only work the employer accepted is paid for</H>
      <p className="ps-body">
        A stream names a repository <b>and a branch</b>, stored on chain as
        <code> owner/name#branch</code>. A pull request merged into any other branch is ignored.
        GitHub protects the default branch and nothing else; without the check, a contributor could
        merge into a throwaway branch themselves and be paid for work nobody reviewed. Once any work
        is certified, the repository and the allowlist lock: <code>setRepo</code> and
        <code> setAuthors</code> revert <code>RepoLocked</code>, so certified work cannot be
        repointed at another codebase or another set of people.
      </p>

      <H>A throwaway merge cannot inflate a payout</H>
      <p className="ps-body">
        Past 100% nothing can be added: the agent refuses before spending anything, and the contract
        reverts <code>NotAnIncrease</code> if a verdict is sent anyway. Below 100%, the evidence
        gate above applies. Tested, not assumed: an empty merge scores 0 and earns nothing.
      </p>

      <H>Unsure means unpaid</H>
      <p className="ps-body">
        Below its confidence threshold the agent releases nothing and waits for better evidence. It
        does not guess, does not split the difference, and does not ask anyone to rubber-stamp it.
        The bar rises with the claim: a verdict certifying 90% or more of a milestone needs more
        confidence than one certifying 20%.
      </p>

      <H>Pausing does not strand earned pay</H>
      <p className="ps-body">
        Pause stops the clock so nothing new accrues, but deliberately does not block certification,
        and closing settles whatever the agent certified, not merely what the clock had reached. The
        worst a pause can do is delay certified pay to the deadline.
      </p>

      <H>Closing returns only the unspent</H>
      <p className="ps-body">
        <code>closeMilestone()</code> refunds only what the agent never certified, and not until four
        hours <em>after</em> the duration has run. Judging a diff, running a suite, buying a second
        opinion and landing a transaction all take real time.
      </p>

      <p className="ps-caption" style={{ marginTop: 'var(--ps-3)' }}>
        EVERY GUARD ABOVE IS PROVEN AGAINST LIVE TESTNET BY <code>pnpm probe:policy</code>, EACH PAIRED
        WITH AN ALLOWED CONTROL, SO A REVERT CANNOT BE MISTAKEN FOR A BROKEN CALL
      </p>

      {/* ------------------------------------------------------------ */}
      <ArcTools />

      {/* ------------------------------------------------------------ */}
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
        EACH STREAM IS ITS OWN CONTRACT, AND CARRIES ITS VERSION. OLDER STREAMS KEEP THEIR OWN
        BEHAVIOUR FOREVER; NOTHING MIGRATES. FIND YOURS FROM THE <Link href="/streams">STREAM LIST</Link>
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>RUNNING IT YOURSELF</Rule>
      <p className="ps-body">
        Nothing here is tied to one vendor, and this project does not pick one for you. Both judges
        call <code>POST {'{LLM_BASE_URL}'}/chat/completions</code>, so any endpoint serving that
        shape works, including a model on your own machine, in which case no inference leaves it.
        Clone the repository and run <code>forge test</code> to check every guarantee above with no
        API key, no wallet and no cost.
      </p>
      <p className="ps-body">
        Every action in this interface also exists as a terminal command. The UI is a second front
        door, never a replacement.
      </p>

      {/* ------------------------------------------------------------ */}
      <Rule>LIMITATIONS, NAMED</Rule>
      <ul className="ps-numbered">
        <li className="ps-body">
          <b>The attestor is a single trusted key.</b> One key signing attestations is a centralised
          oracle. The damage is bounded on chain rather than solved: per certification, per day, and
          on public streams per payout. Production would need multiple attestors.
        </li>
        <li className="ps-body">
          <b>Both agents are operated by the same party.</b> The verifier is independent in
          construction, its own wallet, process and model, and it gathers its own evidence, but it
          is not independently operated.
        </li>
        <li className="ps-body">
          <b>Verification fees are batched.</b> They settle through Gateway in bulk, so they do not
          appear as one transaction each and are not counted as such.
        </li>
        <li className="ps-body">
          <b>The model that ran cannot be proven.</b> Real proof needs attested inference, and it does
          not exist on commodity APIs.
        </li>
        <li className="ps-body">
          <b>A suite only tests what it thought to test.</b> The correctness check is evidence that
          fed a judgment, never a proof of correctness, and the interface is careful never to call it
          one.
        </li>
        <li className="ps-body">
          <b>A held judgment has nowhere to go.</b> When the agent is not confident it stops and
          records why. There is no review queue and no appeal; the work waits for a later pull
          request.
        </li>
        <li className="ps-body">
          <b>An employer who copies a submission and refuses to merge it cannot be compelled.</b>{' '}
          Merge is the signal, and merge is the employer&rsquo;s. A signed attestation on open pull
          requests, proving authorship before any merge, is the next step toward closing that gap.
        </li>
      </ul>

      {/* ------------------------------------------------------------ */}
      <Rule>GETTING STARTED</Rule>
      <p className="ps-body">
        You need testnet USDC on Arc and a wallet. Everything on this site is testnet; none of it is
        real money.
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
