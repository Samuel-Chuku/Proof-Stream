---
name: proofstream-integration
description: Integrate, operate, inspect, debug, and create brand-safe ProofStream product and media experiences on Arc using verified contracts, agent workflows, evidence rules, UI patterns, and CLI references pinned to one ProofStream commit.
metadata:
  short-description: Build and operate ProofStream integrations
---

# ProofStream integration

Use this skill when building a product, agent, dashboard, operator workflow, or contract integration around ProofStream. This skill describes the implementation at the pinned ProofStream commit in `generated/compatibility.json`. Read that file before making version-sensitive claims.

## Fast mental model

ProofStream is an Arc-based USDC work-stream system. An employer creates and funds a `WorkStream` for a contributor and a milestone. An off-chain attestor collects external work evidence, asks a model to judge it, buys an independent verifier opinion through the implemented payment path, and submits a signed EIP-712 attestation. The contract verifies the signer, nonce, expiry, milestone, payee, and policy caps before crediting the contributor. The contributor pulls available USDC with `withdraw`.

The contract is deterministic custody and accounting. GitHub, models, Circle wallets, RPCs, webhooks, and agent logs are off-chain dependencies. AI judgment is trusted interpretation, not trustless inference.

## Read the right reference

- Contract functions, events, errors, permissions, and state transitions: [references/contracts.md](references/contracts.md) and [generated/contracts-reference.md](generated/contracts-reference.md).
- Product integration and receipt-safe money flows: [references/integration-guide.md](references/integration-guide.md).
- Lifecycle and money movement: [references/lifecycle-and-money-flow.md](references/lifecycle-and-money-flow.md).
- Attestor, verifier, evidence, x402, and EIP-712 behavior: [references/agents-and-verification.md](references/agents-and-verification.md).
- UI state mapping and React patterns: [references/ui-ux.md](references/ui-ux.md).
- Flyers, banners, social graphics, decks, and motion briefs: [references/creative-production.md](references/creative-production.md), with copy-ready templates under `templates/media/`.
- Operator setup and recovery: [references/operations.md](references/operations.md) and [references/troubleshooting.md](references/troubleshooting.md).
- Threat model and current gaps: [references/security.md](references/security.md) and [references/limitations.md](references/limitations.md).
- Exact repository scripts and skill CLI: [references/cli.md](references/cli.md).
- Machine-readable chain, address, ABI, route, environment, and source data: `generated/`.

## Non-negotiable integration rules

1. Read the chain ID and addresses from the pinned compatibility metadata. Do not paste a README address into production code without checking its status. The current repository contains a WorkStream address conflict between `README.md` and `EVIDENCE.md`.
2. Use the generated ABI and the repository-pinned viem version. Do not hand-maintain a partial ABI.
3. Treat USDC amounts as six-decimal integers. Never use JavaScript floating point for a transfer.
4. For every write, wait for a receipt with `status: success`, decode the expected event, and read post-state. A transaction hash is pending evidence, not a payout.
5. Keep employer, contributor, attestor, verifier, and frontend keys separate. Never put a private key in a browser, example, prompt, log, or skill package.
6. Make retries explicit. A read can retry with bounded backoff. A write must check current state and nonce first and must not blindly resubmit.
7. Show pending, refused, failed, and unknown states honestly. Do not turn an agent verdict into an on-chain certification claim.
8. Label any feature absent from `generated/consumables.json` as `Not currently provided`.
9. For public creative, run `proofstream-skill creative-check <brief.json> --json`; use the pinned brand tokens and never imply that AI judgment is trustless or that a pending transaction is settled.

## Lifecycle in one view

```text
employer wallet
  -> deploy WorkStream
  -> register in StreamRegistry
  -> approve USDC and fund
  -> open and activate milestone
  -> agent receives verified external evidence
  -> attestor judgment and verifier opinion
  -> EIP-712 attestation submitted
  -> contract checks signer, nonce, expiry, milestone, payee, and caps
  -> certified credit becomes time-based earned/withdrawable USDC
  -> contributor withdraws to an allowlisted payee
```

The agent does not custody the employer's stream funds and cannot mint arbitrary credit outside the contract's rules. The agent can still make a wrong judgment, submit a validly signed wrong judgment, spend verifier fees, or stop operating. See [references/security.md](references/security.md).

## Minimal read-only workflow

Use `examples/read-stream.ts` with a verified WorkStream address:

```bash
node examples/read-stream.ts 0xYourWorkStreamAddress
```

It reads the contract using the generated ABI and reports raw units plus formatted USDC. For event history and missed notifications, use `examples/recover-events.ts` with a bounded block range.

## Money-moving workflow

Read [references/integration-guide.md](references/integration-guide.md) before implementing create, fund, certify, or withdraw. The repository's browser create flow is an implementation reference, not a guarantee that every current step waits for a successful receipt. The safe integration example deliberately verifies every step and remains non-executing until the caller supplies the write path.

## Version and trust posture

This package is experimental until its compatibility metadata, source conflicts, licensing, and runtime gates are resolved. It does not provide a public SDK, stable REST API, hosted webhook delivery service, or MCP server unless a future generated manifest says otherwise. It documents real interfaces and current limitations, not an idealized protocol.
