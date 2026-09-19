import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function npmPack(destination) {
  if (process.platform === 'win32') return exec(process.execPath, [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'pack', '--json', '--pack-destination', destination], { cwd: root, windowsHide: true });
  return exec('npm', ['pack', '--json', '--pack-destination', destination], { cwd: root, windowsHide: true });
}
async function main() {
  const destination = await mkdtemp(join(tmpdir(), 'proofstream-repro-'));
  try {
    const first = JSON.parse((await npmPack(destination)).stdout)[0].filename;
    const firstHash = createHash('sha256').update(await readFile(resolve(destination, first))).digest('hex');
    const second = JSON.parse((await npmPack(destination)).stdout)[0].filename;
    const secondHash = createHash('sha256').update(await readFile(resolve(destination, second))).digest('hex');
    if (firstHash !== secondHash) throw new Error(`Package is not reproducible: ${firstHash} != ${secondHash}`);
    console.log(`Reproducible package: ${firstHash}`);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
