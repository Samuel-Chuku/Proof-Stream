# Lifecycle and money flow

The exact function and event signatures are generated in [contracts-reference.md](../generated/contracts-reference.md). Use that file instead of copying this summary into code.

1. The employer deploys `WorkStream` with the configured USDC, contributor, agent, and terms.
2. The employer registers the address in `StreamRegistry` if the agent should discover it.
3. The employer approves the stream to spend the required USDC and calls `fund`.
4. The employer opens a milestone with text, budget, and duration. Funding and activation preconditions are enforced by the contract.
5. The agent receives a verified external evidence signal or finds it during reconciliation.
6. The attestor collects evidence, judges the milestone, and records its decision.
7. The attestor purchases a verifier review. The implemented payment path settles before the handler can finish, so a failed review may still cost its fee.
8. If the two judgments satisfy the implemented agreement rule, the attestor signs an EIP-712 attestation and submits `certify`.
9. The contract verifies signer, nonce, expiry, milestone, payee, and caps, then updates certification and settled credit according to its current code.
10. Time and completion-derived getters determine earned and withdrawable credit.
11. The contributor calls `withdraw(to, amount)` to pull USDC to an allowlisted payee and verifies the receipt plus new state.

Pause, close, expiration, repository mutation, and certification races have important current limitations. Read [security.md](security.md) before building an automated operator and [limitations.md](limitations.md) before describing guarantees.

## Receipt rule

For every write, persist the request context before submission, wait for the receipt, require success, decode the expected event, and reread the contract. If a timeout occurs, query by nonce and event before retrying. Never infer failure from a missing local callback or success from a hash alone.
