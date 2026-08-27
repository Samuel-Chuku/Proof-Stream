# ProofStream security guide

## Threat model

The contract protects custody only through code. The employer controls terms, funding, pause, close, repository configuration, and policy changes allowed by the current implementation. The contributor controls its wallet and withdrawal calls. The attestor controls an EIP-712 signing key and can submit certifications. The verifier controls a second model opinion. GitHub, Circle, model providers, RPCs, webhook secrets, frontend sessions, and operators are external trust dependencies.

## Contract controls

The generated ABI and source enforce signer recovery, nonce and expiry, milestone matching, payee allowlisting, tranche and daily caps, funding, and withdrawal limits. Use custom errors and post-state reads in integrations. Contract controls are not a substitute for correct evidence.

## Key boundaries

- Employer and contributor private keys never enter the skill, browser bundle, or model context.
- Circle developer-controlled wallet identifiers and secrets stay with the service that needs them.
- Attestor and verifier wallets are separate and independently monitored.
- Webhook secrets are scoped to the stream or source and rotated without exposing them in logs.
- RPC credentials, if any, are not public configuration.

## Known risks at the pinned commit

- A valid certification after close can emit success while closed-state accounting prevents the expected credit from becoming settled.
- The agent may skip paused streams although the contract path has different pause behavior.
- Employer-controlled `setRepo` lacks the live-milestone precondition described in the project backlog.
- Registry registration does not establish complete WorkStream provenance and can admit lookalikes.
- Web create actions can navigate after a hash without waiting for every receipt.
- Verifier input allowlisting, webhook body bounds, event-file bounds, external timeouts, durable queues, and a global paid-call kill switch are incomplete.
- x402 settlement can happen before handler validation, so failed reviews may be paid.
- AI confidence and verifier agreement do not establish truth or cryptographic model provenance.

Document mitigations, affected source symbols, and release status in [limitations.md](limitations.md). Do not hide these behind marketing language.

## Incident response

If an attestor key is compromised, pause operations, preserve logs, identify signed nonces and affected streams, rotate the wallet, and verify on-chain state. If an evidence source or webhook secret is compromised, disable ingress, preserve payloads, invalidate derived judgments, and require re-evaluation. If an RPC is suspect, compare receipts, logs, code, and balances through a second endpoint. Never recover funds by inventing an admin rescue path that the contract does not expose.
