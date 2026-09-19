import { cp, mkdir, readFile, readdir, rm, stat, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PAYLOAD_ROOT = PACKAGE_ROOT;

export const REQUIRED_FILES = [
  'SKILL.md',
  'README.md',
  'manifest.json',
  'generated/compatibility.json',
  'generated/checksums.json',
  'schemas/manifest.schema.json',
  'schemas/compatibility.schema.json',
  'schemas/consumables.schema.json',
  'schemas/source-index.schema.json',
  'schemas/install-config.schema.json',
  'references/integration-guide.md',
  'references/contracts.md',
  'references/creative-production.md',
  'schemas/creative-brief.schema.json',
  'templates/media/creative-brief.example.json',
];

export async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
    if (entry.isDirectory()) result.push(...await listFiles(root, path));
    else result.push(relative(root, path).replaceAll('\\', '/'));
  }
  return result.sort();
}

export function safeTarget(target, base = process.cwd()) {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  if (resolvedTarget === resolvedBase || isAbsolute(target) && resolvedTarget === resolve(dirname(resolvedBase))) {
    throw new Error('Refusing to install into a project root or filesystem parent. Choose a skill subdirectory.');
  }
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Install target must stay inside ${resolvedBase}`);
  }
  return resolvedTarget;
}

export async function sha256(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

export async function copyPayload(target) {
  const staging = `${target}.tmp-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await cp(PAYLOAD_ROOT, staging, {
    recursive: true,
    filter: (source) => {
      const rel = relative(PAYLOAD_ROOT, source).replaceAll('\\', '/');
      return rel === '' || (!rel.startsWith('node_modules/') && !rel.startsWith('.git/') && !rel.startsWith('test/') && !rel.startsWith('scripts/'));
    },
  });
  await rm(join(staging, 'package.json'), { force: true });
  await rename(staging, target);
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
