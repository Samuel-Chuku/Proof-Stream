# Lifecycle and money flow

The exact function and event signatures are generated in [contracts-reference.md](../generated/contracts-reference.md). Use that file instead of copying this summary into code.

1. The employer selects exactly one stream mode: named contributor, claimable contributor, or public earners, then deploys `WorkStream` with the corresponding roles and caps.
2. The employer registers the address in `StreamRegistry` if the agent should discover it.
3. The employer approves the stream to spend the required USDC and calls `fund`.
4. A named or public stream activates when fully funded. A claimable stream activates only after full funding and a valid `claim` transaction.
5. The agent receives a verified external evidence signal or finds it during reconciliation.
6. The attestor enforces repository, branch, and author rules. For a public stream it derives the accepted earner id before any paid work.
7. When enabled, the attestor generates a suite from the milestone, runs it against the merge and a reference snapshot in the sandbox, discards failures shared by both, and passes the surviving evidence to judgment. An unavailable or inconclusive suite is not a certification by itself.
8. The attestor purchases a verifier review. The implemented payment path settles before the handler can finish, so a failed review may still cost its fee.
9. If the two judgments satisfy the implemented agreement rule and the evidence can raise the standing certification, the attestor signs an EIP-712 attestation and submits `certify`.
10. The contract verifies signer, nonce, expiry, milestone, stream-mode fields, and certification caps, then updates named credit or public-earner shares.
11. Time and completion-derived getters determine earned credit. A named or claimed contributor calls `withdraw`. A public earner obtains a binding authorization, calls `bindPayee` from that payee, then calls `withdrawFor` subject to per-call and per-day payout caps.

Pause, close, expiration, repository mutation, and certification races have important current limitations. Read [security.md](security.md) before building an automated operator and [limitations.md](limitations.md) before describing guarantees.

## Receipt rule

For every write, persist the request context before submission, wait for the receipt, require success, decode the expected event, and reread the contract. If a timeout occurs, query by nonce and event before retrying. Never infer failure from a missing local callback or success from a hash alone.
