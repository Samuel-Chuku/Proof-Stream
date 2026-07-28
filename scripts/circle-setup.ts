// Circle wallet setup (human-run). Resumable: each step is skipped if its
// .env entry already exists, so a failure never forces redoing earlier steps,
// and you can pre-fill any value manually to take over a step yourself.
//   step 1: create wallet set "ProofStream"  → CIRCLE_WALLET_SET_ID
//   step 2: create attestor EOA wallet on ARC-TESTNET → AGENT_WALLET_ID/ADDRESS
//   step 3: create verifier EOA wallet on ARC-TESTNET → VERIFIER_WALLET_ID/ADDRESS
// Pure API calls — nothing on-chain. Prints ids/addresses only, never secrets.
import { readFileSync, writeFileSync } from 'node:fs';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.ENTITY_SECRET;
if (!apiKey || !entitySecret) {
  console.error('CIRCLE_API_KEY and ENTITY_SECRET must both be set in .env first.');
  process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

function saveEnv(entries: Record<string, string>) {
  const names = Object.keys(entries);
  const kept = readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => !names.some((n) => line.startsWith(`${n}=`)))
    .join('\n');
  const added = names.map((n) => `${n}=${entries[n]}\n`).join('');
  writeFileSync('.env', `${kept.replace(/\n*$/, '\n')}${added}`);
}

// step 1 — wallet set
let walletSetId = process.env.CIRCLE_WALLET_SET_ID;
if (walletSetId) {
  console.log(`wallet set:        ${walletSetId} (already in .env, skipped)`);
} else {
  const res = await client.createWalletSet({ name: 'ProofStream' });
  walletSetId = res.data?.walletSet?.id;
  if (!walletSetId) {
    console.error('Wallet set creation returned no id:', JSON.stringify(res.data));
    process.exit(1);
  }
  saveEnv({ CIRCLE_WALLET_SET_ID: walletSetId });
  console.log(`wallet set:        ${walletSetId} (created)`);
}

// steps 2 + 3 — one wallet per run for attestor, then verifier
async function ensureWallet(label: string, idVar: string, addrVar: string) {
  if (process.env[idVar] && process.env[addrVar]) {
    console.log(`${label}: ${process.env[addrVar]} (already in .env, skipped)`);
    return;
  }
  const res = await client.createWallets({
    accountType: 'EOA',
    blockchains: ['ARC-TESTNET'],
    count: 1,
    walletSetId: walletSetId!,
  });
  const wallet = res.data?.wallets?.[0];
  if (!wallet) {
    console.error(`${label} wallet creation returned nothing:`, JSON.stringify(res.data));
    process.exit(1);
  }
  saveEnv({ [idVar]: wallet.id, [addrVar]: wallet.address });
  console.log(`${label}: ${wallet.address} (created, wallet id ${wallet.id})`);
}

await ensureWallet('attestor (agent)', 'AGENT_WALLET_ID', 'AGENT_ADDRESS');
await ensureWallet('verifier        ', 'VERIFIER_WALLET_ID', 'VERIFIER_ADDRESS');

console.log('\nDone. If AGENT_PRIVATE_KEY (obsolete local key) is still in .env, delete the line.');
console.log('Next: fund the attestor with USDC, then pnpm preflight:deploy.');
