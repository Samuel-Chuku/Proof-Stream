# ProofStream UI and UX integration

## State language

Use contract truth as the primary status and agent interpretation as a secondary evidence trail.

| State | User-facing meaning | Action |
| --- | --- | --- |
| Unfunded | Terms exist but no usable budget is deposited. | Fund or edit before activation if allowed. |
| Active | The milestone is funded and within its running window. | Monitor evidence and certification. |
| Pending judgment | Evidence is available and the attestor has not finished. | Show evidence age and wait. |
| Verifier review | A second opinion is being requested. | Show that a paid review is in progress. |
| Refused | The evidence or judgments did not satisfy the policy. | Explain the reason and next review path. |
| Certified pending | A certification transaction was submitted but not confirmed. | Show hash, confirmations, and unknown on timeout. |
| Certified | Receipt, event, and contract state agree. | Show accrued and withdrawable values. |
| Paused | The stream is paused under contract state. | Explain which actions are currently available. |
| Closed or expired | The milestone is finalized or its window ended. | Show final accounting and any remaining recovery path. |
| Withdrawn | A contributor payout receipt and transfer are confirmed. | Link the transaction and remaining amount. |
| Failed | A receipt reverted or an external operation failed. | Explain retry safety and recovery. |

Use square, information-dense surfaces, neutral backgrounds, mono type for addresses and hashes, and one clear action per state. Avoid fabricated metrics and decorative status pills. Provide loading skeletons, empty states, and accessible error recovery. Respect reduced motion.

## React pattern

The included example accepts verified read data and renders a state explanation. It does not infer certification from a local agent log or transaction hash. Keep write actions disabled until account, chain, receipt, and post-state checks pass.
