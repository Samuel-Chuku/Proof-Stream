# ProofStream operator runbook

## Before start

- Confirm the pinned commit, chain ID, registry, USDC, and stream addresses.
- Run all applicable preflight checks.
- Confirm attestor and verifier wallets are separate and funded for their intended fees.
- Confirm repository access and webhook signature handling.
- Confirm logs live outside the checkout and are backed up if they are part of the audit trail.

## During operation

- Monitor health, registry age, evidence, model, verifier, nonce, receipt, and withdrawal signals.
- Treat timeout as unknown until the chain is queried.
- Do not retry a write until current state and nonce have been checked.

## Incident

Disable the affected worker, preserve payloads and logs, inspect receipts and contract state from a second RPC, rotate only the compromised credential, and record the exact affected stream and nonce. Escalate unresolved financial state to a human operator.
