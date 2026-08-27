import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, '../dist/proofstream-skill');

async function npmPack(destination) {
  if (process.platform === 'win32') {
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return exec(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', destination], { cwd: root, windowsHide: true });
  }
  return exec('npm', ['pack', '--json', '--pack-destination', destination], { cwd: root, windowsHide: true });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function payloadFiles(current = root, prefix = '') {
  const entries = await readdir(current, { withFileTypes: true });
  const allowed = new Set(['SKILL.md', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'manifest.json', 'agents', 'bin', 'src', 'references', 'generated', 'examples', 'templates', 'schemas']);
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!prefix && !allowed.has(entry.name)) continue;
    if (entry.name === 'test' || entry.name === 'scripts' || entry.name === 'node_modules') continue;
    const path = join(current, entry.name);
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await payloadFiles(path, `${rel}/`));
    else result.push({ rel, data: await readFile(path) });
  }
  return result.sort((a, b) => a.rel.localeCompare(b.rel));
}

function buildStoredZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 33;
  for (const entry of entries) {
    const name = Buffer.from(entry.rel, 'utf8');
    const crc = crc32(entry.data);
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    name.copy(localHeader, 30);
    local.push(localHeader, entry.data);
    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    central.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

async function main() {
  await mkdir(output, { recursive: true });
  const { stdout } = await npmPack(output);
  const packed = JSON.parse(stdout)[0].filename;
  const bytes = await readFile(join(output, packed));
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(output, `${packed}.sha256`), `${hash}  ${packed}\n`, 'utf8');
  const archiveName = `proofstream-integration-skill-${JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version}.zip`;
  const manifest = await readFile(join(root, 'generated/checksums.json'), 'utf8');
  const archiveEntries = await payloadFiles();
  archiveEntries.push({ rel: 'MANIFEST.sha256', data: Buffer.from(manifest, 'utf8') });
  const archive = buildStoredZip(archiveEntries.sort((a, b) => a.rel.localeCompare(b.rel)));
  const archivePath = join(output, archiveName);
  await writeFile(archivePath, archive);
  const archiveHash = createHash('sha256').update(archive).digest('hex');
  await writeFile(join(output, `${archiveName}.sha256`), `${archiveHash}  ${archiveName}\n`, 'utf8');
  console.log(JSON.stringify({ npm: { output: join(output, packed), sha256: hash }, zip: { output: archivePath, sha256: archiveHash } }));
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
