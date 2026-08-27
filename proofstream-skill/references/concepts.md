# ProofStream concepts

## What it is

ProofStream is a work-stream contract plus an off-chain attestation pipeline. The employer funds a USDC budget for a contributor's milestone. External evidence is collected, interpreted by an attestor, reviewed by a verifier, and authorized on-chain by a signed attestation. The contract controls accounting and withdrawal rules; it does not prove that a model's interpretation is correct.

The repository's stated beachhead is grant and bounty milestone disbursement for ecosystem funds and DAOs. Payroll and a two-sided freelance marketplace are not the current product contract.

## Core terms

- **Employer:** the `msg.sender` that deploys and controls the stream.
- **Contributor:** the address allowed to withdraw milestone credit.
- **Attestor:** the configured address whose EIP-712 signature authorizes certification.
- **Verifier:** the second-opinion service called through the implemented x402/Circle payment path.
- **Milestone:** text, budget, duration, repository descriptor, funding, and certification progress.
- **Evidence:** external facts fetched from the configured source, currently GitHub-shaped in the repository.
- **Verdict:** the attestor model's interpretation of evidence.
- **Review:** the verifier model's independent opinion as implemented, not a cryptographic proof.
- **Certification:** an on-chain transaction carrying a valid attestation and signature.
- **Accrued / earned:** contract-derived time and completion calculations. Read the generated ABI and lifecycle reference for exact formulas.
- **Withdrawable:** the amount the contributor may pull to an allowlisted payee at the time of the read.

## Trust boundary

The chain can enforce signer, nonce, expiry, milestone, payee, budget, and policy limits. It cannot independently fetch a pull request, evaluate a diff, or know whether a model is honest. GitHub, model providers, Circle wallets, RPCs, the webhook secret, and operators remain trust dependencies.
