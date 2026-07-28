// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";
import {WorkStream, IERC20} from "../src/WorkStream.sol";

contract MockUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract WorkStreamTest is Test {
    MockUSDC usdc;
    WorkStream ws;

    address employer = makeAddr("employer");
    address contributor = makeAddr("contributor");
    address payee = makeAddr("payee");
    address vault = makeAddr("vault");

    uint256 agentPk = 0xA11CE;
    address agentAddr;

    uint256 constant RATE = 100_000; // 0.1 USDC per second
    uint256 constant MAX_TRANCHE = 500e6;
    uint256 constant DAILY_CAP = 1_000e6;
    uint256 constant FUNDING = 10_000e6;
    uint64 start;
    uint64 end;

    function setUp() public {
        vm.warp(1_753_000_000);
        agentAddr = vm.addr(agentPk);
        usdc = new MockUSDC();

        start = uint64(block.timestamp);
        end = start + 30 days;

        vm.prank(employer);
        ws = new WorkStream(
            IERC20(address(usdc)),
            contributor,
            agentAddr,
            vault,
            RATE,
            start,
            end,
            "Milestone 1: ship the ledger module",
            WorkStream.Policy({maxTranche: MAX_TRANCHE, dailyUnlockCap: DAILY_CAP, payee: payee})
        );

        usdc.mint(employer, FUNDING);
        vm.startPrank(employer);
        usdc.approve(address(ws), FUNDING);
        ws.fund(FUNDING);
        vm.stopPrank();
    }

    // ------------------------------------------------------------- helpers

    function att(uint256 nonce_, uint256 tranche) internal view returns (WorkStream.Attestation memory) {
        return WorkStream.Attestation({
            nonce: nonce_,
            tranche: tranche,
            prNumber: 42,
            commitSha: "deadbeefcafe",
            confidenceBps: 9_100,
            issuedAt: block.timestamp,
            milestoneHash: ws.milestoneHash()
        });
    }

    function sign(WorkStream.Attestation memory a, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                ws.ATTESTATION_TYPEHASH(),
                a.nonce,
                a.tranche,
                a.prNumber,
                keccak256(bytes(a.commitSha)),
                a.confidenceBps,
                a.issuedAt,
                a.milestoneHash
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ws.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function unlockOk(uint256 tranche) internal {
        WorkStream.Attestation memory a = att(ws.nonce(), tranche);
        ws.unlock(a, sign(a, agentPk));
    }

    // ---------------------------------------------------------- happy path

    function test_HappyPath_UnlockSplitsAndWithdraws() public {
        vm.warp(start + 1_000); // accrued = 100 USDC
        unlockOk(100e6);

        assertEq(ws.unlocked(), 100e6);
        assertEq(usdc.balanceOf(vault), 15e6, "15% vests");
        assertEq(ws.contributorCredited(), 85e6, "85% to contributor");
        assertEq(ws.nonce(), 1, "nonce advanced");

        vm.prank(contributor);
        ws.withdraw(payee, 85e6);
        assertEq(usdc.balanceOf(payee), 85e6);
        assertEq(ws.withdrawable(), 0);
    }

    function test_AccruedStopsAtEndAndDuringPause() public {
        vm.warp(start + 1_000);
        assertEq(ws.accrued(), 100e6);

        vm.prank(employer);
        ws.pause();
        vm.warp(start + 2_000);
        assertEq(ws.accrued(), 100e6, "no accrual while paused");

        vm.prank(employer);
        ws.resume();
        vm.warp(start + 3_000);
        assertEq(ws.accrued(), 200e6, "paused second excluded after resume");

        vm.warp(end + 365 days);
        assertEq(ws.accrued(), uint256(end - start - 1_000) * RATE, "accrual capped at endTime");
    }

    // ------------------------------------------------------------- reverts

    function test_RevertWrongSigner() public {
        vm.warp(start + 1_000);
        WorkStream.Attestation memory a = att(0, 100e6);
        bytes memory sig = sign(a, 0xBAD);
        vm.expectRevert(WorkStream.WrongSigner.selector);
        ws.unlock(a, sig);
    }

    function test_RevertReplayedNonce() public {
        vm.warp(start + 10_000);
        WorkStream.Attestation memory a = att(0, 100e6);
        bytes memory sig = sign(a, agentPk);
        ws.unlock(a, sig);
        vm.expectRevert(WorkStream.BadNonce.selector);
        ws.unlock(a, sig);
    }

    function test_RevertStaleAttestation() public {
        vm.warp(start + 10_000);
        WorkStream.Attestation memory a = att(0, 100e6);
        a.issuedAt = block.timestamp - 15 minutes - 1;
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.StaleAttestation.selector);
        ws.unlock(a, sig);
    }

    function test_RevertOverMaxTranche() public {
        vm.warp(start + 10_000); // accrued = 1000 USDC
        WorkStream.Attestation memory a = att(0, MAX_TRANCHE + 1);
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.OverMaxTranche.selector);
        ws.unlock(a, sig);
    }

    function test_RevertDailyCapExhausted_ResetsNextDay() public {
        vm.warp(start + 20_000); // accrued = 2000 USDC
        unlockOk(500e6);
        unlockOk(500e6); // exactly at the 1000 USDC daily cap

        WorkStream.Attestation memory a = att(2, 1e6);
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.DailyCapExceeded.selector);
        ws.unlock(a, sig);

        vm.warp(block.timestamp + 1 days);
        unlockOk(1e6); // cap resets
        assertEq(ws.unlocked(), 1_001e6);
    }

    function test_RevertUnlockWhilePaused() public {
        vm.warp(start + 1_000);
        vm.prank(employer);
        ws.pause();
        WorkStream.Attestation memory a = att(0, 10e6);
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.Paused.selector);
        ws.unlock(a, sig);
    }

    function test_RevertWithdrawToNonAllowlisted() public {
        vm.warp(start + 1_000);
        unlockOk(100e6);
        vm.prank(contributor);
        vm.expectRevert(WorkStream.PayeeNotAllowlisted.selector);
        ws.withdraw(contributor, 85e6);
    }

    function test_RevertUnlockExceedsAccrued() public {
        vm.warp(start + 100); // accrued = 10 USDC
        WorkStream.Attestation memory a = att(0, 11e6);
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.ExceedsAccrued.selector);
        ws.unlock(a, sig);
    }

    function test_RevertMilestoneMismatch() public {
        vm.warp(start + 1_000);
        WorkStream.Attestation memory a = att(0, 100e6);
        a.milestoneHash = keccak256("some other milestone");
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.MilestoneMismatch.selector);
        ws.unlock(a, sig);
    }

    // ------------------------------------------------------------- reclaim

    function test_RevertReclaimBeforeEnd() public {
        vm.warp(start + 1_000);
        vm.prank(employer);
        vm.expectRevert(WorkStream.StreamNotEnded.selector);
        ws.reclaimUnattested();
    }

    function test_ReclaimAfterEnd_LeavesContributorFunds() public {
        vm.warp(start + 1_000);
        unlockOk(100e6); // vault got 15, contributor credited 85

        vm.warp(end + 1);
        vm.prank(employer);
        ws.reclaimUnattested();

        assertEq(usdc.balanceOf(employer), FUNDING - 15e6 - 85e6, "employer got everything but vault + pending");
        assertEq(ws.withdrawable(), 85e6);
        vm.prank(contributor);
        ws.withdraw(payee, 85e6); // contributor share survives reclaim
        assertEq(usdc.balanceOf(payee), 85e6);
    }

    // ------------------------------------------------------------ milestone

    function test_SetMilestoneRotatesHash_OldAttestationFails() public {
        vm.warp(start + 1_000);
        WorkStream.Attestation memory a = att(0, 100e6); // bound to milestone 1
        bytes memory sig = sign(a, agentPk);

        vm.prank(employer);
        ws.setMilestone("Milestone 2: ship the webhook agent");

        vm.expectRevert(WorkStream.MilestoneMismatch.selector);
        ws.unlock(a, sig);
    }
}
