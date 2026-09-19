# Operating ProofStream

## Configuration

Start from `.env.example` and the generated environment inventory. Keep secrets in an operator secret store or environment, not in the checkout. Validate chain ID, public addresses, wallet separation, RPC reachability, native gas, USDC balances, verifier fee balance, repository access, and webhook secret before starting an agent.

## Services and commands

The repository provides systemd units under `deploy/`, attestor and verifier start scripts, preflight scripts, log pull, stream status, evidence generation, and transaction helpers. Read [cli.md](cli.md) for exact current commands and money impact. Preflight is not automatically a dry run: verify each script before using it around funds.

## Monitoring

Monitor health, registry refresh age, webhook acceptance, evidence-to-verdict latency, correctness-suite cache age and sandbox failures, verifier fee balance, Circle wallet status, RPC failures, nonce gaps, certification receipts, public binding and payout failures, reconciliation backlog, and withdrawable balances. Alert on repeated timeouts and paid failures. Store `agent/suites/` and JSONL ledgers outside deploy-overwritten paths in production. The current repository does not provide a durable queue, global paid-call kill switch, or complete circuit-breaker layer.

## Recovery

On restart, read the last durable event cursor and scan a bounded finalized range. For an uncertain certification, query the receipt, decoded event, nonce, and contract state before submitting again. For a failed model or verifier, record refusal and retry only under an explicit idempotency policy. Back up runtime JSONL outside the repository if it is part of an operational audit trail.

## Production posture

Run the attestor and verifier with separate wallet identities and least privilege. Pin dependency versions, use a dedicated RPC or failover list, cap resource usage, rotate secrets with a blast-radius plan, and require a human review for changing deployment metadata. These are recommended controls; mark them as such where the current source does not implement them.
