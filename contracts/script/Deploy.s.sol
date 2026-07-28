// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {WorkStream, IERC20} from "../src/WorkStream.sol";

/// Deploys WorkStream to Arc Testnet and funds it in the same broadcast.
/// The broadcast sender becomes the employer/treasury and must hold at least
/// INITIAL_FUNDING in ERC-20 USDC. Run by the human — see README for the
/// exact command; actor addresses come from the repo-root .env.
contract Deploy is Script {
    // ERC-20 USDC on Arc Testnet (6 dp)
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    // Demo numbers, chosen for legibility on screen. These freeze on-chain at
    // deploy; after that every consumer (agent, web, scripts) reads them from
    // the contract, not from here.
    uint256 constant RATE_PER_SECOND = 10_000; // 0.01 USDC/s = 864 USDC/day
    uint256 constant STREAM_DURATION = 30 days;
    uint256 constant INITIAL_FUNDING = 500e6; // 500 USDC
    uint256 constant MAX_TRANCHE = 25e6; // policy: per-unlock ceiling
    uint256 constant DAILY_UNLOCK_CAP = 150e6; // policy: per-UTC-day ceiling
    string constant MILESTONE = "Milestone 1: implement transfer() with balance and overdraft checks in src/ledger.ts";

    function run() external {
        address agent = vm.envAddress("AGENT_ADDRESS");
        address contributor = vm.envAddress("CONTRIBUTOR_ADDRESS");
        address vault = vm.envAddress("VAULT_ADDRESS");

        vm.startBroadcast();
        WorkStream ws = new WorkStream(
            USDC,
            contributor,
            agent,
            vault,
            RATE_PER_SECOND,
            uint64(block.timestamp),
            uint64(block.timestamp + STREAM_DURATION),
            MILESTONE,
            WorkStream.Policy({maxTranche: MAX_TRANCHE, dailyUnlockCap: DAILY_UNLOCK_CAP, payee: contributor})
        );
        USDC.approve(address(ws), INITIAL_FUNDING);
        ws.fund(INITIAL_FUNDING);
        vm.stopBroadcast();

        console.log("WorkStream deployed:", address(ws));
        console.log("employer/treasury:  ", ws.employer());
        console.log("funded (6dp USDC):  ", INITIAL_FUNDING);
    }
}
