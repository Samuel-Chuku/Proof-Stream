# ProofStream UI and UX integration

## State language

Use contract truth as the primary status and agent interpretation as a secondary evidence trail.

| State | User-facing meaning | Action |
| --- | --- | --- |
| Unfunded | Terms exist but no usable budget is deposited. | Fund or edit before activation if allowed. |
| Awaiting claim | A claimable stream is funded but has no contributor yet. | Present the authorized claim flow without starting the clock early. |
| Active | The milestone is funded and within its running window. | Monitor evidence and certification. |
| Public earner unbound | The public earner has credit but has not selected a payee. | Authenticate the earner and present one-time payee binding. |
| Pending judgment | Evidence is available and the attestor has not finished. | Show evidence age and wait. |
| Verifier review | A second opinion is being requested. | Show that a paid review is in progress. |
| Refused | The evidence or judgments did not satisfy the policy. | Explain the reason and next review path. |
| Certified pending | A certification transaction was submitted but not confirmed. | Show hash, confirmations, and unknown on timeout. |
| Certified | Receipt, event, and contract state agree. | Show accrued and withdrawable values. |
| Paused | The stream is paused under contract state. | Explain which actions are currently available. |
| Closed or expired | The milestone is finalized or its window ended. | Show final accounting and any remaining recovery path. |
| Withdrawn or paid out | A named `Withdrawn` or public `PaidOut` receipt and transfer are confirmed. | Link the transaction and remaining amount. |
| Failed | A receipt reverted or an external operation failed. | Explain retry safety and recovery. |

Use square, information-dense surfaces, neutral backgrounds, mono type for addresses and hashes, and one clear action per state. Avoid fabricated metrics and decorative status pills. Provide loading skeletons, empty states, and accessible error recovery. Respect reduced motion.

## React pattern

The included example accepts verified read data and renders a state explanation. It does not infer certification from a local agent log, generated test result, or transaction hash. Branch the write UI on `isPublic`, `claimAuthority`, and `contributor`; do not show named `withdraw` controls for a public stream or public binding controls for a named stream. Keep write actions disabled until account, chain, receipt, and post-state checks pass.
