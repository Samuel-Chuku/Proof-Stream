# ProofStream consumables

This is the external integration inventory. Generated machine-readable versions live in [generated/consumables.json](../generated/consumables.json), [generated/cli-reference.json](../generated/cli-reference.json), [generated/env-reference.json](../generated/env-reference.json), and [generated/routes.json](../generated/routes.json).

## On-chain consumables

- `WorkStream` ABI, bytecode, constructor, public getters, writes, events, errors, and EIP-712 attestation fields.
- `StreamRegistry` ABI, registration behavior, and discovery events.
- Arc Testnet chain ID and public addresses only when marked verified in compatibility metadata.
- USDC six-decimal token handling and receipt/event verification.

## Off-chain consumables

- GitHub webhook and reconciliation behavior implemented in the agent.
- JSONL verdict, review, and event records as current runtime files, not durable hosted storage.
- Circle developer-controlled wallet and Gateway/x402 payment dependencies.
- Operator service units under `deploy/`.

## Agent consumables

The attestor pipeline, verifier route, evidence collection, model provider configuration, metering, agreement logic, EIP-712 signing, transaction polling, and reconciliation are internal implementation seams. They may be integrated by an operator using the documented environment and commands, but there is no separately versioned public agent SDK.

## Web/UI consumables

The Next.js app exposes pages and route handlers listed in `generated/routes.json`. Its `web/lib` readers and writers are reusable source examples, not a published frontend package. Browser users must never receive the attestor or verifier private credentials.

## Not currently provided

There is no stable public REST API, webhook subscription product, npm SDK, MCP server, hosted event stream, or guaranteed independent verifier marketplace in the pinned repository.
