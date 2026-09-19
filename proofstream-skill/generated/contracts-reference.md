# WorkStream generated reference

Generated from the Foundry artifact at ProofStream commit `92b5e741947a73dc95f673adc8ff2431b7615aa1`. Regenerate with `pnpm --filter proofstream-integration-skill generate`.

## Functions

- `ATTESTATION_TTL()` - view; returns uint256
- `ATTESTATION_TYPEHASH()` - view; returns bytes32
- `CLAIM_TYPEHASH()` - view; returns bytes32
- `CLOSE_GRACE()` - view; returns uint256
- `DOMAIN_SEPARATOR()` - view; returns bytes32
- `MAX_AUTHORS()` - view; returns uint256
- `PAYEE_BINDING_TYPEHASH()` - view; returns bytes32
- `accrued()` - view; returns uint256
- `activatedAt()` - view; returns uint64
- `agent()` - view; returns address
- `authors()` - view; returns string[]
- `bindPayee(bytes32 earnerId, address payee_, uint256 deadline, bytes signature)` - nonpayable; returns nothing
- `budget()` - view; returns uint256
- `certifiedBps()` - view; returns uint256
- `certify(tuple a, bytes signature)` - nonpayable; returns nothing
- `claim(bytes signature)` - nonpayable; returns nothing
- `claimAuthority()` - view; returns address
- `claimDayBucket()` - view; returns uint256
- `claimedToday()` - view; returns uint256
- `closableAt()` - view; returns uint256
- `closeMilestone()` - nonpayable; returns nothing
- `closedBps(uint256)` - view; returns uint256
- `closedTarget(uint256)` - view; returns uint256
- `contributor()` - view; returns address
- `creditBps(uint256, bytes32)` - view; returns uint256
- `dayBucket()` - view; returns uint256
- `duration()` - view; returns uint256
- `earned()` - view; returns uint256
- `earnerShare(uint256 m, bytes32 earnerId)` - view; returns uint256
- `earnerWithdrawable(uint256 m, bytes32 earnerId)` - view; returns uint256
- `employer()` - view; returns address
- `fullyFunded()` - view; returns bool
- `fund(uint256 amount)` - nonpayable; returns nothing
- `funded()` - view; returns uint256
- `isActive()` - view; returns bool
- `isPublic()` - view; returns bool
- `milestone()` - view; returns string
- `milestoneClosed()` - view; returns bool
- `milestoneEndsAt()` - view; returns uint256
- `milestoneHash()` - view; returns bytes32
- `milestoneIndex()` - view; returns uint256
- `nonce()` - view; returns uint256
- `openMilestone(string text, uint256 newBudget, uint256 newDuration)` - nonpayable; returns nothing
- `paidTo(uint256, bytes32)` - view; returns uint256
- `pause()` - nonpayable; returns nothing
- `paused()` - view; returns bool
- `pausedAt()` - view; returns uint64
- `pausedSeconds()` - view; returns uint256
- `payeeOf(bytes32)` - view; returns address
- `policy()` - view; returns uint256, uint256, address, uint256, uint256
- `raisePolicy(uint256 newMaxTranche, uint256 newDailyUnlockCap)` - nonpayable; returns nothing
- `repo()` - view; returns string
- `resume()` - nonpayable; returns nothing
- `setAuthors(string[] newAuthors)` - nonpayable; returns nothing
- `setClaimAuthority(address newAuthority)` - nonpayable; returns nothing
- `setRepo(string newRepo)` - nonpayable; returns nothing
- `settledCredit()` - view; returns uint256
- `target()` - view; returns uint256
- `unlockedToday()` - view; returns uint256
- `usdc()` - view; returns address
- `version()` - pure; returns uint256
- `withdraw(address to, uint256 amount)` - nonpayable; returns nothing
- `withdrawFor(uint256 m, bytes32 earnerId, uint256 amount)` - nonpayable; returns nothing
- `withdrawable()` - view; returns uint256
- `withdrawn()` - view; returns uint256

## Events

- `AuthorsSet(string[] authors)`
- `ClaimAuthoritySet(address authority)`
- `Claimed(address contributor)`
- `EarnerCredited(uint256 milestone, bytes32 earnerId, uint256 addedBps, uint256 totalBps)`
- `Funded(address from, uint256 amount, uint256 milestoneFunded)`
- `MilestoneActivated(uint256 index, uint64 at, uint256 budget)`
- `MilestoneCertified(uint256 nonce, uint256 prNumber, string commitSha, uint256 confidenceBps, uint256 certifiedBps, uint256 addedTarget)`
- `MilestoneClosed(uint256 index, uint256 creditedToContributor, uint256 returned)`
- `MilestoneOpened(uint256 index, bytes32 hash, string text, uint256 budget, uint256 duration)`
- `PaidOut(uint256 milestone, bytes32 earnerId, address to, uint256 amount)`
- `PayeeBound(bytes32 earnerId, address payee)`
- `PolicyRaised(uint256 maxTranche, uint256 dailyUnlockCap)`
- `Reclaimed(uint256 amount)`
- `RepoSet(string repo)`
- `StreamPaused(uint64 at)`
- `StreamResumed(uint64 at)`
- `Withdrawn(address payee, uint256 amount)`

## Custom errors

- `AlreadyBound()`
- `AlreadyClaimed()`
- `AlreadyPaused()`
- `BadBudget()`
- `BadCapPair()`
- `BadCertification()`
- `BadClaimSignature()`
- `BadNonce()`
- `CapCannotStrandTheBudget()`
- `CapsMayOnlyRise()`
- `DailyCapExceeded()`
- `DailyClaimCapExceeded()`
- `EarnerOnNamedStream()`
- `ExceedsWithdrawable()`
- `FutureAttestation()`
- `MilestoneAlreadyClosed()`
- `MilestoneAlreadyOpen()`
- `MilestoneMismatch()`
- `MilestoneNotFunded()`
- `MilestoneStillRunning()`
- `NoEarner()`
- `NotAnIncrease()`
- `NotClaimable()`
- `NotContributor()`
- `NotEmployer()`
- `NotPaused()`
- `NotPayee()`
- `NotPublic()`
- `OverClaimCap()`
- `OverMaxTranche()`
- `PayeeNotAllowlisted()`
- `RepoLocked()`
- `StaleAttestation()`
- `StaleBinding()`
- `StreamIsPaused()`
- `TooManyAuthors()`
- `TransferFailed()`
- `WrongSigner()`
- `ZeroAddress()`

# StreamRegistry generated reference

Generated from the Foundry artifact at ProofStream commit `92b5e741947a73dc95f673adc8ff2431b7615aa1`. Regenerate with `pnpm --filter proofstream-integration-skill generate`.

## Functions

- `register(address stream)` - nonpayable; returns nothing

## Events

- `StreamRegistered(address stream, address employer, address agent, string repo)`

## Custom errors

- `NotStreamEmployer()`
- `ZeroAddress()`
