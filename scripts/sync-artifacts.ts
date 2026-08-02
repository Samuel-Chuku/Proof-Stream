// Copies the compiled contract ABIs and bytecode into the web app.
//
// The browser deploys WorkStream itself — that is what makes the employer, not
// a factory, the stream's owner — so it needs the bytecode at runtime. Foundry
// writes that to contracts/out/, which is gitignored and does not exist on a
// deployment host, so the artifact is committed as TypeScript instead.
//
// Run after any contract change:  pnpm sync:artifacts
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../contracts/out/', import.meta.url);
const TARGET = new URL('../web/lib/artifacts.ts', import.meta.url);

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

const file = `// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm sync:artifacts
//
// The browser deploys WorkStream from the employer's own wallet, so msg.sender
// in the constructor is the employer and the stream is genuinely theirs. That
// is why the bytecode has to ship to the client.

export const WORK_STREAM_ABI = ${JSON.stringify(workStream.abi)} as const;

export const WORK_STREAM_BYTECODE = '${workStream.bytecode}' as const;

export const STREAM_REGISTRY_ABI = ${JSON.stringify(registry.abi)} as const;
`;

writeFileSync(TARGET, file);

const kb = (n: number) => `${Math.round((n / 1024) * 10) / 10} KB`;
console.log(`wrote web/lib/artifacts.ts`);
console.log(`  WorkStream     ${workStream.abi.length} abi entries, ${kb(workStream.bytecode.length / 2)} bytecode`);
console.log(`  StreamRegistry ${registry.abi.length} abi entries`);
