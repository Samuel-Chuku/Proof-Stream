# Contract and API reference

The canonical generated catalog is [generated/contracts-reference.md](../generated/contracts-reference.md). The ABI JSON files are [workstream.abi.json](../generated/workstream.abi.json) and [stream-registry.abi.json](../generated/stream-registry.abi.json). Regenerate them from Foundry artifacts; do not edit them manually.

## WorkStream model

The contract stores immutable USDC, employer, contributor, and agent references. It stores milestone text and hash, budget, duration, funding, activation, certification progress, close state, policy caps, attestation nonce, and an EIP-712 domain separator. Public getters expose derived funding, activity, accrued, earned, withdrawable, target, and timing values. Exact tuple shapes and return types come from the ABI.

Writes include funding, milestone opening and closing, certification, withdrawal, pause/resume, repository setting, and policy raising as present in the generated ABI. Permissions and custom errors must be read from the implementation and tests together, because an ABI does not encode all business preconditions.

## Certification

The attestor signs the exact EIP-712 domain and struct encoded by `WorkStream.sol` and mirrored in `agent/src/chain.ts`. The contract checks signature recovery, nonce, expiry, milestone identity, payee, tranche, daily cap, and policy constraints according to the pinned code. A caller can submit a signature, but only the configured agent signer should authorize it.

## Registry

`StreamRegistry` discovers streams through employer and agent reads and emits `StreamRegistered`. Registration provenance is a known limitation. Treat a registered address as untrusted input until code and interface checks pass.

## State transitions

Build integration state from reads and events, not from UI route names. Keep these concepts distinct: deployed, registered, approved, funded, activated, active, paused, certified, closed, settled, earned, withdrawable, withdrawn, and unknown. See [lifecycle-and-money-flow.md](lifecycle-and-money-flow.md) for the safe sequence.
