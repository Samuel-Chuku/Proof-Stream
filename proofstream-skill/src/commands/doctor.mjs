import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, PACKAGE_ROOT, REQUIRED_FILES, listFiles, readJson } from '../lib/files.mjs';
import { loadManifest, loadCompatibility, validateManifest } from '../lib/manifest.mjs';
import { findInternalLinks, verifyIntegrity } from '../lib/integrity.mjs';

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:api[_-]?key|private[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}/i,
];

export async function doctor({ root = PACKAGE_ROOT, network = false } = {}) {
  const errors = [];
  const warnings = [];
  for (const file of REQUIRED_FILES) if (!(await exists(join(root, file)))) errors.push(`Missing required file: ${file}`);
  let manifest;
  let compatibility;
  try { manifest = await loadManifest(root); validateManifest(manifest); } catch (error) { errors.push(error.message); }
  try { compatibility = await loadCompatibility(root); } catch (error) { errors.push(`Invalid compatibility metadata: ${error.message}`); }
  if (manifest && compatibility && manifest.skillVersion !== compatibility.skillVersion) errors.push('Manifest and compatibility skillVersion differ.');
  if (manifest && compatibility && manifest.proofstream?.commit !== compatibility.proofstreamCommit) errors.push('Manifest and compatibility ProofStream commit differ.');
  for (const [schemaFile, value] of [['schemas/manifest.schema.json', manifest], ['schemas/compatibility.schema.json', compatibility]]) {
    try {
      const schema = await readJson(join(root, schemaFile));
      for (const key of schema.required || []) if (value && value[key] === undefined) errors.push(`${schemaFile} requires missing field: ${key}`);
    } catch (error) { errors.push(`Invalid schema ${schemaFile}: ${error.message}`); }
  }
  const integrity = await verifyIntegrity(root);
  errors.push(...integrity.errors);
  const links = await findInternalLinks(root);
  errors.push(...links.map((link) => `Broken internal link: ${link}`));
  const files = await listFiles(root);
  for (const rel of files) {
    if (rel === 'generated/checksums.json') continue;
    const content = await readFile(join(root, rel), 'utf8').catch(() => '');
    if (secretPatterns.some((pattern) => pattern.test(content))) errors.push(`Possible secret pattern in packaged file: ${rel}`);
  }
  if (compatibility?.releaseStatus !== 'stable') warnings.push(`Compatibility status is ${compatibility?.releaseStatus || 'unknown'}; do not present this as a stable protocol SDK.`);
  if (network) {
    const rpc = compatibility?.chain?.rpc;
    if (!rpc) errors.push('Compatibility metadata has no public RPC for --network checks.');
    else {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: controller.signal });
        clearTimeout(timer);
        const result = await response.json();
        if (result.result !== `0x${compatibility.chain.chainId.toString(16)}`) errors.push(`RPC chain ID mismatch: expected ${compatibility.chain.chainId}, got ${result.result || 'none'}`);
        if (!response.ok || result.error) errors.push(`RPC check failed: ${result.error?.message || response.status}`);
      } catch (error) { errors.push(`RPC check failed: ${error.name === 'AbortError' ? 'timeout' : error.message}`); }
    }
  }
  return { ok: errors.length === 0, errors, warnings, checked: { requiredFiles: REQUIRED_FILES.length, checksums: integrity.checked.length, markdownLinks: links.length === 0, networkRequested: network } };
}
