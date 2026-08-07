# ProofStream

USDC payroll on [Arc](https://docs.arc.network) that accrues by the second but stays
**locked** until an autonomous agent reads the actual work, judges it, and signs an
attestation certifying how much of the milestone is done. Stop shipping, and the money
pauses itself.

The attestor agent has its own wallet, forms its own opinion, and **buys an independent
second opinion from another agent** before it will move a cent. Both agents pay their own
costs. No human approves anything.

Three things are true of every payout in this repo, and each is checkable on-chain:

1. **An agent spent its own money with no human in the loop** — it paid a verifier
   $0.005, then sent the `unlock` transaction from its own wallet and paid its own gas.
2. **The payment was released against a real, external signal** — a pull request diff it
   fetched itself, judged against a milestone it read from the contract.
3. **The economics only work because gas is USDC and sub-cent** — a full judge → verify →
   unlock → pay cycle costs about **$0.036**.

## Deployed on Arc Testnet (chain 5042002)

| What | Address |
| --- | --- |
| `WorkStream` | [`0xF6362b807915FD998a03FaEc73361166333F4Ac9`](https://testnet.arcscan.app/address/0xF6362b807915FD998a03FaEc73361166333F4Ac9) |
| `StreamRegistry` | [`0x528B36beF91B338166F08aA41676e9f1f1BF019f`](https://testnet.arcscan.app/address/0x528B36beF91B338166F08aA41676e9f1f1BF019f) |
| Employer / treasury | [`0xe9d2E5521573D73471497C368F3454d710170477`](https://testnet.arcscan.app/address/0xe9d2E5521573D73471497C368F3454d710170477) |
| Attestor agent (Circle developer-controlled wallet) | [`0x2CD7cc0407218f905731F88C08EEB86a94dd634A`](https://testnet.arcscan.app/address/0x2CD7cc0407218f905731F88C08EEB86a94dd634A) |
| Verifier agent (Circle developer-controlled wallet) | [`0xa7aaa2324cb141a332b22c5eac12f75b46cdeb50`](https://testnet.arcscan.app/address/0xa7aaa2324cb141a332b22c5eac12f75b46cdeb50) |
| Contributor | [`0x4e10648aDA2bFb02544B41d62D0C15B00bc56699`](https://testnet.arcscan.app/address/0x4e10648aDA2bFb02544B41d62D0C15B00bc56699) |
| Circle `GatewayWallet` (nanopayments) | [`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`](https://testnet.arcscan.app/address/0x0077777d7EBA4688BDeF3E311b846F25870A19B9) |

Transaction-by-transaction evidence is in [`EVIDENCE.md`](EVIDENCE.md), regenerated from
the agents' own logs plus live chain state with `pnpm evidence`.

## How a payout happens

1. **The employer opens a milestone** with its own budget, duration, and the repository to
   watch — all on-chain.
2. **The employer deposits the budget in full.** Nothing accrues until they do.
3. **Pay accrues every second**, `budget × elapsed / duration`, earned but locked.
4. **A pull request lands.** The attestor fetches the diff and the milestone text itself
   and asks an LLM whether the work satisfies it — returning not just yes/no but *how much*
   it is worth.
5. **The attestor buys a second opinion** for $0.005 over x402, paid from its own Gateway
   balance. The verifier runs a different vendor's model, fetches its own copy of the
   evidence, and never sees the attestor's answer.
6. **If both agree**, the certified share is the **lower** of the two valuations. The
   attestor signs an EIP-712 attestation and sends `certify` itself. The whole amount is
   the contributor's — the contract takes no cut.
7. **The contributor collects on the stream's schedule.** Certifying raises what is owed;
   it does not move money. **One certification keeps paying** as the clock runs, so a
   contributor who finishes a milestone never has to invent further pull requests to
   collect the rest of it.

If the attestor refuses, no fee is spent and no transaction is sent — refusal is free.

## The money model

**A milestone does not start until its budget is deposited in full.** A partial deposit —
even one unit short — leaves it dormant, accruing nothing. This is deliberate: it means an
employer cannot take completed work against a budget they never funded. A contributor
checks one boolean, `fullyFunded()`, before starting, and the dashboard shows a dedicated
"not started, waiting on the employer's deposit" state.

Because the budget is fully deposited before the clock starts, everything the agent
certifies is already backed by USDC in the contract, so `withdraw()` can never fail for
lack of funds.

Two quantities decide what a contributor may take, and keeping them apart is the design:

```
target()  = budget × certifiedBps / 10_000     the AGENT decides this
earned()  = min(accrued(), target())           the CLOCK meters it
```

The agent owns *what was earned*; the clock owns *when it arrives*. `certifiedBps` is
monotonic, so a later judgment can raise a claim but never reduce one, and every merged PR
can move it closer to the full amount. Time alone pays nothing — an uncertified stream
releases zero however long it runs. The one exception is completion: at 100% the schedule
is over, so the full amount is earned immediately rather than metered out for its own sake.

Accrual is computed fresh as `budget × elapsed / duration` with no stored per-second rate,
so "40 USDC over 6 hours" accrues to exactly 40 with no rounding dust.

`closeMilestone()` returns to the employer only what the agent never certified, and not
until **four hours after** the duration has run. Judging a diff, buying a second opinion and
landing a transaction all take real time, so without that window an employer could close the
second the clock expired and reclaim work that merged minutes earlier. Closing settles the
**certified** amount rather than merely what the clock had reached, which is what stops
pausing or closing being used to strand work the agent already approved.

The terms are the employer's, not the protocol's. Every one is a constructor argument, and
`Deploy.s.sol` reads them from the environment — see `.env.example`.

## How the on-chain policy bounds the agent

The attestor is a single trusted key, so `WorkStream.sol` enforces its mandate itself: no
single attestation may add more than `maxTranche` to what is owed, no more than
`dailyUnlockCap` per UTC day, withdrawals only to an allowlisted payee, one-use nonces, and
attestations older than 15 minutes rejected. A compromised agent key raises what is owed by
at most one day's cap — and because money still leaves only at the speed the stream accrues,
the clock is a second rate limit no key can bypass.

Note `maxTranche` bounds the agent, not the contributor. Setting it below the budget does
not make a stream safer; it caps an honest contributor who finished the job and refunds the
remainder to the employer. It defaults to the whole budget for that reason.

Pause stops the clock but deliberately does **not** block certification — otherwise an
employer could watch work land, pause, and strand pay already earned.

## Agent-to-agent payments settle in batches

The attestor pays the verifier through **Circle Gateway nanopayments**: it signs an
EIP-3009 authorization off-chain at zero gas, and Gateway settles those authorizations in
**batches**.

**These fees therefore do not appear as one Arc transaction each, and are not counted as
such.** `EVIDENCE.md` keeps two separate tables for exactly this reason: direct on-chain
transactions in one, batched nanopayments in the other, evidenced by the transfer receipts
and by the seller's on-chain Gateway balance rising.

Because the attestor's key is custodied by Circle, the published buyer quickstart does not
apply — it requires a raw private key. ProofStream uses `BatchEvmScheme` with a
Circle-backed `{ address, signTypedData }` signer instead, so the agent pays from the same
wallet it signs attestations and sends transactions from, with no plaintext key anywhere.

## Known limitations

- **The attestor is a single trusted key.** One key signing attestations is a centralised
  oracle. The damage is bounded on-chain rather than solved: the policy caps what a
  compromised key can release, and the independent verifier is a second opinion. A
  production system would need multiple attestors and a stake to slash.
- **Both agents are operated by the same party.** The verifier is independent in
  construction — its own wallet, own process, own model vendor, and it gathers its own
  evidence rather than trusting what the buyer sends — but it is not independently
  operated. Production would source verifiers from an open market.
- **Verification fees are batched, not per-transaction.** Stated above, and repeated
  because it is the easiest property to misread.
- **The model that actually ran cannot be proven.** The verifier is paid for a specific
  model, and nothing today forces it to have used one. A signed receipt carrying the provider's
  generation record would make a lie *attributable*, not impossible. Real proof needs TEE
  attestation or provider-signed inference, and neither exists on commodity APIs.
- **The employer can change the milestone between jobs.** Milestone text is employer-set.
  Changing it mid-job is blocked — a new milestone requires closing the current one, which
  requires its duration to have elapsed — but a hostile employer still controls what the
  next job is judged against.
- **The policy can be loosened but never tightened.** `raisePolicy` lets the employer raise
  the per-attestation and per-day ceilings after deployment; nothing can lower them and the
  payee can never change. That asymmetry is deliberate — a cap an employer could tighten
  mid-milestone is a way to strand work the agent has already certified — but it does mean a
  ceiling set too high cannot be walked back without deploying a new stream.
- **Certification is one-way, and nobody can correct it.** `certifiedBps` only ever rises.
  This protects the contributor: an employer cannot un-approve work. The cost is that an
  over-certification — a bad judgment inside the caps, or a key compromised within its daily
  allowance — is permanent, and the employer has no recourse of any kind. We chose the side
  that protects the party doing the work, and this is what that choice costs.
- **`setRepo` is not gated on-chain.** The employer can point a stream at a different
  repository at any time, including mid-milestone. The dashboard hides the control once the
  agent has certified anything, but that guard is in the interface, not the contract, so a
  direct call is unaffected. It cannot un-certify past work; it redirects what is judged
  next. A one-line contract change fixes it and we did not redeploy for it before submission.
- **The judgment is only as good as the model.** An LLM reading a diff can be wrong, and
  can be fooled by a sufficiently deceptive PR. Below the confidence threshold the agent
  releases nothing, which bounds the failure without removing it.
- **A held judgment has nowhere to go.** When the agent is not confident enough it stops and
  writes a log line. There is no review queue, no on-chain appeal and no way for a human to
  approve it afterwards — the work simply waits for a later pull request to be judged again.
  Calling this "escalation" would overstate it.

## Install and run

Requires Node ≥ 22.13, pnpm, and [Foundry](https://getfoundry.sh).

```bash
pnpm install
pnpm test:amounts              # decimal round-trip tests
cd contracts && forge test     # 29 contract tests
pnpm check:chain               # chain id and balances
```

Every command that moves money ships with a dry run that must print ALL GREEN first:

```bash
pnpm preflight:deploy          # before deploying
pnpm preflight:agent           # before running the attestor
pnpm preflight:verifier        # before any agent-to-agent payment
pnpm preflight:withdraw        # before a payout
```

Running the system:

```bash
pnpm verifier:dev              # the seller — keep it up
pnpm agent:dev                 # the attestor, listening for webhooks
pnpm web:dev                   # the web app, http://localhost:3000
pnpm seed 8 20 15              # drive changesets through unattended
pnpm evidence                  # regenerate EVIDENCE.md
```

Judgment can be exercised without spending anything:

```bash
pnpm verdict:test <pr>         # what the attestor thinks
pnpm review:test <pr>          # what the verifier thinks
```

## Environment variables

Copy `.env.example` to `.env` and fill it in. The stream's own terms — budget, duration,
milestone, policy caps, payee, repository — are all optional overrides there; they freeze
on-chain at deploy, and every consumer then reads them from the contract rather than from
its own configuration.

| Variable | Purpose |
| --- | --- |
| `ARC_RPC_URL` | Arc Testnet RPC endpoint |
| `WORKSTREAM_ADDRESS` | The deployed stream |
| `DEPLOYER_ADDRESS` | Employer/treasury address (read-only checks; the key is never stored here) |
| `CIRCLE_API_KEY`, `ENTITY_SECRET` | Circle developer-controlled wallets — one credential pair manages both agent wallets |
| `AGENT_WALLET_ID`, `AGENT_ADDRESS`, `VERIFIER_WALLET_ID`, `VERIFIER_ADDRESS` | Written by `pnpm circle:setup` |
| `REGISTRY_ADDRESS`, `REGISTRY_DEPLOY_BLOCK` | Stream discovery. Leave blank to serve only `WORKSTREAM_ADDRESS` |
| `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET` | Reading diffs and verifying webhook signatures. The webhook secret is a **master** — each stream's own secret is derived from it |
| `AGENT_INGRESS_URL` | Public URL GitHub delivers webhooks to |
| `LLM_BASE_URL`, `LLM_API_KEY`, `AGENT_MODEL`, `VERIFIER_MODEL` | The two judges. Different vendors on purpose |
| `GITHUB_APP_*`, `SESSION_SECRET` | GitHub App connect flow for the web app |
| `AGENT_EVENTS_URL` | Where the dashboard reads the agents' logs; unset falls back to local disk |
| `RECONCILE_LOOKBACK_HOURS`, `RECONCILE_MAX_PRS` | Missed-webhook recovery bounds |
| `NEXT_PUBLIC_*` | Client-side only — never put a secret behind this prefix |
| `CONTRIBUTOR_*`, `VAULT_*` | Demo fixtures only — see below |

The contributor and vault private keys exist solely so unattended seeding can call
`withdraw()` and control the vault. In real use the contributor connects their own wallet;
ProofStream never custodies it.

### Bring your own model provider

Nothing here is tied to a particular LLM vendor. Both judges call
`POST {LLM_BASE_URL}/chat/completions`, so any OpenAI-compatible endpoint works — run it
against a local model and no inference leaves your machine:

```bash
LLM_BASE_URL=http://localhost:11434/v1     # Ollama
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_BASE_URL=https://api.together.xyz/v1
LLM_BASE_URL=https://api.openai.com/v1
```

`LLM_BASE_URL` defaults to OpenRouter and `LLM_API_KEY` falls back to
`OPENROUTER_API_KEY`, so existing setups keep working untouched. Set `AGENT_MODEL` and
`VERIFIER_MODEL` to slugs **that provider** serves — carrying over a model name that only
exists on OpenRouter is the usual failure after switching. `pnpm preflight:agent` catches
it: it sends a one-token completion, so it verifies the endpoint, the key and the model
name together rather than just checking a key exists.

The defaults are free models, deliberately. The whole system is provider-agnostic because
the interesting claim is that *an agent exercises judgment*, not that a particular vendor
does — and a reviewer should be able to reproduce that on their own hardware.

Two judges from the same model is not a second opinion, so keep `AGENT_MODEL` and
`VERIFIER_MODEL` different. To split them across providers entirely, run the attestor and
the verifier with different `.env` files; they are separate processes.

## The web app

A stream is created from the employer's **own wallet** — the browser sends the deployment
transaction itself. That is not a stylistic choice: `WorkStream` records
`employer = msg.sender` in its constructor and the field is immutable, so a factory would
own every stream it minted and `closeMilestone` would refund into it permanently. Streams
then announce themselves to a registry the agent reads.

Routes: `/` explains the system, `/streams` lists every registered stream, `/stream/<address>`
is one stream's ledger with role-aware actions, `/new` creates one, `/docs` is the technical
reference. Every action also exists as a `pnpm` command — the UI is a second front door,
never a replacement.

## Notes on Arc

- Native gas and ERC-20 USDC are the same asset at different scales: 18 decimals via
  `eth_getBalance`, 6 via `balanceOf`. All formatting goes through `config/src/amounts.ts`,
  which has a round-trip test.
- **Multicall3 is deployed** at the canonical address, and batching reads through it is the
  difference between a 5-second page load and a 200-millisecond one.
- Arc's USDC contract calls a blocklist precompile that local EVMs lack, so USDC calls
  cannot run inside a `forge script`. Deployment is deploy-only; funding runs through
  `cast send` against the live node.
- The public RPC rate-limits aggressively. Reads are sequential with backoff.

## Roadmap

- **Per-call pricing by model.** The verifier currently charges $0.005 while its own
  inference costs ~$0.018 — it runs at a loss. Buyers should choose how many models review
  their work, and the price should follow.
- **Model-provenance receipts**, signed by the verifier against the provider's generation
  record, so a false claim about which model ran is at least attributable.
- **A verifier marketplace**, so the second opinion comes from an independent operator.
- **Post-deployment policy changes**, so an employer can adjust terms without deploying a
  new stream.
