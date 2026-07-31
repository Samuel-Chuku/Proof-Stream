// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {StreamRegistry} from "../src/StreamRegistry.sol";

/// Deploys the StreamRegistry to Arc Testnet. Deployed ONCE for the whole
/// system; every employer then announces their own stream to it.
///
/// This is a separate script from Deploy.s.sol on purpose — deploying a stream
/// and deploying the registry are unrelated events, and the existing
/// single-stream path must keep working untouched.
///
/// The registry holds no funds and has no owner, so unlike Deploy.s.sol there
/// is nothing to fund afterwards and no USDC call anywhere near it.
contract DeployRegistry is Script {
    function run() external {
        vm.startBroadcast();
        StreamRegistry registry = new StreamRegistry();
        vm.stopBroadcast();

        console.log("StreamRegistry deployed:", address(registry));
        console.log("");
        console.log("Put this in .env as REGISTRY_ADDRESS, then announce each");
        console.log("stream with: pnpm preflight:register <stream address>");
    }
}
