// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {WorkStream, IERC20} from "../src/WorkStream.sol";

/// Deploys WorkStream to Arc Testnet. Deploy ONLY — funding happens after,
/// via two `cast send` calls (approve, then fund), because forge script
/// executes its body in a local EVM that lacks Arc's USDC blocklist
/// precompile, so any USDC call inside the script reverts before broadcast.
/// The broadcast sender becomes the employer/treasury. Run by the human —
/// see STATE.md for the exact commands; actor addresses come from .env.
///
/// NOTE: the deployed milestone does NOT start until the employer funds its
/// budget in full. Deploying is not enough — the `fund` call is what starts
/// the clock, and that is deliberate (see WorkStream's anti-rug gate).
contract Deploy is Script {
    // ERC-20 USDC on Arc Testnet (6 dp)
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    // Demo defaults, deliberately small: a short milestone that accrues in
    // hours rather than days, so a whole seeding run fits in one sitting and
    // costs tens of USDC rather than hundreds. Every value is an env override,
    // because the terms are the EMPLOYER's to set, not the protocol's. They
    // freeze on-chain at deploy; after that every consumer (agent, web,
    // scripts) reads them from the contract, never from here.
    uint256 constant DEFAULT_BUDGET = 40e6; // 40 USDC for this milestone
    uint256 constant DEFAULT_DURATION = 6 hours; // accrues over 6 hours
    // The WHOLE budget. This was 4e6 — a tenth — from when a certification
    // released money directly and several were expected per milestone. It now
    // caps how much ENTITLEMENT one attestation may create, and a well-scoped
    // milestone is certified once: leaving it low would cap an honest
    // contributor at a tenth of the job and refund the rest to the employer.
    // Matches `suggestedCaps` in the web app, because the terminal path must
    // get the same sane defaults as the UI (non-negotiable #1).
    uint256 constant DEFAULT_MAX_TRANCHE = 40e6; // ceiling on entitlement per attestation
    uint256 constant DEFAULT_DAILY_UNLOCK_CAP = 50e6; // per-UTC-day ceiling
    string constant DEFAULT_MILESTONE =
        "Milestone 1: implement transfer() with balance and overdraft checks in src/ledger.ts";

    function run() external {
        address agent = vm.envAddress("AGENT_ADDRESS");
        address contributor = vm.envAddress("CONTRIBUTOR_ADDRESS");

        // The employer's terms. Set any of these in .env to deploy a stream on
        // your own numbers without touching this file.
        uint256 budget = vm.envOr("STREAM_BUDGET", DEFAULT_BUDGET);
        uint256 duration = vm.envOr("STREAM_DURATION_SECONDS", DEFAULT_DURATION);
        uint256 maxTranche = vm.envOr("POLICY_MAX_TRANCHE", DEFAULT_MAX_TRANCHE);
        uint256 dailyUnlockCap = vm.envOr("POLICY_DAILY_UNLOCK_CAP", DEFAULT_DAILY_UNLOCK_CAP);
        string memory milestone = vm.envOr("STREAM_MILESTONE", DEFAULT_MILESTONE);
        address payee = vm.envOr("POLICY_PAYEE", contributor);

        // The repo this job is about. Registered on-chain, not in the agent:
        // every job brings its own repo, and the agent must be told what to
        // watch by the contract it is paid to enforce.
        string memory repo = vm.envString("GITHUB_REPO");

        require(budget > 0, "STREAM_BUDGET must be > 0");
        require(duration > 0, "STREAM_DURATION_SECONDS must be > 0");
        require(maxTranche > 0, "POLICY_MAX_TRANCHE must be > 0");
        require(dailyUnlockCap >= maxTranche, "POLICY_DAILY_UNLOCK_CAP must be >= POLICY_MAX_TRANCHE");
        require(maxTranche <= budget, "POLICY_MAX_TRANCHE must be <= STREAM_BUDGET");
        require(bytes(repo).length > 0, "GITHUB_REPO must be set");

        console.log("milestone 1 terms (employer-set):");
        console.log("  budget (6dp)    ", budget);
        console.log("  duration (s)    ", duration);
        console.log("  maxTranche      ", maxTranche);
        console.log("  dailyUnlockCap  ", dailyUnlockCap);
        console.log("  payee           ", payee);
        console.log("  repo            ", repo);

        vm.startBroadcast();
        WorkStream ws = new WorkStream(
            USDC,
            contributor,
            agent,
            milestone,
            budget,
            duration,
            repo,
            WorkStream.Policy({maxTranche: maxTranche, dailyUnlockCap: dailyUnlockCap, payee: payee})
        );
        vm.stopBroadcast();

        console.log("WorkStream deployed:", address(ws));
        console.log("employer/treasury:  ", ws.employer());
        console.log("");
        console.log("The milestone has NOT started. It begins the moment you fund");
        console.log("the full budget - approve, then fund. See STATE.md.");
    }
}
