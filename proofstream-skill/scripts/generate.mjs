import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..');
const GENERATED = join(PACKAGE_ROOT, 'generated');
const COMMIT = '92b5e741947a73dc95f673adc8ff2431b7615aa1';

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
function normalizeText(value) { return value.replaceAll('\r\n', '\n'); }
async function put(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
async function digest(value) { return createHash('sha256').update(value).digest('hex'); }
async function files(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) out.push(...await files(root, path));
    else out.push(relative(root, path).replaceAll('\\', '/'));
  }
  return out.sort();
}

function pickAddress(text, label) {
  const match = text.match(new RegExp(`${label}[^\\n]{0,220}?(0x[0-9a-fA-F]{40})`, 'i'));
  return match?.[1] || null;
}

async function artifact(name, source) {
  const path = join(REPO_ROOT, 'contracts', 'out', `${source}.sol`, `${name}.json`);
  const value = await json(path);
  return { abi: value.abi, bytecode: value.bytecode?.object || '' };
}

function contractMarkdown(name, value) {
  const functions = value.abi.filter((x) => x.type === 'function');
  const events = value.abi.filter((x) => x.type === 'event');
  const errors = value.abi.filter((x) => x.type === 'error');
  const signature = (item) => `${item.name}(${(item.inputs || []).map((i) => `${i.type}${i.name ? ` ${i.name}` : ''}`).join(', ')})`;
  return `# ${name} generated reference\n\nGenerated from the Foundry artifact at ProofStream commit \`${COMMIT}\`. Regenerate with \`pnpm --filter proofstream-integration-skill generate\`.\n\n## Functions\n\n${functions.map((item) => `- \`${signature(item)}\` - ${item.stateMutability}; returns ${(item.outputs || []).map((x) => x.type).join(', ') || 'nothing'}`).join('\n')}\n\n## Events\n\n${events.map((item) => `- \`${signature(item)}\``).join('\n')}\n\n## Custom errors\n\n${errors.map((item) => `- \`${signature(item)}\``).join('\n')}\n`;
}

async function generateTo(outDir) {
  await mkdir(outDir, { recursive: true });
  const workstream = await artifact('WorkStream', 'WorkStream');
  const registry = await artifact('StreamRegistry', 'StreamRegistry');
  await put(join(outDir, 'workstream.abi.json'), workstream.abi);
  await put(join(outDir, 'stream-registry.abi.json'), registry.abi);
  await writeFile(join(outDir, 'contracts-reference.md'), `${contractMarkdown('WorkStream', workstream)}\n${contractMarkdown('StreamRegistry', registry)}`, 'utf8');

  const rootPackage = await json(join(REPO_ROOT, 'package.json'));
  const packages = [rootPackage];
  for (const dir of ['config', 'agent', 'web']) {
    packages.push(await json(join(REPO_ROOT, dir, 'package.json')));
  }
  const commandFiles = {};
  for (const [command, script] of Object.entries(rootPackage.scripts || {})) commandFiles[command] = script;
  await put(join(outDir, 'cli-reference.json'), { schemaVersion: '1.0.0', generatedFrom: COMMIT, commands: commandFiles });

  const envText = await readFile(join(REPO_ROOT, '.env.example'), 'utf8');
  const envNames = [...envText.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map((match) => match[1]);
  await put(join(outDir, 'env-reference.json'), { schemaVersion: '1.0.0', generatedFrom: COMMIT, variables: [...new Set(envNames)].sort(), source: '.env.example' });

  const routeRoot = join(REPO_ROOT, 'web', 'app');
  const routeFiles = [];
  async function routeScan(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await routeScan(path);
      else if (/^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) routeFiles.push(relative(routeRoot, path).replaceAll('\\', '/'));
    }
  }
  await routeScan(routeRoot);
  await put(join(outDir, 'routes.json'), { schemaVersion: '1.0.0', generatedFrom: COMMIT, appRouterFiles: routeFiles.sort() });

  const readme = await readFile(join(REPO_ROOT, 'README.md'), 'utf8');
  // EVIDENCE.md IS DELIBERATELY NOT READ HERE. It is regenerated from live
  // chain state by `pnpm evidence`, so making it an input meant every evidence
  // refresh left these files stale and failed CI on the branch that did it.
  // It also has no single "current contract" any more: the registry does, and
  // a per-stream address is not a fact about the integration surface.
  const chainText = await readFile(join(REPO_ROOT, 'web', 'lib', 'chain.ts'), 'utf8');
  const compatibility = {
    schemaVersion: '1.0.0',
    skillVersion: (await json(join(PACKAGE_ROOT, 'manifest.json'))).skillVersion,
    proofstreamRepository: 'https://github.com/Samuel-Chuku/Proof-Stream',
    proofstreamCommit: COMMIT,
    releaseStatus: 'experimental',
    chain: { name: 'Arc Testnet', chainId: 5042002, rpc: 'https://rpc.testnet.arc.network', explorer: 'https://testnet.arcscan.app', source: '.env.example and web/lib/chain.ts' },
    addresses: [
      { contract: 'USDC', address: '0x3600000000000000000000000000000000000000', chainId: 5042002, status: 'verified-source', purpose: 'web chain constant', source: 'web/lib/chain.ts' },
      { contract: 'StreamRegistry', address: pickAddress(readme, 'StreamRegistry'), chainId: 5042002, status: 'verified-source', purpose: 'README deployment table', source: 'README.md' },
      // NO SINGLE WORKSTREAM ADDRESS, on purpose. Every employer deploys their
      // own, and the registry is how they are found, so an integration reads
      // StreamRegistered logs, never a pasted address. The README's example
      // stream is carried as an example and labelled as one.
      { contract: 'WorkStream', address: pickAddress(readme, 'Example `WorkStream`'), chainId: 5042002, status: 'example-only', purpose: 'one deployed stream, for reading along; discover streams through StreamRegistry', source: 'README.md' },
      { contract: 'GatewayWallet', address: pickAddress(readme, 'GatewayWallet'), chainId: 5042002, status: 'verified-source', purpose: 'README deployment table', source: 'README.md' },
    ],
    bytecode: { WorkStreamSha256: await digest(workstream.bytecode), StreamRegistrySha256: await digest(registry.bytecode) },
    packageVersions: Object.fromEntries(packages.map((pkg) => [pkg.name, pkg.version || 'workspace'])) ,
    generatedAt: 'SOURCE_DATE_EPOCH_OR_COMMIT_TIME',
    sources: ['contracts/out/WorkStream.sol/WorkStream.json', 'contracts/out/StreamRegistry.sol/StreamRegistry.json', 'README.md', '.env.example', 'web/lib/chain.ts'],
  };
  if (!chainText.includes('5042002')) compatibility.warnings = ['Chain ID must be reverified against source.'];
  await put(join(outDir, 'compatibility.json'), compatibility);
  await put(join(outDir, 'consumables.json'), {
    schemaVersion: '1.0.0', generatedFrom: COMMIT,
    categories: ['on-chain', 'off-chain', 'agent', 'web-ui', 'cli'],
    onChain: ['named WorkStream', 'claimable WorkStream', 'public WorkStream', 'StreamRegistry', 'USDC', 'EIP-712 attestation and payee binding', 'contract events'],
    offChain: ['GitHub webhook and diff evidence', 'JSONL agent logs', 'Circle Gateway and x402 payment'],
    agent: ['attestor pipeline', 'independent verifier review', 'sandboxed correctness evidence', 'public earner resolution and binding', 'metering', 'reconciliation'],
    webUi: ['Next.js App Router pages', 'named, claimable, and public stream flows', 'viem readers and writers', 'wallet and passkey paths'],
    cli: Object.keys(commandFiles).sort(),
    absent: ['public SDK', 'stable REST API', 'hosted webhook delivery service', 'MCP server'],
  });
  await put(join(outDir, 'audit-report.json'), { schemaVersion: '1.0.0', proofstreamCommit: COMMIT, generatedAt: 'RUN_TIME', status: 'requires-fresh-verification', notes: ['This file records what must be rerun; it is not a substitute for the audit protocol in skillBuild.md.'] });
  await put(join(outDir, 'source-index.json'), { schemaVersion: '1.0.0', proofstreamCommit: COMMIT, sources: compatibility.sources, claims: [
    { id: 'chain.arc-testnet', classification: 'verified', source: 'web/lib/chain.ts' },
    { id: 'deployment.workstream-address', classification: 'conflicted', source: 'README.md and EVIDENCE.md' },
    { id: 'skill.release-status', classification: 'experimental', source: 'manifest.json' },
  ] });
}

async function checksumPayload() {
  const roots = ['SKILL.md', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'manifest.json', 'agents', 'assets', 'bin', 'src', 'references', 'generated', 'examples', 'templates', 'schemas'];
  const all = [];
  for (const root of roots) {
    const path = join(PACKAGE_ROOT, root);
    if (!(await import('node:fs/promises')).stat(path).catch(() => null)) continue;
    const listed = (await files(PACKAGE_ROOT)).filter((file) => file === root || file.startsWith(`${root}/`));
    all.push(...listed);
  }
  const checksums = {};
  for (const rel of [...new Set(all)].sort()) {
    if (rel === 'generated/checksums.json') continue;
    checksums[rel] = await digest(await readFile(join(PACKAGE_ROOT, rel)));
  }
  await put(join(GENERATED, 'checksums.json'), { schemaVersion: '1.0.0', generatedFrom: COMMIT, files: checksums });
}

async function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const temp = join(REPO_ROOT, '.skill-generated-check');
    await rm(temp, { recursive: true, force: true });
    try {
      await generateTo(temp);
      const expected = (await files(temp)).sort();
      const actual = (await files(GENERATED)).filter((file) => file !== 'checksums.json').sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Generated file set differs. Expected ${expected.join(', ')}; found ${actual.join(', ')}`);
      for (const rel of expected) {
        const [want, have] = await Promise.all([readFile(join(temp, rel), 'utf8'), readFile(join(GENERATED, rel), 'utf8')]);
        if (normalizeText(want) !== normalizeText(have)) throw new Error(`Generated output is stale: generated/${rel}`);
      }
      console.log('ProofStream skill generated references are up to date.');
    } finally { await rm(temp, { recursive: true, force: true }); }
    return;
  }
  await generateTo(GENERATED);
  await checksumPayload();
  console.log('Generated ProofStream skill references and checksums.');
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
