# Contributing to the ProofStream Integration Skill

## Ground rules

Keep the skill truthful to the exact ProofStream commit in `manifest.json`. Read the repository source before changing a claim. Do not add an SDK, endpoint, address, event, command, or guarantee that is not implemented.

Use agent-memory in the `project-x` folder for durable handoffs. Do not store secrets or customer data in memory, source, fixtures, examples, or generated output.

## Development

```bash
corepack pnpm install --frozen-lockfile
pnpm --filter proofstream-integration-skill generate
pnpm --filter proofstream-integration-skill test
pnpm --filter proofstream-integration-skill generate:check
```

The generator reads Foundry artifacts and repository manifests. Run it after contract, config, script, environment, route, or package changes. Generated files are committed with their source hashes so CI can detect drift.

Creative guidance must remain grounded in `web/public/BRAND.md`, `web/app/tokens.css`, and verified repository facts. Add or update a media brief under `templates/media/`, run `pnpm creative-check`, and keep claims sourced. Do not add logos, fonts, stock imagery, or model-provider dependencies without confirmed redistribution rights.

## Documentation changes

Put shared facts in one reference and link to it from `SKILL.md`. Use `Verified`, `Current limitation`, `Experimental`, `Roadmap`, or `Not currently provided` labels where appropriate. Every integration write must explain receipt verification, post-state verification, retry safety, and failure recovery.

## Release

Only a maintainer may create a `proofstream-skill-vX.Y.Z` tag. The release workflow runs all checks, creates deterministic artifacts and checksums, and publishes to npm only when the protected release environment, package ownership, license, and provenance configuration are present.
