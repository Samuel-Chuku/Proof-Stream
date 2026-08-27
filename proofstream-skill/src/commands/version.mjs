import { loadCompatibility, loadManifest } from '../lib/manifest.mjs';

export async function version() {
  const [manifest, compatibility] = await Promise.all([loadManifest(), loadCompatibility()]);
  return {
    skill: manifest.name,
    skillVersion: manifest.skillVersion,
    cli: manifest.cli,
    proofstreamCommit: compatibility.proofstreamCommit,
    chainId: compatibility.chain?.chainId ?? null,
    compatibilitySchema: compatibility.schemaVersion,
  };
}
