import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, listFiles, readJson, sha256 } from './files.mjs';

export async function verifyIntegrity(root) {
  const checksumPath = join(root, 'generated/checksums.json');
  if (!(await exists(checksumPath))) return { ok: false, errors: ['generated/checksums.json is missing'], checked: [] };
  const checksums = await readJson(checksumPath);
  const errors = [];
  const checked = [];
  for (const [rel, expected] of Object.entries(checksums.files || {})) {
    const path = join(root, rel);
    if (!(await exists(path))) { errors.push(`Missing checksummed file: ${rel}`); continue; }
    const actual = await sha256(path);
    checked.push(rel);
    if (actual !== expected) errors.push(`Checksum mismatch: ${rel}`);
  }
  return { ok: errors.length === 0, errors, checked };
}

export async function findInternalLinks(root) {
  const files = (await listFiles(root)).filter((file) => file.endsWith('.md'));
  const missing = [];
  const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const rel of files) {
    const text = await readFile(join(root, rel), 'utf8');
    for (const match of text.matchAll(markdownLink)) {
      const href = match[1].trim().split('#')[0];
      if (!href || href.startsWith('http:') || href.startsWith('https:') || href.startsWith('mailto:') || href.startsWith('#')) continue;
      const target = join(root, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', href);
      if (!(await exists(target))) missing.push(`${rel} -> ${href}`);
    }
  }
  return missing;
}
