// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title WorkStream — USDC payroll stream unlocked by agent attestations
/// @notice Pay accrues per second but stays locked until the attestor agent
///         signs an EIP-712 attestation that the current milestone was
///         satisfied. The agent is a single trusted key (see README "Known
///         limitations"), so the on-chain Policy bounds what a compromised key
///         can drain: at most `maxTranche` per unlock and `dailyUnlockCap` per
///         UTC day, withdrawable only to the allowlisted payee.
///
/// @dev Money model, and why it is shaped this way:
///
///      A milestone carries its OWN budget and duration. It does not begin
///      until the employer has deposited that budget in full — until then
///      nothing accrues and no work is expected. That single rule is what stops
///      an employer taking completed work against a promise they never funded:
///      the contributor checks one boolean before starting, and an underfunded
///      job can only ever fail to start, never strand work already done.
///
///      Accrual is `budget × elapsed / duration`, computed fresh each call. No
///      per-second rate is stored, so "3,000 over 30 days" accrues to exactly
///      3,000 with no rounding dust, and the employer never has to reason about
///      a per-second number.
///
///      Because a milestone is fully funded before it starts, every tranche the
///      agent certifies is already backed by USDC in the contract and
///      `withdraw` can never fail for lack of funds. The full tranche is
///      credited to the contributor — the contract takes no cut.
///
/// @dev All token amounts are 6-decimal ERC-20 USDC units.
contract WorkStream {
    // ---------------------------------------------------------------- actors
    IERC20 public immutable usdc;
    address public immutable employer;
    address public immutable contributor;
    address public immutable agent; // attestor key that signs unlocks

    // ------------------------------------------------------------- milestone

    /// @param text        what the agent judges work against
    /// @param hash        keccak256(text), bound into every attestation
    /// @param budget      USDC committed to THIS milestone
    /// @param duration    seconds the budget accrues over, once active
    /// @param funded      deposited so far toward `budget`
    /// @param activatedAt when the budget was met; 0 means not started
    /// @param unlocked    released from this milestone
    /// @param closed      employer has settled it; a new one may open
    struct Milestone {
        string text;
        bytes32 hash;
        uint256 budget;
        uint256 duration;
        uint256 funded;
        uint64 activatedAt;
        uint256 unlocked;
        bool closed;
    }

    Milestone internal cur;

    /// @notice 1-based counter of milestones opened over the stream's life.
    uint256 public milestoneIndex;

    /// @notice The repository the agent must watch for this stream, e.g.
    ///         "acme/widgets". Registered on-chain by the employer rather than
    ///         configured in the agent, because every job brings its own repo:
    ///         one agent serves many streams, and it must be told what to watch
    ///         by the contract it is being paid to enforce.
    string public repo;

    bool public paused;
    uint64 public pausedAt; // start of the current pause window
    uint256 public pausedSeconds; // completed pause time in this milestone

    // ------------------------------------------------------------ accounting
    uint256 public unlocked; // cumulative over the stream's life
    uint256 public contributorCredited; // cumulative contributor share
    uint256 public withdrawn; // paid out to the allowlisted payee
    uint256 public nonce; // next expected attestation nonce

    // ----------------------------------------------------------- policy (T1)
    struct Policy {
        uint256 maxTranche; // per-unlock ceiling
        uint256 dailyUnlockCap; // per-UTC-day ceiling
        address payee; // only address withdraw may pay
    }

    Policy public policy;
    uint256 public dayBucket; // block.timestamp / 1 days of last unlock
    uint256 public unlockedToday;

    // ---------------------------------------------------------------- consts
    //
    // There is deliberately NO vault split. An earlier version diverted 15% of
    // every tranche to an address the employer chose at construction, under the
    // name "vesting vault" — but nothing vested: no schedule, no cliff, and no
    // way for the contributor ever to claim it. It was a withholding the
    // employer could point at themselves, sitting inside a contract whose whole
    // purpose is that the rules, not the counterparty, decide where money goes.
    // Everything the agent certifies is now the contributor's.
    uint256 public constant ATTESTATION_TTL = 15 minutes;

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(uint256 nonce,uint256 tranche,uint256 prNumber,string commitSha,uint256 confidenceBps,uint256 issuedAt,bytes32 milestoneHash)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    struct Attestation {
        uint256 nonce;
        uint256 tranche; // 6-dp USDC to unlock
        uint256 prNumber;
        string commitSha;
        uint256 confidenceBps;
        uint256 issuedAt;
        bytes32 milestoneHash; // binds the verdict to the milestone judged
    }

    // ---------------------------------------------------------------- events
    event Funded(address indexed from, uint256 amount, uint256 milestoneFunded);
    event MilestoneOpened(uint256 indexed index, bytes32 indexed hash, string text, uint256 budget, uint256 duration);
    event MilestoneActivated(uint256 indexed index, uint64 at, uint256 budget);
    event MilestoneClosed(uint256 indexed index, uint256 unlockedFromMilestone, uint256 returned);
    event TrancheUnlocked(
        uint256 indexed nonce,
        uint256 indexed prNumber,
        string commitSha,
        uint256 confidenceBps,
        uint256 tranche
    );
    event Withdrawn(address indexed payee, uint256 amount);
    event StreamPaused(uint64 at);
    event StreamResumed(uint64 at);
    event Reclaimed(uint256 amount);
    event RepoSet(string repo);

    // ---------------------------------------------------------------- errors
    error NotEmployer();
    error NotContributor();
    error AlreadyPaused();
    error NotPaused();
    error BadNonce();
    error StaleAttestation();
    error FutureAttestation();
    error WrongSigner();
    error OverMaxTranche();
    error DailyCapExceeded();
    error ExceedsAccrued();
    error MilestoneMismatch();
    error PayeeNotAllowlisted();
    error ExceedsWithdrawable();
    error TransferFailed();
    error ZeroAddress();
    error BadBudget();
    error MilestoneNotFunded();
    error MilestoneStillRunning();
    error MilestoneNotClosed();
    error MilestoneAlreadyOpen();

    constructor(
        IERC20 _usdc,
        address _contributor,
        address _agent,
        string memory _milestone,
        uint256 _budget,
        uint256 _duration,
        string memory _repo,
        Policy memory _policy
    ) {
        if (_contributor == address(0) || _agent == address(0) || _policy.payee == address(0)) {
            revert ZeroAddress();
        }

        usdc = _usdc;
        employer = msg.sender;
        contributor = _contributor;
        agent = _agent;
        repo = _repo;
        policy = _policy;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ProofStream"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );

        _openMilestone(_milestone, _budget, _duration);
    }

    // ---------------------------------------------------------------- views

    /// @notice What the agent judges work against.
    function milestone() external view returns (string memory) {
        return cur.text;
    }

    /// @notice keccak256 of the milestone text, bound into every attestation.
    function milestoneHash() external view returns (bytes32) {
        return cur.hash;
    }

    /// @notice USDC committed to the current milestone.
    function budget() external view returns (uint256) {
        return cur.budget;
    }

    /// @notice Seconds the current milestone's budget accrues over.
    function duration() external view returns (uint256) {
        return cur.duration;
    }

    /// @notice Deposited so far toward the current milestone's budget.
    function funded() external view returns (uint256) {
        return cur.funded;
    }

    /// @notice When the current milestone started; 0 means it has not.
    function activatedAt() external view returns (uint64) {
        return cur.activatedAt;
    }

    /// @notice Released from the current milestone.
    function milestoneUnlocked() external view returns (uint256) {
        return cur.unlocked;
    }

    /// @notice Whether the current milestone has been settled.
    function milestoneClosed() external view returns (bool) {
        return cur.closed;
    }

    /// @notice THE CHECK A CONTRIBUTOR MAKES BEFORE STARTING WORK. True only
    ///         when the employer has deposited the whole milestone budget.
    function fullyFunded() public view returns (bool) {
        return cur.funded >= cur.budget;
    }

    /// @notice Accruing right now: funded, started, not closed.
    function isActive() public view returns (bool) {
        return cur.activatedAt != 0 && !cur.closed;
    }

    /// @notice When the current milestone stops accruing. 0 if not started.
    function milestoneEndsAt() public view returns (uint256) {
        return cur.activatedAt == 0 ? 0 : uint256(cur.activatedAt) + cur.duration;
    }

    /// @notice USDC earned so far on the current milestone:
    ///         `budget × elapsed / duration`, excluding paused time and
    ///         stopping at the milestone's end. Exact at the end — no dust.
    function accrued() public view returns (uint256) {
        if (cur.activatedAt == 0 || cur.duration == 0) return 0;

        uint256 endsAt = milestoneEndsAt();
        uint256 upTo = paused ? pausedAt : block.timestamp;
        if (upTo > endsAt) upTo = endsAt;
        if (upTo <= cur.activatedAt) return 0;

        uint256 elapsed = upTo - cur.activatedAt;
        if (elapsed <= pausedSeconds) return 0;
        elapsed -= pausedSeconds;
        if (elapsed > cur.duration) elapsed = cur.duration;

        uint256 byClock = (cur.budget * elapsed) / cur.duration;
        // Belt and braces: activation already guarantees funded >= budget, so
        // this only ever binds on a partially funded milestone.
        return byClock > cur.funded ? cur.funded : byClock;
    }

    /// @notice Contributor share unlocked but not yet withdrawn.
    function withdrawable() public view returns (uint256) {
        return contributorCredited - withdrawn;
    }

    // ------------------------------------------------------------- mutations

    /// @notice Deposit toward the current milestone's budget. The milestone
    ///         activates automatically the moment the budget is met — that is
    ///         the anti-rug gate, so funding is not a formality.
    function fund(uint256 amount) external {
        if (msg.sender != employer) revert NotEmployer();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        cur.funded += amount;
        emit Funded(msg.sender, amount, cur.funded);

        if (cur.activatedAt == 0 && fullyFunded()) {
            cur.activatedAt = uint64(block.timestamp);
            pausedSeconds = 0;
            emit MilestoneActivated(milestoneIndex, cur.activatedAt, cur.budget);
        }
    }

    /// @notice Open the next milestone with its own budget and duration. It
    ///         will not start accruing until `fund` covers that budget.
    function openMilestone(string calldata text, uint256 newBudget, uint256 newDuration) external {
        if (msg.sender != employer) revert NotEmployer();
        if (!cur.closed) revert MilestoneAlreadyOpen();
        _openMilestone(text, newBudget, newDuration);
    }

    /// @notice Settle the current milestone so the next can open, and release
    ///         whatever it never paid out back to the employer.
    /// @dev Only once the milestone has run its course, or if it never started.
    ///      Otherwise an employer could close mid-work and reclaim money the
    ///      contributor had already earned but the agent had not yet certified.
    function closeMilestone() external {
        if (msg.sender != employer) revert NotEmployer();
        if (cur.closed) revert MilestoneNotClosed();
        if (cur.activatedAt != 0 && block.timestamp < milestoneEndsAt()) revert MilestoneStillRunning();

        cur.closed = true;

        // Everything not owed to the contributor goes home.
        uint256 held = usdc.balanceOf(address(this));
        uint256 owed = withdrawable();
        uint256 refund = held > owed ? held - owed : 0;
        if (refund > 0 && !usdc.transfer(employer, refund)) revert TransferFailed();

        emit MilestoneClosed(milestoneIndex, cur.unlocked, refund);
        emit Reclaimed(refund);
    }

    /// @notice Unlock a tranche against a signed agent attestation. Callable
    ///         by anyone carrying a valid signature; in practice the agent
    ///         sends it from its own wallet and pays its own gas.
    /// @dev Deliberately NOT blocked while paused. Pause stops the clock, so no
    ///      new money is earned — but work already earned must stay certifiable,
    ///      otherwise an employer could watch work land, pause, and freeze the
    ///      agent out of releasing pay the contributor had already earned.
    function unlock(Attestation calldata a, bytes calldata signature) external {
        if (cur.activatedAt == 0) revert MilestoneNotFunded();
        if (a.nonce != nonce) revert BadNonce();
        if (a.issuedAt > block.timestamp) revert FutureAttestation();
        if (block.timestamp > a.issuedAt + ATTESTATION_TTL) revert StaleAttestation();
        if (a.milestoneHash != cur.hash) revert MilestoneMismatch();
        if (a.tranche > policy.maxTranche) revert OverMaxTranche();

        uint256 today = block.timestamp / 1 days;
        if (today != dayBucket) {
            dayBucket = today;
            unlockedToday = 0;
        }
        if (unlockedToday + a.tranche > policy.dailyUnlockCap) revert DailyCapExceeded();

        // Against THIS milestone's accrual, not the stream's lifetime total.
        if (cur.unlocked + a.tranche > accrued()) revert ExceedsAccrued();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        ATTESTATION_TYPEHASH,
                        a.nonce,
                        a.tranche,
                        a.prNumber,
                        keccak256(bytes(a.commitSha)),
                        a.confidenceBps,
                        a.issuedAt,
                        a.milestoneHash
                    )
                )
            )
        );
        address signer = recover(digest, signature);
        if (signer != agent) revert WrongSigner();

        nonce = a.nonce + 1;
        unlockedToday += a.tranche;
        unlocked += a.tranche;
        cur.unlocked += a.tranche;

        // The whole tranche is the contributor's. Nothing is skimmed.
        contributorCredited += a.tranche;

        emit TrancheUnlocked(a.nonce, a.prNumber, a.commitSha, a.confidenceBps, a.tranche);
    }

    /// @notice Pay out unlocked funds. Only the contributor may call, and only
    ///         to the policy's allowlisted payee (T1/T6 blast-radius bound).
    function withdraw(address to, uint256 amount) external {
        if (msg.sender != contributor) revert NotContributor();
        if (to != policy.payee) revert PayeeNotAllowlisted();
        if (amount > withdrawable()) revert ExceedsWithdrawable();
        withdrawn += amount;
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    /// @notice Employer stops the clock (stop shipping → money pauses itself).
    ///         Certification of already-earned work continues; see `unlock`.
    function pause() external {
        if (msg.sender != employer) revert NotEmployer();
        if (paused) revert AlreadyPaused();
        paused = true;
        pausedAt = uint64(block.timestamp);
        emit StreamPaused(uint64(block.timestamp));
    }

    function resume() external {
        if (msg.sender != employer) revert NotEmployer();
        if (!paused) revert NotPaused();
        // Pause time past the milestone's end does not count: accrual had
        // already stopped.
        uint256 endsAt = milestoneEndsAt();
        uint256 windowEnd = block.timestamp;
        if (endsAt != 0 && windowEnd > endsAt) windowEnd = endsAt;
        if (windowEnd > pausedAt) pausedSeconds += windowEnd - pausedAt;
        paused = false;
        pausedAt = 0;
        emit StreamResumed(uint64(block.timestamp));
    }

    /// @notice Point the agent at a different repository for this job.
    function setRepo(string calldata newRepo) external {
        if (msg.sender != employer) revert NotEmployer();
        repo = newRepo;
        emit RepoSet(newRepo);
    }

    // ------------------------------------------------------------- internals

    function _openMilestone(string memory text, uint256 newBudget, uint256 newDuration) internal {
        if (newBudget == 0 || newDuration == 0) revert BadBudget();

        milestoneIndex += 1;
        cur = Milestone({
            text: text,
            hash: keccak256(bytes(text)),
            budget: newBudget,
            duration: newDuration,
            funded: 0,
            activatedAt: 0,
            unlocked: 0,
            closed: false
        });
        pausedSeconds = 0;

        emit MilestoneOpened(milestoneIndex, cur.hash, text, newBudget, newDuration);
    }

    function recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        return ecrecover(digest, v, r, s);
    }
}
