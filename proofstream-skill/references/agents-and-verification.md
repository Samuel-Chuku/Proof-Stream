# Attestor and verifier integration

## Actual pipeline

The attestor process discovers registered streams, matches a repository event or reconciliation result, verifies repository, branch, and accepted-author rules, resolves a public earner when required, fetches evidence, optionally runs generated tests in an isolated sandbox, calls a configured model, records a verdict, buys a second opinion through the implemented Gateway/x402 path, compares the two decisions, signs an EIP-712 attestation when the agreement and evidence-improvement policies permit, submits it through the Circle-controlled wallet path, polls for terminal state, and reconciles uncertain transactions.

The verifier exposes a health route and a paid verification route in the current agent implementation. Payment is settled by middleware before the handler completes. This means a malformed request or failed model review can still cost the configured fee. Treat these routes as experimental operator interfaces, not a stable public API.

## Judgment model

Evidence, judgment, and financial authorization are three separate layers:

1. evidence says what the external source returned;
2. the optional correctness pass runs a model-generated suite against the merge and a reference snapshot, mechanically discarding failures shared by both;
3. the attestor and verifier models interpret the available evidence with confidence and a verdict;
4. the contract authorizes only a signed result inside deterministic terms and caps.

Generated tests are evidence, not a payout oracle. Treat suites that do not load, assert nothing, time out, or lack a usable reference as unavailable or inconclusive. Compare pass counts only when the cached suite id is unchanged. Regenerating a suite creates a new ruler and cannot prove improvement against an older count.

Confidence is not a probability proof. Agreement between two model calls is not independent ground truth when the provider, prompt, evidence, or operator is shared.

## Signing and refusal

The attestor must serialize the exact attestation fields and EIP-712 domain used by the contract. It must not sign an expired, duplicate, mismatched, over-cap, unsupported, or non-improving decision. Public attestations must credit the accepted earner id; named and claimed streams must leave that field zero. Refusal, malformed model output, missing evidence, inconclusive tests, disagreement, timeout, or verifier failure should remain an auditable non-certification outcome.

## Provider and wallet boundaries

Model keys, Circle wallet identifiers, API tokens, and webhook secrets stay in the operator environment. The browser never receives them. Keep attestor and verifier credentials separate. Model fallback and metering behavior are implementation details that must be regenerated and tested when dependencies change.

## Limitations

The current system does not prove model provenance, inference correctness, source truth, or organizational independence of the verifier. A compromised attestor can authorize any result allowed by its key and contract caps. A compromised evidence source, model provider, webhook secret, RPC, or operator can distort off-chain judgment. See [security.md](security.md).
