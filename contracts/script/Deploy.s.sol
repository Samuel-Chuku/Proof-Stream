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
    // NOTE: the caps DEFAULT TO THE BUDGET and are not constants — see run().
    // A fixed 40e6 was wrong the moment anyone set a different budget: a 60 USDC
    // stream got a 40 USDC per-attestation ceiling and a 50 USDC daily cap, so
    // certifying it in two steps hit DailyCapExceeded and the second half could
    // not be released until the next UTC day. The web form already derives both
    // from the budget; the terminal path must match (non-negotiable #1).
    string constant DEFAULT_MILESTONE =
        "Milestone 1: implement transfer() with balance and overdraft checks in src/ledger.ts";

    /// The employer's terms, held in MEMORY rather than on the stack.
    ///
    /// Not tidiness. CT-2 and CT-6 gave the constructor two more arguments, and
    /// with every term in its own local this function stopped compiling: "stack
    /// too deep", from a script nobody builds because `forge test` compiles a
    /// different target and passes. The mainnet deployment runs THIS file.
    ///
    /// `via_ir` would also fix it and is the wrong fix: it changes how the
    /// CONTRACT is compiled too, so the bytecode we deploy would no longer be
    /// the bytecode 70 tests were run against.
    struct Terms {
        uint256 budget;
        uint256 duration;
        uint256 maxTranche;
        uint256 dailyUnlockCap;
        string milestone;
        address payee;
        string repo;
    }

    function run() external {
        address agent = vm.envAddress("AGENT_ADDRESS");
        address contributor = vm.envAddress("CONTRIBUTOR_ADDRESS");

        // The employer's terms. Set any of these in .env to deploy a stream on
        // your own numbers without touching this file.
        Terms memory t;
        t.budget = vm.envOr("STREAM_BUDGET", DEFAULT_BUDGET);
        t.duration = vm.envOr("STREAM_DURATION_SECONDS", DEFAULT_DURATION);
        // Both default to the whole budget. Setting either below it does not make
        // a stream safer — it caps an honest contributor and refunds the rest to
        // the employer on close. What bounds a compromised agent is that money
        // still leaves only at the speed the stream accrues.
        t.maxTranche = vm.envOr("POLICY_MAX_TRANCHE", t.budget);
        t.dailyUnlockCap = vm.envOr("POLICY_DAILY_UNLOCK_CAP", t.budget);
        t.milestone = vm.envOr("STREAM_MILESTONE", DEFAULT_MILESTONE);
        t.payee = vm.envOr("POLICY_PAYEE", contributor);

        // The repo this job is about. Registered on-chain, not in the agent:
        // every job brings its own repo, and the agent must be told what to
        // watch by the contract it is paid to enforce.
        t.repo = vm.envString("GITHUB_REPO");

        require(t.budget > 0, "STREAM_BUDGET must be > 0");
        require(t.duration > 0, "STREAM_DURATION_SECONDS must be > 0");
        require(t.maxTranche > 0, "POLICY_MAX_TRANCHE must be > 0");
        require(t.dailyUnlockCap >= t.maxTranche, "POLICY_DAILY_UNLOCK_CAP must be >= POLICY_MAX_TRANCHE");
        require(t.maxTranche <= t.budget, "POLICY_MAX_TRANCHE must be <= STREAM_BUDGET");
        require(bytes(t.repo).length > 0, "GITHUB_REPO must be set");

        console.log("milestone 1 terms (employer-set):");
        console.log("  budget (6dp)    ", t.budget);
        console.log("  duration (s)    ", t.duration);
        console.log("  maxTranche      ", t.maxTranche);
        console.log("  dailyUnlockCap  ", t.dailyUnlockCap);
        console.log("  payee           ", t.payee);
        console.log("  repo            ", t.repo);

        vm.startBroadcast();
        WorkStream ws = new WorkStream(
            USDC,
            contributor,
            // Named at deploy, so no claim link. The terminal path always names
            // a contributor; the claim path exists for the web flow, where an
            // employer may know an email but not a wallet.
            address(0),
            agent,
            t.milestone,
            t.budget,
            t.duration,
            t.repo,
            // No author allowlist from the terminal path: empty means any
            // author, which is how every stream behaved before CT-2.
            new string[](0),
            WorkStream.Policy({maxTranche: t.maxTranche, dailyUnlockCap: t.dailyUnlockCap, payee: t.payee, claimCap: 0, dailyClaimCap: 0})
        );
        vm.stopBroadcast();

        console.log("WorkStream deployed:", address(ws));
        console.log("employer/treasury:  ", ws.employer());
        console.log("");
        console.log("The milestone has NOT started. It begins the moment you fund");
        console.log("the full budget - approve, then fund. See STATE.md.");
    }
}
