# ProofStream

USDC payroll streams on [Arc](https://docs.arc.io) that accrue by the second but stay
**locked** until an autonomous agent verifies real work and signs an attestation that
unlocks a tranche. Stop shipping, and the money pauses itself.

The attestor agent has its own wallet, exercises real judgment about whether work
satisfies a milestone, and pays a second verifier agent for an independent opinion on
every check.

## Deployed on Arc Testnet (chain 5042002)

| What | Address |
| --- | --- |
| `WorkStream` | [`0x3E35722196DA80c82A5ef65A279b8F085b96cBFB`](https://testnet.arcscan.app/address/0x3E35722196DA80c82A5ef65A279b8F085b96cBFB) (verified) |
| Employer / treasury | [`0xe9d2E5521573D73471497C368F3454d710170477`](https://testnet.arcscan.app/address/0xe9d2E5521573D73471497C368F3454d710170477) |
| Attestor agent (Circle dev-controlled wallet) | [`0x2CD7cc0407218f905731F88C08EEB86a94dd634A`](https://testnet.arcscan.app/address/0x2CD7cc0407218f905731F88C08EEB86a94dd634A) |
| Verifier agent (Circle dev-controlled wallet) | [`0xa7aaa2324cb141a332b22c5eac12f75b46cdeb50`](https://testnet.arcscan.app/address/0xa7aaa2324cb141a332b22c5eac12f75b46cdeb50) |
| Contributor | [`0x4e10648aDA2bFb02544B41d62D0C15B00bc56699`](https://testnet.arcscan.app/address/0x4e10648aDA2bFb02544B41d62D0C15B00bc56699) |
| Vesting vault | [`0x806e986Ccf62EA35c4729d87060c7307Cdc63d19`](https://testnet.arcscan.app/address/0x806e986Ccf62EA35c4729d87060c7307Cdc63d19) |

Stream parameters: 0.01 USDC/second over 30 days, funded with 500 USDC. Each unlocked
tranche splits 85% to the contributor and 15% to the vesting vault.

## How the on-chain policy bounds the agent

The attestor is a single trusted key, so `WorkStream.sol` enforces its mandate itself:
no unlock above **25 USDC**, no more than **150 USDC per UTC day**, withdrawals only to
an allowlisted payee, one-use nonces, and attestations older than 15 minutes rejected.
A compromised agent key can drain at most one day's cap.

## Install and run

Requires Node ≥ 22.13, pnpm, and [Foundry](https://getfoundry.sh).

```bash
pnpm install
pnpm test:amounts              # decimal round-trip tests
cd contracts && forge test     # contract tests
pnpm check:chain               # print chain id and deployer balances
pnpm preflight:deploy          # dry run — must be all green before any deploy
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
| --- | --- |
| `ARC_RPC_URL` | Arc Testnet RPC endpoint |
| `DEPLOYER_ADDRESS` | Employer/treasury address (read-only checks; the key is never stored here) |
| `CIRCLE_API_KEY`, `ENTITY_SECRET` | Circle developer-controlled wallets — one credential pair manages both agent wallets |
| `CIRCLE_WALLET_SET_ID`, `AGENT_WALLET_ID`, `AGENT_ADDRESS`, `VERIFIER_WALLET_ID`, `VERIFIER_ADDRESS` | Written by `pnpm circle:setup` |
| `CONTRIBUTOR_ADDRESS`, `CONTRIBUTOR_PRIVATE_KEY`, `VAULT_ADDRESS`, `VAULT_PRIVATE_KEY` | Demo fixtures only — see below |

The contributor and vault private keys exist solely so the unattended demo-seeding
script can call `withdraw()` and control the vault. In real use the contributor
connects their own wallet; ProofStream never custodies it.

## Notes on Arc

- Native gas and ERC-20 USDC are the same asset exposed at different scales: 18 decimals
  via `eth_getBalance`, 6 decimals via `balanceOf`. All formatting goes through
  `config/src/amounts.ts`.
- Arc's USDC contract calls a blocklist precompile that local EVMs lack, so USDC calls
  cannot run inside a `forge script`. Deployment is deploy-only; funding runs through
  `cast send` against the live node.
