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

    uint256 agentPk = 0xA11CE;
    address agentAddr;

    // 10,000 USDC over 100,000 seconds = exactly 0.1 USDC per second, so
    // accrual arithmetic in these tests is readable by eye.
    uint256 constant DURATION = 100_000;
    uint256 constant BUDGET = 10_000e6;

    // The default stream deliberately sets maxTranche to the WHOLE budget —
    // the value `suggestedCaps` now recommends — so money-model tests are not
    // silently shaped by the policy. Cap behaviour gets its own stream.
    uint256 constant MAX_TRANCHE = BUDGET;
    uint256 constant DAILY_CAP = BUDGET;

    string constant M1 = "Milestone 1: ship the ledger module";

    uint64 start; // activation timestamp

    function setUp() public {
        vm.warp(1_753_000_000);
        agentAddr = vm.addr(agentPk);
        usdc = new MockUSDC();
        ws = deploy(MAX_TRANCHE, DAILY_CAP);
        fundFully(ws);
        start = ws.activatedAt();
    }

    // ------------------------------------------------------------- helpers

    function deploy(uint256 maxTranche_, uint256 dailyCap_) internal returns (WorkStream s) {
        vm.prank(employer);
        s = new WorkStream(
            IERC20(address(usdc)),
            contributor,
            agentAddr,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            WorkStream.Policy({maxTranche: maxTranche_, dailyUnlockCap: dailyCap_, payee: payee})
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

    function att(WorkStream s, uint256 nonce_, uint256 bps) internal view returns (WorkStream.Attestation memory) {
        return WorkStream.Attestation({
            nonce: nonce_,
            certifiedBps: bps,
            prNumber: 42,
            commitSha: "deadbeefcafe",
            confidenceBps: 9_100,
            issuedAt: block.timestamp,
            milestoneHash: s.milestoneHash()
        });
    }

    /// NOTE: this reads DOMAIN_SEPARATOR() off the contract, which is an
    /// EXTERNAL CALL. `vm.prank` and `vm.expectRevert` bind to the next external
    /// call, so a signature built after a cheatcode consumes it and the cheatcode
    /// never reaches the function under test. Every revert test below therefore
    /// signs FIRST and arms the cheatcode immediately before `certify`.
    function sign(WorkStream s, WorkStream.Attestation memory a, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                s.ATTESTATION_TYPEHASH(),
                a.nonce,
                a.certifiedBps,
                a.prNumber,
                keccak256(bytes(a.commitSha)),
                a.confidenceBps,
                a.issuedAt,
                a.milestoneHash
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", s.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(pk, digest);
        return abi.encodePacked(r, sig, v);
    }

    function certifyOk(WorkStream s, uint256 bps) internal {
        WorkStream.Attestation memory a = att(s, s.nonce(), bps);
        s.certify(a, sign(s, a, agentPk));
    }

    function certifyOk(uint256 bps) internal {
        certifyOk(ws, bps);
    }

    // ================================================== THE MONEY MODEL

    /// The agent owns what was earned; the clock owns when it arrives. Neither
    /// overrides the other.
    function test_EarnedIsTheAgentsVerdictMeteredByTheClock() public {
        vm.warp(start + 10_000); // accrued = 1,000
        certifyOk(5_000); // agent certifies half the milestone = 5,000

        assertEq(ws.target(), 5_000e6, "the agent's verdict, in USDC");
        assertEq(ws.accrued(), 1_000e6, "the clock, untouched by certification");
        assertEq(ws.earned(), 1_000e6, "metered: you cannot take what has not accrued");
        assertEq(ws.withdrawable(), 1_000e6);
    }

    /// THE HEADLINE FIX. One certification keeps paying as the stream runs. The
    /// previous design required a fresh attestation — and therefore a fresh
    /// merged PR — for every additional payment, which pushed contributors
    /// toward padding work they did not need to do.
    function test_OneCertificationKeepsPayingWithoutAnotherMerge() public {
        vm.warp(start + 10_000);
        certifyOk(5_000);
        assertEq(ws.earned(), 1_000e6);

        uint256 nonceAfter = ws.nonce();

        vm.warp(start + 30_000); // accrued = 3,000
        assertEq(ws.earned(), 3_000e6, "more arrived with no new attestation");

        vm.warp(start + 50_000); // accrued = 5,000, now equal to target
        assertEq(ws.earned(), 5_000e6);

        vm.warp(start + DURATION); // accrued = 10,000, target still 5,000
        assertEq(ws.earned(), 5_000e6, "never more than the agent certified");
        assertEq(ws.nonce(), nonceAfter, "and the agent never had to act again");
    }

    /// Complete work ends the schedule: there is nothing left to stream toward,
    /// so metering it would be delay for its own sake.
    function test_FullCertificationEndsTheScheduleImmediately() public {
        vm.warp(start + 10_000); // only 1,000 of 10,000 has accrued
        certifyOk(10_000);

        assertEq(ws.accrued(), 1_000e6, "the clock has not moved");
        assertEq(ws.earned(), BUDGET, "but the milestone is done, so all of it is earned");

        vm.prank(contributor);
        ws.withdraw(payee, BUDGET);
        assertEq(usdc.balanceOf(payee), BUDGET);
    }

    /// Time alone pays nothing. This is what stops the stream being a faucet.
    function test_TimeAlonePaysNothingWithoutCertification() public {
        vm.warp(start + DURATION);
        assertEq(ws.accrued(), BUDGET, "fully accrued by the clock");
        assertEq(ws.target(), 0, "but nothing certified");
        assertEq(ws.earned(), 0, "so nothing is earned");
        assertEq(ws.withdrawable(), 0);
    }

    /// A later judgment may raise a claim; it may never reduce one the
    /// contributor has already been told they have.
    function test_CertificationIsMonotonic() public {
        vm.warp(start + 50_000);
        certifyOk(6_000);

        WorkStream.Attestation memory a = att(ws, ws.nonce(), 4_000);
        bytes memory sig = sign(ws, a, agentPk);
        vm.expectRevert(WorkStream.NotAnIncrease.selector);
        ws.certify(a, sig);

        WorkStream.Attestation memory same = att(ws, ws.nonce(), 6_000);
        bytes memory sameSig = sign(ws, same, agentPk);
        vm.expectRevert(WorkStream.NotAnIncrease.selector);
        ws.certify(same, sameSig);

        assertEq(ws.target(), 6_000e6, "unchanged");
    }

    /// Each merged PR can move the claim closer to the full amount.
    function test_SuccessivePullRequestsRaiseTheClaim() public {
        vm.warp(start + DURATION); // fully accrued, so the clock never binds
        certifyOk(3_000);
        assertEq(ws.earned(), 3_000e6);
        certifyOk(7_500);
        assertEq(ws.earned(), 7_500e6);
        certifyOk(10_000);
        assertEq(ws.earned(), BUDGET);
    }

    function test_RevertCertificationAboveOneHundredPercent() public {
        WorkStream.Attestation memory a = att(ws, ws.nonce(), 10_001);
        bytes memory sig = sign(ws, a, agentPk);
        vm.expectRevert(WorkStream.BadCertification.selector);
        ws.certify(a, sig);
    }

    // ============================================ THE ON-CHAIN POLICY (T1)

    /// The cap is measured on the entitlement an attestation CREATES, not on the
    /// cumulative total — otherwise the first certification would consume it.
    function test_PolicyCapsTheEntitlementEachAttestationCreates() public {
        WorkStream s = deploy(3_000e6, BUDGET);
        fundFully(s);
        vm.warp(block.timestamp + DURATION);

        certifyOk(s, 2_500); // creates 2,500 — inside the 3,000 ceiling
        assertEq(s.target(), 2_500e6);

        certifyOk(s, 5_000); // creates another 2,500, not 5,000
        assertEq(s.target(), 5_000e6, "cumulative total may exceed maxTranche");
    }

    function test_RevertOverMaxTranche() public {
        WorkStream s = deploy(3_000e6, BUDGET);
        fundFully(s);
        vm.warp(block.timestamp + DURATION);

        WorkStream.Attestation memory a = att(s, s.nonce(), 4_000); // creates 4,000
        bytes memory sig = sign(s, a, agentPk);
        vm.expectRevert(WorkStream.OverMaxTranche.selector);
        s.certify(a, sig);
    }

    function test_RevertDailyCapExhausted_ResetsNextDay() public {
        WorkStream s = deploy(BUDGET, 3_000e6);
        fundFully(s);
        vm.warp(block.timestamp + DURATION);

        certifyOk(s, 3_000); // exactly the daily cap
        assertEq(s.unlockedToday(), 3_000e6);

        WorkStream.Attestation memory a = att(s, s.nonce(), 3_100); // one more unit
        bytes memory sig = sign(s, a, agentPk);
        vm.expectRevert(WorkStream.DailyCapExceeded.selector);
        s.certify(a, sig);

        vm.warp(block.timestamp + 1 days);
        certifyOk(s, 6_000); // a new day, a fresh allowance
        assertEq(s.target(), 6_000e6);
        assertEq(s.unlockedToday(), 3_000e6, "day bucket reset");
    }

    /// The employer may loosen the mandate; nobody may tighten it, and the agent
    /// may not touch it at all.
    function test_RaisePolicy_OnlyUpwardsAndOnlyByTheEmployer() public {
        WorkStream s = deploy(3_000e6, 5_000e6);

        vm.prank(employer);
        s.raisePolicy(6_000e6, 9_000e6);
        (uint256 maxT, uint256 daily,) = s.policy();
        assertEq(maxT, 6_000e6);
        assertEq(daily, 9_000e6);

        vm.prank(employer);
        vm.expectRevert(WorkStream.CapsMayOnlyRise.selector);
        s.raisePolicy(5_999e6, 9_000e6);

        vm.prank(employer);
        vm.expectRevert(WorkStream.CapsMayOnlyRise.selector);
        s.raisePolicy(6_000e6, 8_999e6);

        vm.prank(agentAddr);
        vm.expectRevert(WorkStream.NotEmployer.selector);
        s.raisePolicy(9_000e6, 9_000e6);
    }

    /// The payee allowlist is the contributor's protection, so `raisePolicy`
    /// must not be a back door to changing it.
    function test_RaisePolicyCannotChangeThePayee() public {
        vm.prank(employer);
        ws.raisePolicy(MAX_TRANCHE, DAILY_CAP);
        (,, address p) = ws.policy();
        assertEq(p, payee, "payee is untouched by any policy change");
    }

    // ========================================== SIGNATURE AND REPLAY

    function test_RevertWrongSigner() public {
        WorkStream.Attestation memory a = att(ws, ws.nonce(), 1_000);
        bytes memory sig = sign(ws, a, 0xBAD5EED);
        vm.expectRevert(WorkStream.WrongSigner.selector);
        ws.certify(a, sig);
    }

    function test_RevertReplayedNonce() public {
        vm.warp(start + DURATION);
        WorkStream.Attestation memory a = att(ws, ws.nonce(), 2_000);
        bytes memory sig = sign(ws, a, agentPk);
        ws.certify(a, sig);

        vm.expectRevert(WorkStream.BadNonce.selector);
        ws.certify(a, sig); // byte-identical replay
    }

    function test_RevertStaleAttestation() public {
        WorkStream.Attestation memory a = att(ws, ws.nonce(), 1_000);
        bytes memory sig = sign(ws, a, agentPk);
        vm.warp(block.timestamp + ws.ATTESTATION_TTL() + 1);
        vm.expectRevert(WorkStream.StaleAttestation.selector);
        ws.certify(a, sig);
    }

    function test_RevertFutureAttestation() public {
        WorkStream.Attestation memory a = att(ws, ws.nonce(), 1_000);
        a.issuedAt = block.timestamp + 1;
        bytes memory sig = sign(ws, a, agentPk);
        vm.expectRevert(WorkStream.FutureAttestation.selector);
        ws.certify(a, sig);
    }

    /// Opening a milestone rotates the hash, so a verdict signed against the old
    /// one cannot be spent against the new.
    function test_OpeningAMilestoneRotatesTheHash_OldAttestationFails() public {
        bytes32 oldHash = ws.milestoneHash();

        vm.warp(ws.closableAt());
        vm.startPrank(employer);
        ws.closeMilestone();
        ws.openMilestone("Milestone 2: something else entirely", BUDGET, DURATION);
        vm.stopPrank();
        fundFully(ws);

        assertTrue(ws.milestoneHash() != oldHash, "the hash rotated");

        // Issued NOW, so this fails on the milestone binding alone — warping
        // forward to rotate the milestone would otherwise trip the 15-minute
        // staleness check first and prove nothing about the hash.
        WorkStream.Attestation memory a = att(ws, ws.nonce(), 1_000);
        a.milestoneHash = oldHash;
        bytes memory sig = sign(ws, a, agentPk);

        vm.expectRevert(WorkStream.MilestoneMismatch.selector);
        ws.certify(a, sig);
    }

    function test_RevertMilestoneMismatch() public {
        WorkStream.Attestation memory a = att(ws, ws.nonce(), 1_000);
        a.milestoneHash = keccak256("a milestone that was never opened");
        bytes memory sig = sign(ws, a, agentPk);
        vm.expectRevert(WorkStream.MilestoneMismatch.selector);
        ws.certify(a, sig);
    }

    // ================================================ THE ANTI-RUG GATE

    /// The attack this closes: employer promises a budget, contributor builds the
    /// whole thing, employer never deposited. The milestone simply never starts.
    function test_MilestoneDoesNotStartUntilFullyFunded() public {
        WorkStream fresh = deploy(MAX_TRANCHE, DAILY_CAP);

        assertFalse(fresh.fullyFunded(), "no money in");
        assertFalse(fresh.isActive(), "not started");
        assertEq(fresh.activatedAt(), 0);

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

        vm.prank(employer);
        fresh.fund(1);

        assertTrue(fresh.fullyFunded());
        assertTrue(fresh.isActive());
        assertEq(fresh.activatedAt(), uint64(block.timestamp), "clock starts on funding, not deploy");
        assertEq(fresh.accrued(), 0, "no time has passed since activation");
    }

    function test_CertifyRevertsBeforeTheMilestoneIsFunded() public {
        WorkStream fresh = deploy(MAX_TRANCHE, DAILY_CAP);
        WorkStream.Attestation memory a = att(fresh, 0, 1_000);
        bytes memory sig = sign(fresh, a, agentPk);
        vm.expectRevert(WorkStream.MilestoneNotFunded.selector);
        fresh.certify(a, sig);
    }

    // ============================================= CLOSING AND SETTLEMENT

    /// The race this closes: judging, buying a second opinion and landing a
    /// transaction all take real time, so work merged just before the deadline is
    /// still being certified when the clock runs out.
    function test_CloseIsRefusedUntilTheGraceWindowHasPassed() public {
        vm.warp(ws.milestoneEndsAt());
        vm.prank(employer);
        vm.expectRevert(WorkStream.MilestoneStillRunning.selector);
        ws.closeMilestone();

        vm.warp(ws.closableAt() - 1);
        vm.prank(employer);
        vm.expectRevert(WorkStream.MilestoneStillRunning.selector);
        ws.closeMilestone();

        vm.warp(ws.closableAt());
        vm.prank(employer);
        ws.closeMilestone();
        assertTrue(ws.milestoneClosed());
    }

    function test_CloseCrystallisesTheCertifiedTargetAndRefundsTheRest() public {
        vm.warp(start + DURATION);
        certifyOk(4_000); // 4,000 certified of a 10,000 budget

        vm.warp(ws.closableAt());
        vm.prank(employer);
        ws.closeMilestone();

        assertEq(ws.settledCredit(), 4_000e6, "the agent's verdict is final");
        assertEq(ws.withdrawable(), 4_000e6);
        assertEq(usdc.balanceOf(employer), 6_000e6, "uncertified budget goes home");

        vm.prank(contributor);
        ws.withdraw(payee, 4_000e6);
        assertEq(usdc.balanceOf(payee), 4_000e6);
    }

    /// Pausing must be a delay, never a way to keep certified work. Here the
    /// employer pauses immediately after certification so the clock never
    /// reaches the target — and the contributor is still made whole at close.
    function test_PauseCannotStrandCertifiedWork() public {
        vm.warp(start + 1_000); // accrued = 100 only
        certifyOk(8_000); // agent certifies 8,000

        vm.prank(employer);
        ws.pause();

        assertEq(ws.earned(), 100e6, "the clock is stopped, so payment is delayed");

        vm.warp(ws.closableAt());
        vm.prank(employer);
        ws.closeMilestone();

        assertEq(ws.withdrawable(), 8_000e6, "but the verdict is honoured in full");
        vm.prank(contributor);
        ws.withdraw(payee, 8_000e6);
        assertEq(usdc.balanceOf(payee), 8_000e6);
    }

    function test_RevertCloseTwice() public {
        vm.warp(ws.closableAt());
        vm.startPrank(employer);
        ws.closeMilestone();
        vm.expectRevert(WorkStream.MilestoneAlreadyClosed.selector);
        ws.closeMilestone();
        vm.stopPrank();
    }

    /// A milestone that never started can be closed at once — there is no work
    /// in flight to protect.
    function test_UnstartedMilestoneClosesImmediately() public {
        WorkStream fresh = deploy(MAX_TRANCHE, DAILY_CAP);
        vm.prank(employer);
        fresh.closeMilestone();
        assertTrue(fresh.milestoneClosed());
    }

    /// Credit from a closed milestone must survive the next one opening — `cur`
    /// is overwritten, so anything owed has to have been crystallised out of it.
    function test_NewMilestoneDoesNotWipeOutEarlierCredit() public {
        vm.warp(start + DURATION);
        certifyOk(5_000);

        vm.warp(ws.closableAt());
        vm.startPrank(employer);
        ws.closeMilestone();
        ws.openMilestone("Milestone 2: the next thing", BUDGET, DURATION);
        vm.stopPrank();

        assertEq(ws.target(), 0, "the new milestone starts uncertified");
        assertEq(ws.earned(), 0);
        assertEq(ws.withdrawable(), 5_000e6, "but the old milestone is still owed");

        vm.prank(contributor);
        ws.withdraw(payee, 5_000e6);
        assertEq(usdc.balanceOf(payee), 5_000e6);
    }

    /// The invariant that matters most: everything the agent certifies is
    /// collectable, across a full milestone lifecycle.
    function test_EverythingCertifiedIsAlwaysCollectable() public {
        vm.warp(start + DURATION);
        certifyOk(10_000);

        uint256 owed = ws.withdrawable();
        assertEq(owed, BUDGET);

        vm.warp(ws.closableAt());
        vm.prank(employer);
        ws.closeMilestone();

        assertEq(ws.withdrawable(), owed, "closing changed nothing that was owed");
        vm.prank(contributor);
        ws.withdraw(payee, owed);
        assertEq(usdc.balanceOf(payee), BUDGET);
        assertEq(usdc.balanceOf(address(ws)), 0, "and the contract is empty");
    }

    // ====================================================== PAUSE AND RESUME

    function test_PauseStopsAccrualButNotCertification() public {
        vm.warp(start + 10_000); // accrued = 1,000
        vm.prank(employer);
        ws.pause();

        vm.warp(start + 50_000);
        assertEq(ws.accrued(), 1_000e6, "the clock is stopped");

        certifyOk(2_000); // still certifiable while paused
        assertEq(ws.target(), 2_000e6);
        assertEq(ws.earned(), 1_000e6, "metered by the frozen clock");

        vm.prank(employer);
        ws.resume();
        vm.warp(start + 60_000); // 10,000s more of live clock
        assertEq(ws.accrued(), 2_000e6);
        assertEq(ws.earned(), 2_000e6);
    }

    /// THE BUG THIS CLOSES: `pausedAt` belongs to a window opened under the old
    /// milestone. Carried into a new one it makes `accrued()` read from before
    /// that milestone even activated — permanently zero — while `resume()` adds
    /// the whole gap to `pausedSeconds`. The budget would be unreachable until
    /// close refunded it to the employer.
    function test_OpeningAMilestoneIsRefusedWhilePaused() public {
        vm.warp(start + DURATION);
        vm.startPrank(employer);
        ws.pause();
        vm.warp(ws.closableAt());
        ws.closeMilestone();

        vm.expectRevert(WorkStream.StreamIsPaused.selector);
        ws.openMilestone("Milestone 2", BUDGET, DURATION);

        // Resuming first is all that is required, and the new milestone then
        // accrues normally.
        ws.resume();
        ws.openMilestone("Milestone 2", BUDGET, DURATION);
        vm.stopPrank();

        fundFully(ws);
        uint64 s2 = ws.activatedAt();
        vm.warp(s2 + 10_000);
        assertEq(ws.accrued(), 1_000e6, "the new milestone accrues from its own activation");
    }

    function test_ResumeIgnoresPauseTimePastTheEnd() public {
        vm.warp(ws.milestoneEndsAt() + 1 days);
        vm.startPrank(employer);
        ws.pause();
        vm.warp(block.timestamp + 5 days);
        ws.resume();
        vm.stopPrank();

        assertEq(ws.accrued(), BUDGET, "accrual had already finished; pausing after cannot reduce it");
    }

    // =========================================================== WITHDRAW

    function test_RevertWithdrawToNonAllowlisted() public {
        vm.warp(start + DURATION);
        certifyOk(1_000);
        vm.prank(contributor);
        vm.expectRevert(WorkStream.PayeeNotAllowlisted.selector);
        ws.withdraw(makeAddr("attacker"), 1e6);
    }

    function test_RevertWithdrawByNonContributor() public {
        vm.warp(start + DURATION);
        certifyOk(1_000);
        vm.prank(employer);
        vm.expectRevert(WorkStream.NotContributor.selector);
        ws.withdraw(payee, 1e6);
    }

    function test_RevertWithdrawAboveWithdrawable() public {
        vm.warp(start + DURATION);
        certifyOk(1_000);
        vm.prank(contributor);
        vm.expectRevert(WorkStream.ExceedsWithdrawable.selector);
        ws.withdraw(payee, 1_000e6 + 1);
    }

    function test_PartialWithdrawalsAccumulate() public {
        vm.warp(start + DURATION);
        certifyOk(3_000);

        vm.startPrank(contributor);
        ws.withdraw(payee, 1_000e6);
        ws.withdraw(payee, 500e6);
        vm.stopPrank();

        assertEq(ws.withdrawn(), 1_500e6);
        assertEq(ws.withdrawable(), 1_500e6);
        assertEq(usdc.balanceOf(payee), 1_500e6);
    }

    // ==================================================== EMPLOYER GUARDS

    function test_EmployerOnlyGuards() public {
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.pause();
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.closeMilestone();
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.openMilestone("nope", BUDGET, DURATION);
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.setRepo("attacker/repo");
        vm.expectRevert(WorkStream.NotEmployer.selector);
        ws.fund(1);
        vm.stopPrank();
    }

    function test_SetRepo_EmployerOnly() public {
        vm.prank(employer);
        ws.setRepo("acme/other");
        assertEq(ws.repo(), "acme/other");
    }

    function test_OpenMilestoneRejectsZeroBudgetOrDuration() public {
        vm.warp(ws.closableAt());
        vm.startPrank(employer);
        ws.closeMilestone();
        vm.expectRevert(WorkStream.BadBudget.selector);
        ws.openMilestone("zero budget", 0, DURATION);
        vm.expectRevert(WorkStream.BadBudget.selector);
        ws.openMilestone("zero duration", BUDGET, 0);
        vm.stopPrank();
    }

    function test_RevertOpenWhileAnotherMilestoneIsRunning() public {
        vm.prank(employer);
        vm.expectRevert(WorkStream.MilestoneAlreadyOpen.selector);
        ws.openMilestone("too soon", BUDGET, DURATION);
    }

    function test_ConstructorRejectsZeroAddresses() public {
        vm.startPrank(employer);
        vm.expectRevert(WorkStream.ZeroAddress.selector);
        new WorkStream(
            IERC20(address(usdc)),
            address(0),
            agentAddr,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            WorkStream.Policy({maxTranche: MAX_TRANCHE, dailyUnlockCap: DAILY_CAP, payee: payee})
        );
        vm.expectRevert(WorkStream.ZeroAddress.selector);
        new WorkStream(
            IERC20(address(usdc)),
            contributor,
            agentAddr,
            M1,
            BUDGET,
            DURATION,
            "acme/widgets",
            WorkStream.Policy({maxTranche: MAX_TRANCHE, dailyUnlockCap: DAILY_CAP, payee: address(0)})
        );
        vm.stopPrank();
    }
}
