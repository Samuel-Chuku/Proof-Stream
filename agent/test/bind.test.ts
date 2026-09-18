// WHERE AN EARNER IS PAID is authorised by a signature the contract checks
// against its own EIP-712 domain. The agent builds that payload here, so the
// one thing this test must prove is that what the agent signs is byte for byte
// what WorkStream.sol hashes. Any drift recovers a different signer and the
// contract answers WrongSigner, which reads as a key problem, not a shape one.
//
// chain.ts imports env.ts, which validates at import, so the same fake-env
// pattern as the other agent tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  encodeAbiParameters,
  encodePacked,
  hashTypedData,
  keccak256,
  recoverAddress,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: '/tmp',
  REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000001',
  CIRCLE_API_KEY: 'x',
  ENTITY_SECRET: 'x',
  AGENT_WALLET_ID: 'x',
  AGENT_ADDRESS: '0x0000000000000000000000000000000000000002',
  GITHUB_TOKEN: 'x',
  GITHUB_WEBHOOK_SECRET: 'x',
  LLM_API_KEY: 'x',
  LLM_BASE_URL: 'https://example.invalid/v1',
  AGENT_MODEL: 'test/model',
  VERIFIER_MODEL: 'test/other-model',
  VERIFIER_ADDRESS: '0x0000000000000000000000000000000000000003',
});

const { bindingTypedData } = await import('../src/chain');
const { parseBindRequest } = await import('../src/bind');

const STREAM = '0x00000000000000000000000000000000000000aa' as const;
const PAYEE = '0x00000000000000000000000000000000000000bb' as const;
const EARNER = keccak256(toHex('github:1001'));
const DEADLINE = 1_800_000_000n;

/// The digest exactly as bindPayee() computes it, transcribed from Solidity
/// rather than derived from the agent's own payload.
function contractDigest(): `0x${string}` {
  const source = readFileSync(new URL('../../contracts/src/WorkStream.sol', import.meta.url), 'utf8');
  const typeString = source.match(/PAYEE_BINDING_TYPEHASH =\s*keccak256\("([^"]+)"\)/)?.[1];
  assert.ok(typeString, 'the contract declares PAYEE_BINDING_TYPEHASH');

  const domain = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [
        keccak256(toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toHex('ProofStream')),
        keccak256(toHex('1')),
        5042002n,
        STREAM,
      ],
    ),
  );
  const struct = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [keccak256(toHex(typeString)), EARNER, PAYEE, DEADLINE],
    ),
  );
  return keccak256(encodePacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domain, struct]));
}

test('the agent signs exactly the digest the contract recovers against', () => {
  const typed = bindingTypedData(STREAM, EARNER, PAYEE, DEADLINE);
  assert.equal(hashTypedData(typed as Parameters<typeof hashTypedData>[0]), contractDigest());
});

test('a signature over that payload recovers to the signer on the contract digest', async () => {
  const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const typed = bindingTypedData(STREAM, EARNER, PAYEE, DEADLINE);
  const signature = await signer.signTypedData(typed as Parameters<typeof signer.signTypedData>[0]);
  assert.equal(await recoverAddress({ hash: contractDigest(), signature }), signer.address);
});

test('the payee is inside what is signed, so a lifted signature names nobody else', () => {
  const a = hashTypedData(bindingTypedData(STREAM, EARNER, PAYEE, DEADLINE) as Parameters<typeof hashTypedData>[0]);
  const b = hashTypedData(
    bindingTypedData(STREAM, EARNER, '0x00000000000000000000000000000000000000cc', DEADLINE) as Parameters<typeof hashTypedData>[0],
  );
  assert.notEqual(a, b);
});

// --- request shape ----------------------------------------------------------

test('a request needs a bearer token and two real addresses', () => {
  const ok = parseBindRequest({ stream: STREAM, payee: PAYEE }, 'Bearer gho_x');
  assert.deepEqual(ok, { stream: STREAM, payee: PAYEE, token: 'gho_x' });

  assert.equal(typeof parseBindRequest({ stream: STREAM, payee: PAYEE }, undefined), 'string');
  assert.equal(typeof parseBindRequest({ stream: 'nope', payee: PAYEE }, 'Bearer t'), 'string');
  assert.equal(typeof parseBindRequest({ stream: STREAM, payee: `0x${'0'.repeat(40)}` }, 'Bearer t'), 'string', 'the zero address is refused here, not on chain');
  assert.equal(typeof parseBindRequest(null, 'Bearer t'), 'string');
});
