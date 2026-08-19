// Copies the compiled contract ABIs and bytecode out of contracts/out/, which is
// gitignored and does not exist on a deployment host, so both are committed as
// TypeScript instead.
//
// Two targets, deliberately:
//   config/src/artifacts.ts   the ABIs, shared — the agent reads the same
//                             contract the web app does and cannot import
//                             from web/.
//   web/lib/bytecode.ts       the deploy bytecode, web only — the browser
//                             deploys WorkStream itself, which is what makes
//                             the employer rather than a factory its owner.
//
// Run after any contract change:  pnpm sync:artifacts
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../contracts/out/', import.meta.url);
const ABI_TARGET = new URL('../config/src/artifacts.ts', import.meta.url);
const BYTECODE_TARGET = new URL('../web/lib/bytecode.ts', import.meta.url);

function artifact(name: string): { abi: unknown[]; bytecode: string } {
  let raw: string;
  try {
    raw = readFileSync(new URL(`${name}.sol/${name}.json`, OUT), 'utf8');
  } catch {
    console.error(`contracts/out/${name}.sol/${name}.json not found — run 'forge build' in contracts/ first`);
    process.exit(1);
  }
  const json = JSON.parse(raw);
  return { abi: json.abi, bytecode: json.bytecode?.object ?? '0x' };
}

const workStream = artifact('WorkStream');
const registry = artifact('StreamRegistry');

const abis = `// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm sync:artifacts
//
// The agent and the web app read the same contract, so the ABIs live in the
// shared config package. Do not hand-write a second copy of any entry below;
// import it from here, or the agent ends up decoding last week's shape.

export const WORK_STREAM_ABI = ${JSON.stringify(workStream.abi)} as const;

export const STREAM_REGISTRY_ABI = ${JSON.stringify(registry.abi)} as const;
`;

const bytecode = `// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm sync:artifacts
//
// The browser deploys WorkStream from the employer's own wallet, so msg.sender
// in the constructor is the employer and the stream is genuinely theirs. That
// is why the bytecode has to ship to the client.
//
// It is deliberately NOT in @proofstream/config with the ABIs. Only the create
// flow deploys anything, and re-exporting 9.8 KB of bytecode through the shared
// barrel put it in a chunk every page pays for — measured at +7 kB on /streams,
// which never deploys a contract.

export const WORK_STREAM_BYTECODE = '${workStream.bytecode}' as const;
`;

writeFileSync(ABI_TARGET, abis);
writeFileSync(BYTECODE_TARGET, bytecode);

const kb = (n: number) => `${Math.round((n / 1024) * 10) / 10} KB`;
console.log(`wrote config/src/artifacts.ts`);
console.log(`  WorkStream     ${workStream.abi.length} abi entries`);
console.log(`  StreamRegistry ${registry.abi.length} abi entries`);
console.log(`wrote web/lib/bytecode.ts`);
console.log(`  WorkStream     ${kb(workStream.bytecode.length / 2)} bytecode`);
