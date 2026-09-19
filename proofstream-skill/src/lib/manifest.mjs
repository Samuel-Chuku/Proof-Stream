import { readJson, PACKAGE_ROOT } from './files.mjs';

export async function loadManifest(root = PACKAGE_ROOT) {
  return readJson(`${root}/manifest.json`);
}

export async function loadCompatibility(root = PACKAGE_ROOT) {
  return readJson(`${root}/generated/compatibility.json`);
}

export function validateManifest(manifest) {
  const required = ['schemaVersion', 'name', 'skillVersion', 'cli', 'entrypoint', 'compatibility', 'integrity'];
  const missing = required.filter((key) => typeof manifest?.[key] !== 'string');
  if (missing.length) throw new Error(`Manifest missing required fields: ${missing.join(', ')}`);
  if (manifest.name !== 'proofstream-integration') throw new Error(`Unexpected skill name: ${manifest.name}`);
  if (manifest.cli !== 'proofstream-skill') throw new Error(`Unexpected CLI name: ${manifest.cli}`);
}
