# Current limitations register

This register is intentionally short and blunt. It is pinned to the ProofStream commit in `generated/compatibility.json` and must be regenerated or re-audited on each release.

| Area | Current limitation | Impact | Source |
| --- | --- | --- | --- |
| Contract finalization | Certification after close can produce a misleading success path without the expected settled credit. | Contributor may see an event but not receive the expected credit. | `contracts/src/WorkStream.sol`, `closeMilestone`, `certify` |
| Pause semantics | Agent behavior and contract certification behavior are not aligned. | Pausing can prevent off-chain recognition while funds remain subject to contract timing. | `agent/src/pipeline.ts`, `contracts/src/WorkStream.sol` |
| Repository terms | `setRepo` has no live-milestone state precondition. | Employer can change the evidence target mid-milestone. | `contracts/src/WorkStream.sol`, `todo.md` |
| Registry provenance | Registration checks are insufficient to prove a complete WorkStream implementation. | Lookalikes can consume discovery and operator resources. | `contracts/src/StreamRegistry.sol`, `agent/src/registry.ts` |
| Web writes | Some create steps do not wait for all receipts before navigation. | UI can show a false funded state. | `web/app/new/page.tsx` |
| Paid verifier | Payment settles before handler validation completes. | A failed review can still cost its fee. | `agent/src/verifier/index.ts` |
| Runtime resilience | Body/file bounds, timeouts, durable queueing, and global paid-call controls are incomplete. | Availability and cost blast radius are larger than production standard. | `agent/src/index.ts`, `agent/src/verifier/index.ts`, `todo.md` |
| AI trust | Two model opinions are not objective or cryptographic proof. | Model, prompt, provider, evidence, and operator compromise remain possible. | `agent/src/verdict.ts`, `agent/src/verifier/review.ts` |
| Deployment identity | README and EVIDENCE disagree on the current WorkStream address. | Integrators can read the wrong contract. | `README.md`, `EVIDENCE.md` |
| Distribution | Root license and asset rights require maintainer decision. | Public npm and ZIP publication must remain gated. | repository root |
