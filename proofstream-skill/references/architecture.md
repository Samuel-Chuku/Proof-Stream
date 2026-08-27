# ProofStream architecture

```text
user
  -> integrating product
  -> WorkStream and StreamRegistry on Arc
  -> attestor process
  -> external evidence source
  -> primary model judgment
  -> paid verifier opinion
  -> EIP-712 attestation
  -> on-chain certification
  -> accrual and settled credit
  -> contributor withdrawal
```

## On-chain

`WorkStream` stores immutable roles, milestone terms, funding, certification progress, policy caps, nonce, domain separator, and withdrawal accounting. `StreamRegistry` lets the agent discover registered streams. USDC is the token being approved, funded, credited, and withdrawn. Events and receipts are the durable proof surface.

## Off-chain

The attestor receives GitHub evidence through webhook and reconciliation paths, fetches a diff, calls a configured model, records verdicts, purchases a verifier review, signs an attestation, submits a transaction, and reconciles uncertain outcomes. The web app reads chain state and optional agent logs and renders a product view. None of these off-chain logs can override contract state.

## Responsibilities and boundaries

| Component | Responsible for | Does not guarantee |
| --- | --- | --- |
| Employer/product | terms, funding, repository descriptor, user experience | that evidence or model judgment is correct |
| Contract | deterministic custody, caps, signer, nonce, expiry, payee, accounting | semantic truth of external work |
| Attestor | evidence collection, primary judgment, signed submission | unbiased or correct judgment |
| Verifier | second model opinion through the paid path | independent human or cryptographic verification |
| GitHub/evidence source | source facts and access control | availability or truthful semantics beyond its API |
| Circle/Gateway/RPC | payment, wallet, transport, chain access | permanent availability or correct application logic |
| Frontend | presentation and user actions | transaction finality unless it checks receipts and state |

ProofStream does not currently provide a public SDK, stable REST integration API, hosted webhook delivery platform, or trustless AI proof.
