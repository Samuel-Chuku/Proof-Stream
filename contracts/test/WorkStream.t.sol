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

    // BUDGET / DURATION works out to 0.1 USDC per second.
    uint256 constant DURATION = 30 days;
    uint256 constant BUDGET = 259_200e6;
    uint256 constant MAX_TRANCHE = 500e6;
    uint256 constant DAILY_CAP = 1_000e6;

    string constant M1 = "Milestone 1: ship the ledger module";

    uint64 start; // activation timestamp

    function setUp() public {
        vm.warp(1_753_000_000);
        agentAddr = vm.addr(agentPk);
        usdc = new MockUSDC();

        vm.prank(employer);
        ws = new WorkStream(
            IERC20(address(usdc)),
            contributor,
            agentAddr,
            vault,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            WorkStream.Policy({maxTranche: MAX_TRANCHE, dailyUnlockCap: DAILY_CAP, payee: payee})
        );

        fundFully();
        start = ws.activatedAt();
    }

    // ------------------------------------------------------------- helpers

    function fundFully() internal {
        uint256 needed = ws.budget() - ws.funded();
        usdc.mint(employer, needed);
        vm.startPrank(employer);
        usdc.approve(address(ws), needed);
        ws.fund(needed);
        vm.stopPrank();
    }

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
        assertEq(ws.milestoneUnlocked(), 100e6, "counted against this milestone");
        assertEq(usdc.balanceOf(vault), 15e6, "vault got 15%");
        assertEq(ws.contributorCredited(), 85e6, "contributor credited 85%");
        assertEq(ws.withdrawable(), 85e6);
        assertEq(ws.nonce(), 1, "nonce advanced");

        vm.prank(contributor);
        ws.withdraw(payee, 85e6);
        assertEq(usdc.balanceOf(payee), 85e6);
        assertEq(ws.withdrawable(), 0);
    }

    // ------------------------------------------------- the anti-rug gate

    /// The attack this closes: employer promises a budget, contributor builds
    /// the whole thing, employer never deposited. Here the milestone simply
    /// never starts, so there is nothing to work against and nothing is lost.
    function test_MilestoneDoesNotStartUntilFullyFunded() public {
        vm.prank(employer);
        WorkStream fresh = new WorkStream(
            IERC20(address(usdc)),
            contributor,
            agentAddr,
            vault,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            WorkStream.Policy({maxTranche: MAX_TRANCHE, dailyUnlockCap: DAILY_CAP, payee: payee})
        );

        assertFalse(fresh.fullyFunded(), "no money in");
        assertFalse(fresh.isActive(), "not started");
        assertEq(fresh.activatedAt(), 0);

        // Time passing changes nothing while unfunded.
        vm.warp(block.timestamp + 20 days);
        assertEq(fresh.accrued(), 0, "an unfunded milestone earns nothing");

        // A PARTIAL deposit still does not start it — this is the whole point.
        usdc.mint(employer, BUDGET);
        vm.startPrank(employer);
        usdc.approve(address(fresh), BUDGET);
        fresh.fund(BUDGET - 1);
        vm.stopPrank();

        assertFalse(fresh.fullyFunded(), "one unit short");
        assertEq(fresh.activatedAt(), 0, "still not started");
        vm.warp(block.timestamp + 5 days);
        assertEq(fresh.accrued(), 0, "still earns nothing");

        // Meeting the budget starts it, from that instant.
        vm.prank(employer);
        fresh.fund(1);

        assertTrue(fresh.fullyFunded());
        assertTrue(fresh.isActive());
        assertEq(fresh.activatedAt(), uint64(block.timestamp), "clock starts on funding, not deploy");
        assertEq(fresh.accrued(), 0, "no time has passed since activation");
    }

    function test_UnlockRevertsBeforeTheMilestoneIsFunded() public {
        vm.prank(employer);
        WorkStream fresh = new WorkStream(
            IERC20(address(usdc)),
            contributor,
            agentAddr,
            vault,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            WorkStream.Policy({maxTranche: MAX_TRANCHE, dailyUnlockCap: DAILY_CAP, payee: payee})
        );

        WorkStream.Attestation memory a = WorkStream.Attestation({
            nonce: 0,
            tranche: 1e6,
            prNumber: 1,
            commitSha: "abc",
            confidenceBps: 9_000,
            issuedAt: block.timestamp,
            milestoneHash: fresh.milestoneHash()
        });

        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.MilestoneNotFunded.selector);
        fresh.unlock(a, sig);
    }

    // ------------------------------------------------------------- accrual

    /// Proportional accrual: exact at the end, no per-second rounding dust.
    function test_AccrualIsProportionalAndExactAtTheEnd() public {
        vm.warp(start + DURATION / 2);
        assertEq(ws.accrued(), BUDGET / 2, "half the time, half the budget");

        vm.warp(start + DURATION);
        assertEq(ws.accrued(), BUDGET, "the whole budget, to the unit");

        vm.warp(start + DURATION + 365 days);
        assertEq(ws.accrued(), BUDGET, "and never more than the budget");
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
        assertEq(ws.accrued(), 200e6, "paused seconds excluded after resume");
    }

    /// The invariant the funding gate buys: whatever the agent certifies, the
    /// contributor can actually collect.
    function test_EverythingCertifiedIsAlwaysCollectable() public {
        uint256 certified;
        for (uint256 i = 0; i < 6; i++) {
            vm.warp(block.timestamp + 1 days);
            uint256 tranche = MAX_TRANCHE;
            if (certified + tranche > ws.accrued()) break;
            unlockOk(tranche);
            certified += tranche;
        }

        assertGt(certified, 0, "some work was certified");
        uint256 owed = ws.withdrawable();
        assertGt(owed, 0);
        assertGe(usdc.balanceOf(address(ws)), owed, "contract can always cover what it owes");

        vm.prank(contributor);
        ws.withdraw(payee, owed);
        assertEq(usdc.balanceOf(payee), owed, "collected in full");
    }

    // ------------------------------------------------------------- reverts

    function test_RevertWrongSigner() public {
        vm.warp(start + 1_000);
        WorkStream.Attestation memory a = att(0, 100e6);
        bytes memory sig = sign(a, 0xBADBAD);
        vm.expectRevert(WorkStream.WrongSigner.selector);
        ws.unlock(a, sig);
    }

    function test_RevertReplayedNonce() public {
        vm.warp(start + 10_000);
        unlockOk(100e6);
        WorkStream.Attestation memory a = att(0, 100e6); // nonce 0 again
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.BadNonce.selector);
        ws.unlock(a, sig);
    }

    function test_RevertStaleAttestation() public {
        vm.warp(start + 10_000);
        WorkStream.Attestation memory a = att(0, 100e6);
        bytes memory sig = sign(a, agentPk);
        vm.warp(block.timestamp + 16 minutes);
        vm.expectRevert(WorkStream.StaleAttestation.selector);
        ws.unlock(a, sig);
    }

    function test_RevertOverMaxTranche() public {
        vm.warp(start + DURATION);
        WorkStream.Attestation memory a = att(0, MAX_TRANCHE + 1);
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.OverMaxTranche.selector);
        ws.unlock(a, sig);
    }

    function test_RevertDailyCapExhausted_ResetsNextDay() public {
        vm.warp(start + DURATION); // whole budget accrued
        unlockOk(500e6);
        unlockOk(500e6); // daily cap now exhausted

        WorkStream.Attestation memory a = att(ws.nonce(), 1e6);
        bytes memory sig = sign(a, agentPk);
        vm.expectRevert(WorkStream.DailyCapExceeded.selector);
        ws.unlock(a, sig);

        vm.warp(block.timestamp + 1 days);
        unlockOk(500e6); // fresh day, fresh cap
        assertEq(ws.unlocked(), 1_500e6);
    }

    function test_RevertUnlockExceedsAccrued() public {
        vm.warp(start + 100); // accrued = 10 USDC
        WorkStream.Attestation memory a = att(0, 50e6);
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

    function test_RevertWithdrawToNonAllowlisted() public {
        vm.warp(start + 1_000);
        unlockOk(100e6);
        vm.prank(contributor);
        vm.expectRevert(WorkStream.PayeeNotAllowlisted.selector);
        ws.withdraw(contributor, 10e6);
    }

    // --------------------------------------------------- pause semantics

    /// Pause stops the clock but must NOT freeze the agent out of certifying
    /// work already earned — otherwise an employer could watch work land,
    /// pause, and strand pay the contributor had already earned.
    function test_PauseStopsAccrualButNotCertification() public {
        vm.warp(start + 10_000); // accrued = 1000 USDC
        uint256 earned = ws.accrued();

        vm.prank(employer);
        ws.pause();

        vm.warp(block.timestamp + 5 days);
        assertEq(ws.accrued(), earned, "clock stopped");

        unlockOk(500e6); // still certifiable
        assertEq(ws.unlocked(), 500e6, "already-earned work can still be released");

        uint256 owed = ws.withdrawable();
        vm.prank(contributor);
        ws.withdraw(payee, owed);
        assertGt(usdc.balanceOf(payee), 0, "and still collectable");
    }

    // ------------------------------------------------ milestone lifecycle

    function test_CannotOpenASecondMilestoneWhileOneIsOpen() public {
        vm.prank(employer);
        vm.expectRevert(WorkStream.MilestoneAlreadyOpen.selector);
        ws.openMilestone("Milestone 2: something else", 100e6, 1 days);
    }

    function test_CannotCloseWhileTheMilestoneIsStillRunning() public {
        vm.warp(start + 1_000);
        vm.prank(employer);
        vm.expectRevert(WorkStream.MilestoneStillRunning.selector);
        ws.closeMilestone();
    }

    function test_CloseReturnsUnspentAndOpensTheNext() public {
        vm.warp(start + 10_000);
        unlockOk(100e6); // 15 to vault, 85 credited

        vm.warp(start + DURATION + 1);
        uint256 employerBefore = usdc.balanceOf(employer);

        vm.prank(employer);
        ws.closeMilestone();

        assertTrue(ws.milestoneClosed());
        assertEq(ws.withdrawable(), 85e6, "contributor's credit survives the close");
        assertEq(
            usdc.balanceOf(employer) - employerBefore,
            BUDGET - 15e6 - 85e6,
            "employer got back everything but the vault share and what is owed"
        );

        // The contributor can still collect after the close.
        vm.prank(contributor);
        ws.withdraw(payee, 85e6);
        assertEq(usdc.balanceOf(payee), 85e6);

        // Next milestone opens, unfunded, and does not accrue until funded.
        vm.prank(employer);
        ws.openMilestone("Milestone 2: harden the ledger", 1_000e6, 1 days);

        assertEq(ws.milestoneIndex(), 2);
        assertEq(ws.budget(), 1_000e6);
        assertEq(ws.activatedAt(), 0, "not started until funded");
        assertEq(ws.accrued(), 0);
        assertEq(ws.milestoneUnlocked(), 0, "per-milestone counter reset");
        assertEq(ws.unlocked(), 100e6, "lifetime total preserved");
    }

    function test_OpeningAMilestoneRotatesTheHash_OldAttestationFails() public {
        vm.warp(start + DURATION + 1);
        vm.prank(employer);
        ws.closeMilestone();

        WorkStream.Attestation memory stale = att(ws.nonce(), 10e6); // old hash

        vm.prank(employer);
        ws.openMilestone("Milestone 2: harden the ledger", 1_000e6, 1 days);
        fundFully();

        bytes memory sig = sign(stale, agentPk);
        vm.expectRevert(WorkStream.MilestoneMismatch.selector);
        ws.unlock(stale, sig);
    }

    function test_OpenMilestoneRejectsZeroBudgetOrDuration() public {
        vm.warp(start + DURATION + 1);
        vm.prank(employer);
        ws.closeMilestone();

        vm.prank(employer);
        vm.expectRevert(WorkStream.BadBudget.selector);
        ws.openMilestone("bad", 0, 1 days);

        vm.prank(employer);
        vm.expectRevert(WorkStream.BadBudget.selector);
        ws.openMilestone("bad", 100e6, 0);
    }

    // ------------------------------------------------------------ authority

    function test_SetRepo_EmployerOnly() public {
        assertEq(ws.repo(), "acme/widgets");

        vm.prank(employer);
        ws.setRepo("acme/widgets-v2");
        assertEq(ws.repo(), "acme/widgets-v2", "employer repoints the agent");

        vm.prank(contributor);
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.setRepo("attacker/repo");
    }

    function test_EmployerOnlyGuards() public {
        vm.startPrank(contributor);
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.pause();
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.closeMilestone();
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.openMilestone("x", 1e6, 1 days);
        vm.stopPrank();
    }
}
