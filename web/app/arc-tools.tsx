/// WHAT THIS IS BUILT ON, stated as a ledger.
///
/// Every row names one piece of Arc or Circle infrastructure, what it does in
/// ProofStream specifically rather than in general, and whether it is running
/// today or planned. LIVE means a reader can go and find the transaction;
/// NEXT means designed and not yet wired. Nothing is listed as live that is not.
///
/// Shared by the home page and the docs so the two can never disagree about
/// what is in use.
const TOOLS: { name: string; role: string; state: 'LIVE' | 'NEXT' }[] = [
  {
    name: 'Arc testnet',
    role: 'Every stream is its own contract here. USDC is the gas, so the agent pays fees in the same asset it pays out, and the fee on a certification is a fraction of a cent.',
    state: 'LIVE',
  },
  {
    name: 'USDC',
    role: 'The only asset. Budgets are deposited in it, accrue in it, and are withdrawn in it. Six decimals on the ERC-20, eighteen as gas; one helper converts and one test pins it.',
    state: 'LIVE',
  },
  {
    name: 'Circle Wallets',
    role: 'Both agents hold developer-controlled wallets. The attestor signs EIP-712 attestations and sends certifications from its own balance; the verifier is paid into its own. No private key touches the agent host.',
    state: 'LIVE',
  },
  {
    name: 'Gateway nanopayments',
    role: 'The attestor buys a second opinion for $0.005 per judgment over x402. Fees settle in batches, so they show up as a rising Gateway balance and periodic settlements, not one transaction each.',
    state: 'LIVE',
  },
  {
    name: 'Modular Wallets',
    role: 'For an earner on a public stream who has no wallet. A passkey creates one on their device; no seed phrase. This is where it becomes load-bearing.',
    state: 'NEXT',
  },
  {
    name: 'Gas Station',
    role: 'Sponsors the transaction that binds a payee and the one that withdraws, so someone paid for the first time never has to find gas before they can be paid.',
    state: 'NEXT',
  },
  {
    name: 'CCTP',
    role: 'Lets an employer fund a stream with USDC from another chain. The contributor stays entirely on Arc; only the funder ever bridges.',
    state: 'NEXT',
  },
];

export function ArcTools({ heading = 'BUILT ON ARC' }: { heading?: string }) {
  return (
    <section className="ps-tools" aria-labelledby="ps-tools-label">
      <div className="ps-section-rule">
        <span id="ps-tools-label" className="ps-label">
          {heading}
        </span>
      </div>
      <div className="ps-tools-ledger" role="table" aria-label="Arc and Circle tools">
        {TOOLS.map((t) => (
          <div key={t.name} className="ps-tools-row" role="row">
            <span role="cell" className="ps-tools-name">
              {t.name}
            </span>
            <span role="cell" className="ps-tools-role ps-body">
              {t.role}
            </span>
            <span role="cell" className={`ps-tools-state ps-label${t.state === 'LIVE' ? ' ps-tools-live' : ''}`}>
              {t.state}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
