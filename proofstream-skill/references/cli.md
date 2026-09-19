# CLI reference

The generated command inventory is [generated/cli-reference.json](../generated/cli-reference.json). The repository commands are wrappers around the actual scripts in `scripts/`; read each script before running a money-moving command.

## Skill CLI

| Command | Purpose | Network or money | Retry safety |
| --- | --- | --- | --- |
| `proofstream-skill install` | Copy this skill into a project-local target. | Local only. | Safe when target is absent or already matching. Refuses unrelated overwrite. |
| `proofstream-skill init` | Detect an agent directory and install locally. | Local only. | Safe when target is absent; inspect conflicts. |
| `proofstream-skill doctor` | Validate files, checksums, schemas, links, versions, and secret patterns. | Offline by default. `--network` is read-only. | Safe to repeat. |
| `proofstream-skill docs` | List topics or locate a reference file. | Local only. | Safe to repeat. |
| `proofstream-skill creative-check <brief.json>` | Validate a media brief against ProofStream brand, evidence, rights, and accessibility rules. | Local only; never moves money. | Safe to repeat. |
| `proofstream-skill version` | Print skill and ProofStream compatibility. | Local only. | Safe to repeat. |

Use `--json` for automation. Exit codes are `0` success, `1` validation failure, `2` usage error, `3` target conflict, `4` integrity failure, and `5` optional live-network failure.

## Repository CLI safety

Commands such as `preflight:*`, `check:chain`, `stream:status`, `logs:pull`, and `evidence` should be read-only or diagnostic only after verifying their current source. Commands including `fund`, `withdraw`, `sweep`, `gateway:deposit`, `verify:once`, `agent:dev`, `verifier:dev`, `seed`, and deployment helpers may submit transactions, spend fees, or create runtime state. Do not run them automatically from a product install. Use the generated command inventory and current `.env.example` to document exact flags and requirements at release time.
