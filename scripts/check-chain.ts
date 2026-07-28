// Phase 0 acceptance: connect to Arc Testnet, print chain id, deployer
// address, native balance (18 dp) and ERC-20 USDC balance (6 dp).
import { createPublicClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import {
  NATIVE_DECIMALS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  formatNative,
  formatUsdc,
} from '@proofstream/config';

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error('DEPLOYER_PRIVATE_KEY is not set — copy .env.example to .env');
  process.exit(1);
}

const account = privateKeyToAccount(pk as `0x${string}`);
const client = createPublicClient({
  chain: arcTestnet,
  transport: http(process.env.ARC_RPC_URL),
});

const chainId = await client.getChainId();
const native = await client.getBalance({ address: account.address });
const usdc = await client.readContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
});

console.log(`chain:          ${chainId} (${arcTestnet.name}, expected ${arcTestnet.id})`);
console.log(`deployer:       ${account.address}`);
console.log(`native balance: ${formatNative(native)} USDC (raw ${native}, ${NATIVE_DECIMALS} dp)`);
console.log(`ERC-20 USDC:    ${formatUsdc(usdc)} USDC (raw ${usdc}, ${USDC_DECIMALS} dp)`);

if (chainId !== arcTestnet.id) {
  console.error(`FAIL: connected to chain ${chainId}, expected ${arcTestnet.id}`);
  process.exit(1);
}
if (usdc === 0n) {
  console.error('FAIL: deployer USDC balance is zero');
  process.exit(1);
}
console.log('OK');
