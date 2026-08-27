import { exists, copyPayload, safeTarget } from '../lib/files.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export async function install({ target, force = false, base = process.cwd() } = {}) {
  const resolvedBase = resolve(base);
  const destination = safeTarget(target || join(resolvedBase, '.agents', 'skills', 'proofstream-integration'), resolvedBase);
  if (await exists(destination)) {
    if (!force) throw new Error(`Install target already exists: ${destination}. Use --force only after reviewing it.`);
    const manifest = join(destination, 'manifest.json');
    if (!(await exists(manifest))) throw new Error('Refusing to replace an existing directory without a skill manifest.');
  }
  await mkdir(dirname(destination), { recursive: true });
  if (await exists(destination)) {
    const backup = `${destination}.previous-${process.pid}`;
    await copyPayload(backup);
    const { rm, rename } = await import('node:fs/promises');
    await rm(destination, { recursive: true, force: true });
    await rename(backup, destination);
  } else {
    await copyPayload(destination);
  }
  return { installed: destination };
}
