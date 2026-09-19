# Contract and API reference

The canonical generated catalog is [generated/contracts-reference.md](../generated/contracts-reference.md). The ABI JSON files are [workstream.abi.json](../generated/workstream.abi.json) and [stream-registry.abi.json](../generated/stream-registry.abi.json). Regenerate them from Foundry artifacts; do not edit them manually.

## WorkStream model

The contract stores immutable USDC, employer, and agent references plus one of three payout modes. A named stream fixes the contributor at deployment. A claimable stream stores a claim authority and binds its contributor once through `claim`. A public stream has neither and credits opaque earner ids. The contract also stores milestone text and hash, budget, duration, funding, activation, certification progress, close state, author rules, certification and payout caps, attestation nonce, public-earner shares, and an EIP-712 domain separator. Exact tuple shapes and return types come from the ABI.

Writes include funding, claiming, milestone opening and closing, certification, named withdrawal, public payee binding and payout, pause/resume, repository and author setting, and policy raising as present in the generated ABI. Permissions and custom errors must be read from the implementation and tests together, because an ABI does not encode all business preconditions.

## Certification

The attestor signs the exact EIP-712 domain and struct encoded by `WorkStream.sol` and mirrored in `agent/src/chain.ts`. The contract checks signature recovery, nonce, expiry, milestone identity, earner-mode rules, tranche, daily cap, and policy constraints according to the pinned code. A public certification must carry a nonzero earner id; a named or claimed stream must carry zero. A caller can submit a signature, but only the configured agent signer should authorize it.

## Claimable and public payouts

For a claimable stream, verify the claim-authority signature over the caller's address, wait for `Claimed`, and reread `contributor`, `policy`, and activation state. For a public stream, use `earnerShare` and `earnerWithdrawable`; bind a payee once with an agent-signed `PAYEE_BINDING_TYPEHASH` authorization whose payee is also `msg.sender`; then call `withdrawFor`. Public payout caps are separate from certification caps.

## Registry

`StreamRegistry` discovers streams through employer and agent reads and emits `StreamRegistered`. Registration provenance is a known limitation. Treat a registered address as untrusted input until code and interface checks pass.

## State transitions

Build integration state from reads and events, not from UI route names. Keep these concepts distinct: deployed, registered, named, awaiting claim, public, funded, activated, paused, certified, earner credited, payee bound, closed, settled, withdrawable, paid out, and unknown. See [lifecycle-and-money-flow.md](lifecycle-and-money-flow.md) for the safe sequence.
