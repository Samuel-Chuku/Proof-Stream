# ProofStream security guide

## Threat model

The contract protects custody only through code. The employer controls terms, funding, pause, close, repository configuration, accepted authors, and policy changes allowed by the current implementation. A named or claimed contributor controls its wallet and withdrawal calls. A claim authority decides who may claim a claimable stream. A public earner relies on the attestor to resolve the correct opaque identity and authorize one payee binding. The verifier controls a second model opinion. GitHub, Circle, model providers, RPCs, webhook secrets, frontend sessions, and operators are external trust dependencies.

## Contract controls

The generated ABI and source enforce signer recovery, nonce and expiry, milestone matching, stream-mode consistency, claim and payee signature binding, tranche and daily certification caps, public payout caps, funding, and withdrawal limits. Use custom errors and post-state reads in integrations. Contract controls are not a substitute for correct evidence or identity resolution.

## Key boundaries

- Employer and contributor private keys never enter the skill, browser bundle, or model context.
- Circle developer-controlled wallet identifiers and secrets stay with the service that needs them.
- Attestor and verifier wallets are separate and independently monitored.
- Claim-authority keys are separate from employer, attestor, and frontend identities.
- Webhook secrets are scoped to the stream or source and rotated without exposing them in logs.
- RPC credentials, if any, are not public configuration.

## Known risks at the pinned commit

- A valid certification after close can emit success while closed-state accounting prevents the expected credit from becoming settled.
- The agent may skip paused streams although the contract path has different pause behavior.
- `setRepo` and `setAuthors` lock after the first certification, but remain mutable during a live milestone before any certification.
- Registry registration does not establish complete WorkStream provenance and can admit lookalikes.
- Web create actions can navigate after a hash without waiting for every receipt.
- Verifier input allowlisting, webhook body bounds, event-file bounds, external timeouts, durable queues, and a global paid-call kill switch are incomplete.
- x402 settlement can happen before handler validation, so failed reviews may be paid.
- AI confidence and verifier agreement do not establish truth or cryptographic model provenance.
- Generated suites are model-authored and may be incomplete, unfair, or inconclusive; the reference filter removes shared failures but does not prove the surviving tests are sufficient.
- Public earner identity is resolved off chain. A wrong accepted identity or compromised binding signer can direct future payout authorization within the public payout caps.

Document mitigations, affected source symbols, and release status in [limitations.md](limitations.md). Do not hide these behind marketing language.

## Incident response

If an attestor key is compromised, pause operations, preserve logs, identify signed nonces and affected streams, rotate the wallet, and verify on-chain state. If an evidence source or webhook secret is compromised, disable ingress, preserve payloads, invalidate derived judgments, and require re-evaluation. If an RPC is suspect, compare receipts, logs, code, and balances through a second endpoint. Never recover funds by inventing an admin rescue path that the contract does not expose.
