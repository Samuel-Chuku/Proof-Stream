# Source map

Generated facts are indexed in [generated/source-index.json](../generated/source-index.json). The source map is a reading guide:

- contracts and invariants: `contracts/src/WorkStream.sol`, `contracts/src/StreamRegistry.sol`, and `contracts/test/`;
- deployment: `contracts/script/`, `scripts/preflight-deploy.ts`, and `deploy/`;
- shared chain/config/artifacts: `config/src/`, `.env.example`, `web/lib/chain.ts`, and `scripts/sync-artifacts.ts`;
- attestor and verifier: `agent/src/pipeline.ts`, `chain.ts`, `github.ts`, `registry.ts`, `reconcile.ts`, `verdict.ts`, `verifier/`, and tests;
- operator CLI: root `package.json` and `scripts/`;
- frontend: `web/lib/`, `web/app/`, `web/public/BRAND.md`, `web/app/tokens.css`, and `web/app/globals.css`;
- evidence: `EVIDENCE.md`, `scripts/evidence.ts`, and runtime JSONL files, which are intentionally ignored.

If a reference cannot cite a path and symbol from this map, classify the claim as unresolved rather than guessing.
