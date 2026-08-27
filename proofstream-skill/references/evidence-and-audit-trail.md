# Evidence and audit trail

GitHub webhook payloads and reconciliation identify merged work. The agent verifies the configured webhook signature, parses repository and branch semantics, fetches a diff, and records a verdict and verifier review in JSONL runtime logs. The evidence report generator renders a human-readable account from those records and on-chain transaction links.

Treat these as different proof classes:

- **Source evidence:** what GitHub returned, including repository, branch, pull request, commit, and diff identity when available.
- **Interpretation:** the attestor and verifier output, confidence, model/provider metadata, and refusal or error.
- **Financial proof:** receipt status, `MilestoneCertified`, `Withdrawn`, USDC transfer, nonce, and contract state.

JSONL logs are append-only process files in the current implementation, not a durable hosted audit database. The web app may read an events URL or local records and must validate them before rendering. A generated evidence report is not a replacement for on-chain verification.

## Webhook rules

Use the repository's HMAC derivation and signature check exactly. Bound raw body size before parsing, reject invalid signatures before expensive work, rate-limit unauthenticated ingress, and enqueue or persist accepted work before acknowledging it in a production design. The current implementation has known resource and durability limitations; do not document those recommended controls as already shipped.
