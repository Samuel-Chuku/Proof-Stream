# WorkStream generated reference

Generated from the Foundry artifact at ProofStream commit `ce754c1a6c56ad65657b9482ffca9aa96ee8cfad`. Regenerate with `pnpm --filter proofstream-integration-skill generate`.

## Functions

- `ATTESTATION_TTL()` - view; returns uint256
- `ATTESTATION_TYPEHASH()` - view; returns bytes32
- `CLOSE_GRACE()` - view; returns uint256
- `DOMAIN_SEPARATOR()` - view; returns bytes32
- `accrued()` - view; returns uint256
- `activatedAt()` - view; returns uint64
- `agent()` - view; returns address
- `budget()` - view; returns uint256
- `certifiedBps()` - view; returns uint256
- `certify(tuple a, bytes signature)` - nonpayable; returns nothing
- `closableAt()` - view; returns uint256
- `closeMilestone()` - nonpayable; returns nothing
- `contributor()` - view; returns address
- `dayBucket()` - view; returns uint256
- `duration()` - view; returns uint256
- `earned()` - view; returns uint256
- `employer()` - view; returns address
- `fullyFunded()` - view; returns bool
- `fund(uint256 amount)` - nonpayable; returns nothing
- `funded()` - view; returns uint256
- `isActive()` - view; returns bool
- `milestone()` - view; returns string
- `milestoneClosed()` - view; returns bool
- `milestoneEndsAt()` - view; returns uint256
- `milestoneHash()` - view; returns bytes32
- `milestoneIndex()` - view; returns uint256
- `nonce()` - view; returns uint256
- `openMilestone(string text, uint256 newBudget, uint256 newDuration)` - nonpayable; returns nothing
- `pause()` - nonpayable; returns nothing
- `paused()` - view; returns bool
- `pausedAt()` - view; returns uint64
- `pausedSeconds()` - view; returns uint256
- `policy()` - view; returns uint256, uint256, address
- `raisePolicy(uint256 newMaxTranche, uint256 newDailyUnlockCap)` - nonpayable; returns nothing
- `repo()` - view; returns string
- `resume()` - nonpayable; returns nothing
- `setRepo(string newRepo)` - nonpayable; returns nothing
- `settledCredit()` - view; returns uint256
- `target()` - view; returns uint256
- `unlockedToday()` - view; returns uint256
- `usdc()` - view; returns address
- `withdraw(address to, uint256 amount)` - nonpayable; returns nothing
- `withdrawable()` - view; returns uint256
- `withdrawn()` - view; returns uint256

## Events

- `Funded(address from, uint256 amount, uint256 milestoneFunded)`
- `MilestoneActivated(uint256 index, uint64 at, uint256 budget)`
- `MilestoneCertified(uint256 nonce, uint256 prNumber, string commitSha, uint256 confidenceBps, uint256 certifiedBps, uint256 addedTarget)`
- `MilestoneClosed(uint256 index, uint256 creditedToContributor, uint256 returned)`
- `MilestoneOpened(uint256 index, bytes32 hash, string text, uint256 budget, uint256 duration)`
- `PolicyRaised(uint256 maxTranche, uint256 dailyUnlockCap)`
- `Reclaimed(uint256 amount)`
- `RepoSet(string repo)`
- `StreamPaused(uint64 at)`
- `StreamResumed(uint64 at)`
- `Withdrawn(address payee, uint256 amount)`

## Custom errors

- `AlreadyPaused()`
- `BadBudget()`
- `BadCertification()`
- `BadNonce()`
- `CapsMayOnlyRise()`
- `DailyCapExceeded()`
- `ExceedsWithdrawable()`
- `FutureAttestation()`
- `MilestoneAlreadyClosed()`
- `MilestoneAlreadyOpen()`
- `MilestoneMismatch()`
- `MilestoneNotFunded()`
- `MilestoneStillRunning()`
- `NotAnIncrease()`
- `NotContributor()`
- `NotEmployer()`
- `NotPaused()`
- `OverMaxTranche()`
- `PayeeNotAllowlisted()`
- `StaleAttestation()`
- `StreamIsPaused()`
- `TransferFailed()`
- `WrongSigner()`
- `ZeroAddress()`

# StreamRegistry generated reference

Generated from the Foundry artifact at ProofStream commit `ce754c1a6c56ad65657b9482ffca9aa96ee8cfad`. Regenerate with `pnpm --filter proofstream-integration-skill generate`.

## Functions

- `register(address stream)` - nonpayable; returns nothing

## Events

- `StreamRegistered(address stream, address employer, address agent, string repo)`

## Custom errors

- `NotStreamEmployer()`
- `ZeroAddress()`
