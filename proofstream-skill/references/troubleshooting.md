# Troubleshooting

## “Wrong chain” or “no bytecode”

Read the chain ID from compatibility metadata, check the RPC, and call `getCode` for the exact address. Do not substitute a conflicting README or evidence address without resolving its status.

## “Funding failed”

Check employer identity, USDC decimals, allowance, balance, stream state, and receipt status. Re-read `funded()` before retrying. A hash without a successful receipt is not funded.

## “No stream is discovered”

Verify registration, registry address, employer and agent getters, repository descriptor, registry refresh age, and block cursor. A lookalike registration or stale registry can be present without being safe to serve.

## “No certification”

Inspect webhook signature, repository and branch match, evidence availability, model output, verifier payment/review, agreement policy, attestation expiry, nonce, caps, and paused/closed state. Separate refusal from transport failure.

## “Certification timed out”

Query the transaction receipt, `MilestoneCertified` logs, nonce, and contract getters from a second RPC before retrying. Reconciliation exists for this uncertainty; do not mark the evidence permanently failed from a timeout alone.

## “Withdrawal failed”

Check contributor identity, allowlisted payee, withdrawable amount, USDC balance, and receipt status. Reread state after any confirmed transfer.

## “Doctor fails”

Read the first failed check. Regenerate references, restore missing package files, resolve a checksum mismatch, repair a broken local link, or update the pinned compatibility decision. Do not silence the check by deleting generated metadata.
