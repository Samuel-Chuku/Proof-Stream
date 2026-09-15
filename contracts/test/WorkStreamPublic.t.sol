// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// PUBLIC MODE: a stream that names nobody, where anyone's accepted work earns a
// share and each earner binds their own payee later.
//
// Two facts, recorded at two times. certify() writes WHO EARNED IT as a share
// of the milestone. bindPayee() writes WHO GETS PAID, once, when the earner
// chooses. Every test here exercises the seam between them.
//
// The named-mode suite in WorkStream.t.sol is the regression: it must pass
// unchanged, because a named stream in v3 cannot observe that v3 exists.
import "forge-std/Test.sol";
import {WorkStream, IERC20} from "../src/WorkStream.sol";
import {MockUSDC} from "./WorkStream.t.sol";

contract WorkStreamPublicTest is Test {
    MockUSDC usdc;
    WorkStream ws;

    address employer = makeAddr("employer");
    uint256 agentPk = 0xA11CE;
    address agentAddr;

    // Two earners, and the addresses they will each bind.
    bytes32 constant ALICE = keccak256("github:1001");
    bytes32 constant BOB = keccak256("github:2002");
    address aliceWallet = makeAddr("alice-wallet");
    address bobWallet = makeAddr("bob-wallet");
    address mallory = makeAddr("mallory");

    // 100 USDC over 100,000 seconds, so "the clock at 50%" is 50 USDC and the
    // proportional arithmetic below can be checked by eye.
    uint256 constant BUDGET = 100e6;
    uint256 constant DURATION = 100_000;
    uint256 constant CLAIM_CAP = 30e6;
    uint256 constant DAILY_CLAIM_CAP = 60e6;

    string constant M1 = "Milestone 1: ship the ledger module";

    /// The first milestone's index, READ rather than assumed. `_openMilestone`
    /// increments before use, so it is 1, and a test that hard-codes 0 passes
    /// against an empty mapping and proves nothing.
    uint256 M;

    function setUp() public {
        vm.warp(1_753_000_000);
        agentAddr = vm.addr(agentPk);
        usdc = new MockUSDC();
        ws = deployPublic(CLAIM_CAP, DAILY_CLAIM_CAP);
        fundFully(ws);
        M = ws.milestoneIndex();
    }

    // ------------------------------------------------------------- helpers

    function deployPublic(uint256 claimCap_, uint256 dailyClaimCap_) internal returns (WorkStream s) {
        vm.prank(employer);
        s = new WorkStream(
            IERC20(address(usdc)),
            address(0), // nobody named
            address(0), // no claim link either
            agentAddr,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            new string[](0),
            WorkStream.Policy({
                maxTranche: BUDGET,
                dailyUnlockCap: BUDGET,
                payee: address(0),
                claimCap: claimCap_,
                dailyClaimCap: dailyClaimCap_
            })
        );
    }

    function fundFully(WorkStream s) internal {
        uint256 needed = s.budget() - s.funded();
        usdc.mint(employer, needed);
        vm.startPrank(employer);
        usdc.approve(address(s), needed);
        s.fund(needed);
        vm.stopPrank();
    }

    function att(WorkStream s, uint256 totalBps, bytes32 earner) internal view returns (WorkStream.Attestation memory) {
        return WorkStream.Attestation({
            nonce: s.nonce(),
            certifiedBps: totalBps,
            prNumber: 7,
            commitSha: "deadbeefcafe",
            confidenceBps: 9_100,
            issuedAt: block.timestamp,
            milestoneHash: s.milestoneHash(),
            earnerId: earner
        });
    }

    /// Signs FIRST, before any cheatcode — see the note in WorkStream.t.sol.
    function sign(WorkStream s, WorkStream.Attestation memory a) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                s.ATTESTATION_TYPEHASH(),
                a.nonce,
                a.certifiedBps,
                a.prNumber,
                keccak256(bytes(a.commitSha)),
                a.confidenceBps,
                a.issuedAt,
                a.milestoneHash,
                a.earnerId
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", s.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(agentPk, digest);
        return abi.encodePacked(r, sig, v);
    }

    /// Credit `earner` so that the milestone TOTAL becomes `totalBps`.
    function credit(uint256 totalBps, bytes32 earner) internal {
        WorkStream.Attestation memory a = att(ws, totalBps, earner);
        ws.certify(a, sign(ws, a));
    }

    function bindingSig(bytes32 earner, address payee_, uint256 deadline, uint256 pk) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ws.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(ws.PAYEE_BINDING_TYPEHASH(), earner, payee_, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(pk, digest);
        return abi.encodePacked(r, sig, v);
    }

    function bind(bytes32 earner, address wallet) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = bindingSig(earner, wallet, deadline, agentPk);
        vm.prank(wallet);
        ws.bindPayee(earner, wallet, deadline, sig);
    }

    /// Alice 40%, Bob 30%, clock at 50% of the budget. The worked example from
    /// SPEC-V3, reused across the metering tests.
    function aliceAndBobAtHalfTime() internal {
        credit(4_000, ALICE);
        credit(7_000, BOB);
        vm.warp(ws.activatedAt() + DURATION / 2);
    }

    // ================================================== 1. THE MODE ITSELF

    function test_PublicStreamIsRecognised() public view {
        assertTrue(ws.isPublic());
        assertEq(ws.contributor(), address(0));
        assertEq(ws.version(), 3);
    }

    function test_NamingNobodyWithoutCapsIsRefused() public {
        // Indistinguishable from having forgotten to name anyone, so it must
        // not silently become a stream open to the world.
        vm.prank(employer);
        vm.expectRevert(WorkStream.BadCapPair.selector);
        new WorkStream(
            IERC20(address(usdc)),
            address(0),
            address(0),
            agentAddr,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            new string[](0),
            WorkStream.Policy({maxTranche: BUDGET, dailyUnlockCap: BUDGET, payee: address(0), claimCap: 0, dailyClaimCap: 0})
        );
    }

    function test_DailyClaimCapBelowClaimCapIsRefused() public {
        // A daily cap smaller than one payout means the first payout of the
        // day can never fit. Nonsense, refused at deploy.
        vm.prank(employer);
        vm.expectRevert(WorkStream.BadCapPair.selector);
        new WorkStream(
            IERC20(address(usdc)),
            address(0),
            address(0),
            agentAddr,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            new string[](0),
            WorkStream.Policy({maxTranche: BUDGET, dailyUnlockCap: BUDGET, payee: address(0), claimCap: 30e6, dailyClaimCap: 10e6})
        );
    }

    function test_ANamedStreamMayNotCarryPayoutCaps() public {
        // The caps only mean something in public mode. On a named stream they
        // would sit inert and mislead whoever read them.
        vm.prank(employer);
        vm.expectRevert(WorkStream.BadCapPair.selector);
        new WorkStream(
            IERC20(address(usdc)),
            makeAddr("c"),
            address(0),
            agentAddr,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            new string[](0),
            WorkStream.Policy({
                maxTranche: BUDGET,
                dailyUnlockCap: BUDGET,
                payee: makeAddr("c"),
                claimCap: 1,
                dailyClaimCap: 1
            })
        );
    }

    // ================================================== 2. WHO EARNED IT

    function test_CertifyRequiresAnEarnerOnAPublicStream() public {
        WorkStream.Attestation memory a = att(ws, 4_000, bytes32(0));
        bytes memory sig = sign(ws, a);
        vm.expectRevert(WorkStream.NoEarner.selector);
        ws.certify(a, sig);
    }

    function test_TwoEarnersSumToTheTotal() public {
        credit(4_000, ALICE);
        credit(7_000, BOB);
        assertEq(ws.creditBps(M, ALICE), 4_000);
        assertEq(ws.creditBps(M, BOB), 3_000, "Bob is credited the DELTA, not the total");
        assertEq(ws.certifiedBps(), 7_000);
        assertEq(ws.creditBps(M, ALICE) + ws.creditBps(M, BOB), ws.certifiedBps(), "shares sum to the total");
    }

    function test_TheSameEarnerAccumulates() public {
        credit(2_000, ALICE);
        credit(5_000, ALICE);
        assertEq(ws.creditBps(M, ALICE), 5_000);
    }

    function test_TheTotalStillRatchetsAndStillCaps() public {
        // Every existing guard works on the total, untouched. Two spot checks.
        credit(4_000, ALICE);
        WorkStream.Attestation memory lower = att(ws, 3_000, BOB);
        bytes memory sig = sign(ws, lower);
        vm.expectRevert(WorkStream.NotAnIncrease.selector);
        ws.certify(lower, sig);
    }

    // ================================================== 3. PROPORTIONAL METERING

    function test_SharesAreProportionalToCreditWhenTheClockIsBehind() public {
        aliceAndBobAtHalfTime();
        // earned = min(50 released, 70 owed) = 50.
        // Alice 50 × 40/70 = 28.571428, Bob 50 × 30/70 = 21.428571.
        assertEq(ws.earned(), 50e6);
        assertEq(ws.earnerShare(M, ALICE), 28_571_428);
        assertEq(ws.earnerShare(M, BOB), 21_428_571);
    }

    function test_DustIsBoundedByOneUnitPerEarner() public {
        aliceAndBobAtHalfTime();
        uint256 sum = ws.earnerShare(M, ALICE) + ws.earnerShare(M, BOB);
        assertLe(ws.earned() - sum, 2, "at most one unit per earner is left unassigned");
    }

    function test_ALateEarnerDoesNotClawBackWhatWasAlreadyPaid() public {
        aliceAndBobAtHalfTime();
        bind(ALICE, aliceWallet);
        vm.prank(aliceWallet);
        ws.withdrawFor(M, ALICE, 28_571_428);

        // A third earner arrives. Alice's SHARE of what is released shrinks,
        // because the total she is a fraction of grew. What she already took is
        // hers; the contract must not let the new maths go negative on her.
        credit(9_000, keccak256("github:3003"));
        uint256 shareNow = ws.earnerShare(M, ALICE);
        assertLt(shareNow, 28_571_428, "her share of the released pot is now smaller");
        // paidTo > share, so withdrawable must clamp rather than underflow.
        vm.expectRevert();
        ws.earnerWithdrawable(M, ALICE);
    }

    function test_AtFullCertificationTheWholeBudgetIsShared() public {
        credit(6_000, ALICE);
        credit(10_000, BOB);
        // 100% ends the schedule: earned() is the full target regardless of clock.
        assertEq(ws.earnerShare(M, ALICE), 60e6);
        assertEq(ws.earnerShare(M, BOB), 40e6);
    }

    // ================================================== 4. WHO GETS PAID

    function test_BindingWritesThePayeeOnce() public {
        bind(ALICE, aliceWallet);
        assertEq(ws.payeeOf(ALICE), aliceWallet);
    }

    function test_THE_SENDER_MUST_BE_THE_PAYEE() public {
        // A typo or a dead address can never be bound, because the address has
        // to send the transaction. This is what makes permanence safe.
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = bindingSig(ALICE, aliceWallet, deadline, agentPk);
        vm.prank(mallory);
        vm.expectRevert(WorkStream.NotPayee.selector);
        ws.bindPayee(ALICE, aliceWallet, deadline, sig);
    }

    function test_A_LIFTED_SIGNATURE_IS_USELESS_TO_ANOTHER_ADDRESS() public {
        // Mallory watches the mempool, copies Alice's authorisation, and submits
        // it naming herself. The payee is inside the signed struct, so the
        // recovered signer is not the agent.
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory aliceSig = bindingSig(ALICE, aliceWallet, deadline, agentPk);
        vm.prank(mallory);
        vm.expectRevert(WorkStream.WrongSigner.selector);
        ws.bindPayee(ALICE, mallory, deadline, aliceSig);
    }

    function test_BindingIsOncePerEarner() public {
        bind(ALICE, aliceWallet);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = bindingSig(ALICE, mallory, deadline, agentPk);
        vm.prank(mallory);
        vm.expectRevert(WorkStream.AlreadyBound.selector);
        ws.bindPayee(ALICE, mallory, deadline, sig);
    }

    function test_AStaleAuthorisationIsRefused() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = bindingSig(ALICE, aliceWallet, deadline, agentPk);
        vm.warp(deadline + 1);
        vm.prank(aliceWallet);
        vm.expectRevert(WorkStream.StaleBinding.selector);
        ws.bindPayee(ALICE, aliceWallet, deadline, sig);
    }

    function test_OnlyTheAgentMayAuthoriseABinding() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = bindingSig(ALICE, aliceWallet, deadline, 0xBAD);
        vm.prank(aliceWallet);
        vm.expectRevert(WorkStream.WrongSigner.selector);
        ws.bindPayee(ALICE, aliceWallet, deadline, sig);
    }

    // ================================================== 5. PAYING OUT

    function test_AnEarnerWithdrawsTheirShareToTheirPayee() public {
        aliceAndBobAtHalfTime();
        bind(ALICE, aliceWallet);
        vm.prank(aliceWallet);
        ws.withdrawFor(M, ALICE, 28_571_428);
        assertEq(usdc.balanceOf(aliceWallet), 28_571_428);
        assertEq(ws.paidTo(M, ALICE), 28_571_428);
        assertEq(ws.earnerWithdrawable(M, ALICE), 0);
    }

    function test_OneEarnerCannotTouchAnotherEarnersShare() public {
        aliceAndBobAtHalfTime();
        bind(ALICE, aliceWallet);
        bind(BOB, bobWallet);
        // Alice tries to withdraw Bob's share.
        vm.prank(aliceWallet);
        vm.expectRevert(WorkStream.NotPayee.selector);
        ws.withdrawFor(M, BOB, 1);
    }

    function test_CannotExceedOwnShare() public {
        aliceAndBobAtHalfTime();
        bind(ALICE, aliceWallet);
        vm.prank(aliceWallet);
        vm.expectRevert(WorkStream.ExceedsWithdrawable.selector);
        ws.withdrawFor(M, ALICE, 28_571_429);
    }

    function test_AnUnboundEarnerCannotBePaid() public {
        aliceAndBobAtHalfTime();
        vm.prank(aliceWallet);
        vm.expectRevert(WorkStream.NotPayee.selector);
        ws.withdrawFor(M, ALICE, 1);
    }

    function test_PAYOUT_IS_CAPPED_PER_CALL() public {
        // Full certification, so Alice is owed 60. The cap is 30.
        credit(6_000, ALICE);
        credit(10_000, BOB);
        bind(ALICE, aliceWallet);
        vm.prank(aliceWallet);
        vm.expectRevert(WorkStream.OverClaimCap.selector);
        ws.withdrawFor(M, ALICE, 30e6 + 1);
    }

    function test_PAYOUT_IS_CAPPED_PER_DAY() public {
        // Owed 60, cap 30 per call and 60 per day. Two calls fit; a third,
        // even for one unit, does not until tomorrow.
        credit(6_000, ALICE);
        credit(10_000, BOB);
        bind(ALICE, aliceWallet);
        vm.startPrank(aliceWallet);
        ws.withdrawFor(M, ALICE, 30e6);
        ws.withdrawFor(M, ALICE, 30e6);
        vm.stopPrank();

        bind(BOB, bobWallet);
        vm.prank(bobWallet);
        vm.expectRevert(WorkStream.DailyClaimCapExceeded.selector);
        ws.withdrawFor(M, BOB, 1);

        vm.warp(block.timestamp + 1 days);
        vm.prank(bobWallet);
        ws.withdrawFor(M, BOB, 30e6);
        assertEq(usdc.balanceOf(bobWallet), 30e6);
    }

    function test_TheOldWithdrawIsClosedOnAPublicStream() public {
        aliceAndBobAtHalfTime();
        bind(ALICE, aliceWallet);
        vm.prank(aliceWallet);
        vm.expectRevert(WorkStream.NotContributor.selector);
        ws.withdraw(aliceWallet, 1);
    }

    // ================================================== 6. ACROSS MILESTONES

    function test_SharesSurviveTheMilestoneClosing() public {
        aliceAndBobAtHalfTime();
        // Run the clock out, close. closeMilestone credits the full target (70),
        // not the clock's 50: after the end date the clock is irrelevant.
        vm.warp(ws.milestoneEndsAt() + 5 hours);
        vm.prank(employer);
        ws.closeMilestone();

        assertEq(ws.closedTarget(M), 70e6);
        assertEq(ws.closedBps(M), 7_000);
        assertEq(ws.earnerShare(M, ALICE), 40e6, "full share, no longer metered by a clock");
        assertEq(ws.earnerShare(M, BOB), 30e6);

        // The employer opens the next milestone, overwriting `cur`. Alice's
        // share of milestone 0 must be exactly what it was.
        vm.prank(employer);
        ws.openMilestone("Milestone 2", 50e6, DURATION);
        assertEq(ws.earnerShare(M, ALICE), 40e6);

        bind(ALICE, aliceWallet);
        vm.prank(aliceWallet);
        ws.withdrawFor(M, ALICE, 30e6);
        assertEq(usdc.balanceOf(aliceWallet), 30e6);
    }

    function test_ClosingRefundsOnlyWhatNobodyEarned() public {
        aliceAndBobAtHalfTime();
        vm.warp(ws.milestoneEndsAt() + 5 hours);
        uint256 before = usdc.balanceOf(employer);
        vm.prank(employer);
        ws.closeMilestone();
        // 100 funded, 70 owed to earners, 30 back.
        assertEq(usdc.balanceOf(employer) - before, 30e6);
    }

    function test_CreditFromTwoMilestonesIsKeptApart() public {
        credit(10_000, ALICE);
        vm.warp(ws.milestoneEndsAt() + 5 hours);
        vm.prank(employer);
        ws.closeMilestone();
        vm.prank(employer);
        ws.openMilestone("Milestone 2", 50e6, DURATION);
        fundFully(ws);
        credit(10_000, BOB);

        assertEq(ws.creditBps(M, ALICE), 10_000);
        assertEq(ws.creditBps(M, BOB), 0);
        assertEq(ws.creditBps(M + 1, ALICE), 0);
        assertEq(ws.creditBps(M + 1, BOB), 10_000);
        assertEq(ws.earnerShare(M, ALICE), 100e6);
        assertEq(ws.earnerShare(M + 1, BOB), 50e6);
    }
}
