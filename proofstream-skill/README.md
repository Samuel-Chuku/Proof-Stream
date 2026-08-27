# ProofStream Integration Skill

An installable, offline-capable skill for developers and coding agents integrating ProofStream work streams on Arc.

## Status

Version `0.1.0` is an experimental package pinned to ProofStream commit `ce754c1a6c56ad65657b9482ffca9aa96ee8cfad`. It is not currently published to npm. The repository is the source of truth; generated references are checked for drift.

## Install locally

From this repository:

```bash
pnpm --filter proofstream-integration-skill generate
pnpm --filter proofstream-integration-skill pack:release
node proofstream-skill/bin/proofstream-skill.mjs install --target ./tmp/.agents/skills/proofstream-integration
node proofstream-skill/bin/proofstream-skill.mjs doctor --path ./tmp/.agents/skills/proofstream-integration
```

The installer is idempotent, offline by default, and refuses to replace an unrelated directory without an explicit force option.

## Distribution paths

- **npx:** not currently published. After package ownership and licensing are approved, the intended command is `npx proofstream-integration-skill init`.
- **GitHub Release ZIP:** release automation will produce a versioned ZIP, SHA-256 checksum, compatibility metadata, and npm tarball.
- **Git clone:** clone a release tag, run `pnpm install --frozen-lockfile`, generate references, then use the local CLI.
- **Offline agent:** install into `.agents/skills/proofstream-integration`, `.codex/skills/proofstream-integration`, or `.claude/skills/proofstream-integration` and point the coding agent at `SKILL.md`.

## CLI

```text
proofstream-skill install [--target <dir>] [--force] [--json]
proofstream-skill init [--target <project>] [--agent generic|codex|claude] [--json]
proofstream-skill doctor [--path <skill>] [--network] [--json]
proofstream-skill docs [topic] [--path] [--json]
proofstream-skill version [--json]
proofstream-skill help
```

Read [references/cli.md](references/cli.md) for exit codes and safety semantics.

## Brand media direction

The skill directs agents to create ProofStream-consistent flyers, banners, social graphics, presentation covers, and motion briefs. Read [`references/creative-production.md`](references/creative-production.md), copy a template from [`templates/media/`](templates/media/), and validate it before export:

```bash
proofstream-skill creative-check templates/media/creative-brief.example.json --json
proofstream-skill docs flyer --path
```

This is a tool-neutral creative workflow. Image/video generation is not bundled, and official marks must not be redistributed until rights are confirmed.

## Start here

1. Read [SKILL.md](SKILL.md).
2. Check [generated/compatibility.json](generated/compatibility.json) and [generated/consumables.json](generated/consumables.json).
3. Follow [references/integration-guide.md](references/integration-guide.md).
4. Run `proofstream-skill doctor` before relying on a copied package.

## License

The repository currently has no root license at the pinned commit. Do not publish or redistribute this package until the maintainer selects a license and confirms rights for any bundled brand assets.
