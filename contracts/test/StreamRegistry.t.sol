// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";
import {StreamRegistry} from "../src/StreamRegistry.sol";
import {WorkStream, IERC20} from "../src/WorkStream.sol";

contract StreamRegistryTest is Test {
    StreamRegistry registry;

    address employer = makeAddr("employer");
    address otherEmployer = makeAddr("otherEmployer");
    address stranger = makeAddr("stranger");
    address contributor = makeAddr("contributor");
    address payee = makeAddr("payee");
    address vault = makeAddr("vault");
    address agentAddr = makeAddr("agent");
    address otherAgent = makeAddr("otherAgent");

    // The constructor never touches USDC, so the real Arc address stands in
    // without a mock and keeps these tests about the registry, not the token.
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    event StreamRegistered(address indexed stream, address indexed employer, address indexed agent, string repo);

    function setUp() public {
        registry = new StreamRegistry();
    }

    function _deploy(address who, address whichAgent, string memory repo) internal returns (WorkStream) {
        vm.prank(who);
        return new WorkStream(
            USDC,
            contributor,
            whichAgent,
            vault,
            "Milestone 1: ship the ledger module",
            40e6,
            6 hours,
            repo,
            WorkStream.Policy({maxTranche: 4e6, dailyUnlockCap: 50e6, payee: payee})
        );
    }

    /// The whole point of option three: the employer who deployed the stream
    /// owns it, and the registry reports that same address.
    function test_RegisterEmitsEventWithTheDeployerAsEmployer() public {
        WorkStream ws = _deploy(employer, agentAddr, "acme/widgets");
        assertEq(ws.employer(), employer, "deployer must own the stream");

        vm.expectEmit(true, true, true, true);
        emit StreamRegistered(address(ws), employer, agentAddr, "acme/widgets");

        vm.prank(employer);
        registry.register(address(ws));
    }

    function test_RevertWhen_CallerIsNotTheStreamsEmployer() public {
        WorkStream ws = _deploy(employer, agentAddr, "acme/widgets");

        vm.prank(stranger);
        vm.expectRevert(StreamRegistry.NotStreamEmployer.selector);
        registry.register(address(ws));
    }

    function test_RevertWhen_StreamIsZeroAddress() public {
        vm.prank(employer);
        vm.expectRevert(StreamRegistry.ZeroAddress.selector);
        registry.register(address(0));
    }

    /// An address with no code answers no `employer()`, so it cannot be
    /// announced. This is what stops the log filling with arbitrary addresses.
    function test_RevertWhen_TargetIsNotAWorkStream() public {
        vm.prank(employer);
        vm.expectRevert();
        registry.register(stranger);
    }

    /// One agent, two employers, two repos — the multi-tenant case section B
    /// consumes. Both must land as separate events under the same agent topic.
    function test_TwoStreamsOnDifferentReposCoexist() public {
        WorkStream a = _deploy(employer, agentAddr, "acme/widgets");
        WorkStream b = _deploy(otherEmployer, agentAddr, "globex/gadgets");

        vm.expectEmit(true, true, true, true);
        emit StreamRegistered(address(a), employer, agentAddr, "acme/widgets");
        vm.prank(employer);
        registry.register(address(a));

        vm.expectEmit(true, true, true, true);
        emit StreamRegistered(address(b), otherEmployer, agentAddr, "globex/gadgets");
        vm.prank(otherEmployer);
        registry.register(address(b));

        assertTrue(address(a) != address(b), "streams must be distinct");
    }

    /// Registration is repeatable on purpose: `setRepo` must be announceable,
    /// and consumers fold the log newest-last per stream.
    function test_ReRegisterAfterSetRepoReportsTheNewRepo() public {
        WorkStream ws = _deploy(employer, agentAddr, "acme/widgets");

        vm.prank(employer);
        registry.register(address(ws));

        vm.prank(employer);
        ws.setRepo("acme/widgets-renamed");

        vm.expectEmit(true, true, true, true);
        emit StreamRegistered(address(ws), employer, agentAddr, "acme/widgets-renamed");
        vm.prank(employer);
        registry.register(address(ws));
    }

    /// The registry reads the agent from the stream, so it cannot be spoofed by
    /// the caller — an employer cannot announce a stream under someone else's
    /// agent topic.
    function test_AgentTopicComesFromTheStreamNotTheCaller() public {
        WorkStream ws = _deploy(employer, otherAgent, "acme/widgets");

        vm.expectEmit(true, true, true, true);
        emit StreamRegistered(address(ws), employer, otherAgent, "acme/widgets");

        vm.prank(employer);
        registry.register(address(ws));
    }
}
