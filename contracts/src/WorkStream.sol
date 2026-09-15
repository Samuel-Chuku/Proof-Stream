// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title WorkStream — USDC payroll stream released by agent certification
/// @notice Pay accrues per second but stays locked until the attestor agent
///         signs an EIP-712 attestation certifying how much of the current
///         milestone the work actually satisfies. The agent is a single trusted
///         key (see README "Known limitations"), so the on-chain Policy bounds
///         what a compromised key can create: at most `maxTranche` of new
///         entitlement per attestation and `dailyUnlockCap` per UTC day,
///         withdrawable only to the allowlisted payee.
///
/// @dev THE MONEY MODEL, and why it is shaped this way.
///
///      Two independent quantities decide what a contributor may take, and
///      keeping them separate is the whole design:
///
///        target()  = budget × certifiedBps / 10_000   <- THE AGENT decides this
///        earned()  = min(accrued(), target())         <- THE CLOCK meters it
///
///      The agent owns *what was earned*. The clock owns *when it arrives*.
///      Neither can override the other, and that is deliberate:
///
///        - `certifiedBps` is monotonic, so a later judgment can raise a
///          contributor's claim but never lower it. Every merged PR can move it
///          closer to the full amount.
///        - Because `earned()` is recomputed on every read rather than being a
///          payment the agent must keep making, ONE certification keeps paying
///          out as the stream runs. A contributor who finishes the milestone
///          never has to merge again to collect — which the previous design
///          required, and which pushed contributors toward padding work.
///        - Time alone pays nothing. `certifiedBps == 0` makes `target()` zero,
///          so an unjudged stream releases nothing however long it runs.
///
///      ONE EXCEPTION, and it is the only place certification touches the clock:
///      at 100% the schedule is over. A milestone is a unit of work at a price;
///      partial delivery does not end the engagement, so the schedule still
///      governs, but complete delivery leaves nothing to stream toward and
///      withholding becomes pure delay. `earned()` therefore returns the full
///      target once `certifiedBps` reaches 10_000.
///
///      Note this is the only coherent place to put that exception. Pulling the
///      clock forward on PARTIAL certification would make `accrued() >= target()`
///      at every certification, collapsing `min()` into `target()` — the clock
///      would stop affecting payout at all and the stream would be decorative.
///
///      A milestone carries its own budget and duration and does not begin until
///      the employer has deposited that budget IN FULL. That single rule is what
///      stops an employer taking completed work against a promise they never
///      funded: the contributor checks one boolean before starting, and an
///      underfunded job can only ever fail to start, never strand work already
///      done.
///
///      Accrual is `budget × elapsed / duration`, computed fresh each call. No
///      per-second rate is stored, so "3,000 over 30 days" accrues to exactly
///      3,000 with no rounding dust.
///
///      CLOSING CRYSTALLISES `target()`, NOT `earned()`. The contributor always
///      ends up with exactly what the agent certified; the stream only decides
///      how early they get it. This is what stops `pause` and `closeMilestone`
///      being used to strand certified work — the worst either can do is delay
///      payment to the deadline, never reduce it.
///
/// @dev All token amounts are 6-decimal ERC-20 USDC units.
contract WorkStream {
    // ---------------------------------------------------------------- actors
    IERC20 public immutable usdc;
    address public immutable employer;
    /// @notice Who the work is for. Set at construction for a named stream, or
    ///         bound once by `claim` for a stream shared as a link.
    /// @dev NO LONGER IMMUTABLE. An employer who knows someone's email but not
    ///      their wallet cannot name them at deploy, so the address is bound
    ///      later. Exactly one of `contributor` and `claimAuthority` is set at
    ///      construction, and `claim` is the only thing that can ever move this.
    address public contributor;

    /// @notice The GitHub logins whose merges count for this stream. Empty
    ///         means any author, which is how every stream behaved before this
    ///         existed.
    /// @dev THE CONTRACT NEVER READS THIS. It cannot: it has no view of GitHub.
    ///      The agent compares it against a merged pull request's author, so the
    ///      field is inert until that check exists.
    ///
    ///      An allowlist rather than one login, because a person routinely has a
    ///      personal and a work account and a stream should not stop paying
    ///      because they pushed from the wrong one.
    ///
    ///      Why this is not smuggled into `repo` the way the branch was: that
    ///      encoding was justified once by a deadline, and twice is a smell.
    string[] private _authors;

    /// @notice The one-time key that authorises a claim, or zero for a stream
    ///         whose contributor was named at deploy.
    /// @dev Only the ADDRESS lives here. The private key lives in the link the
    ///      employer sends and nowhere else.
    address public claimAuthority;
    address public immutable agent; // attestor key that signs certifications

    // ------------------------------------------------------------- milestone

    /// @param text         what the agent judges work against
    /// @param hash         keccak256(text), bound into every attestation
    /// @param budget       USDC committed to THIS milestone
    /// @param duration     seconds the budget accrues over, once active
    /// @param funded       deposited so far toward `budget`
    /// @param activatedAt  when the budget was met; 0 means not started
    /// @param certifiedBps the agent's verdict: how much of this milestone the
    ///                     work satisfies, 0-10_000. Monotonic.
    /// @param closed       employer has settled it; a new one may open
    struct Milestone {
        string text;
        bytes32 hash;
        uint256 budget;
        uint256 duration;
        uint256 funded;
        uint64 activatedAt;
        uint256 certifiedBps;
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

    /// @notice Credit carried over from milestones already closed. Closing
    ///         crystallises `target()` into here, so a new milestone can never
    ///         wipe out what a previous one still owed.
    uint256 public settledCredit;

    /// @notice Paid out to the allowlisted payee, over the stream's life.
    uint256 public withdrawn;

    /// @notice Next expected attestation nonce.
    uint256 public nonce;

    uint256 internal constant BPS = 10_000;

    // ----------------------------------------------------------- policy (T1)
    struct Policy {
        uint256 maxTranche; // ceiling on new entitlement per attestation
        uint256 dailyUnlockCap; // ceiling on new entitlement per UTC day
        address payee; // only address withdraw may pay
        // PUBLIC MODE ONLY. Bound what one payout and one UTC day may move,
        // mirroring the two above on certification. Zero on a named or
        // claimable stream, and MUST be non-zero on a public one: that is what
        // makes "nobody named" a deliberate choice rather than an omission.
        uint256 claimCap;
        uint256 dailyClaimCap;
    }

    Policy public policy;
    uint256 public dayBucket; // block.timestamp / 1 days of last certification
    uint256 public unlockedToday; // entitlement created in that day

    // ------------------------------------------------------- public mode
    //
    // Two facts recorded at two times. WHO EARNED IT is written by certify()
    // as a share of the milestone. WHO GETS PAID is written once by
    // bindPayee(), later, when the earner chooses. Nothing below is reachable
    // on a named or claimable stream.

    /// milestone index -> earner -> bps of that milestone credited to them.
    /// Sums to `cur.certifiedBps` while the milestone is open.
    mapping(uint256 => mapping(bytes32 => uint256)) public creditBps;
    /// milestone index -> earner -> USDC already paid out to them.
    mapping(uint256 => mapping(bytes32 => uint256)) public paidTo;
    /// earner -> the one address they may ever be paid to. Stream-wide: an
    /// earner is a person, and their wallet does not change per milestone.
    mapping(bytes32 => address) public payeeOf;
    /// Snapshots at close. The next milestone overwrites `cur`, and a share is
    /// a fraction of a total that has to keep existing.
    mapping(uint256 => uint256) public closedTarget;
    mapping(uint256 => uint256) public closedBps;
    uint256 public claimDayBucket;
    uint256 public claimedToday;

    // ---------------------------------------------------------------- consts
    //
    // There is deliberately NO vault split. An earlier version diverted 15% of
    // every tranche to an address the employer chose at construction, under the
    // name "vesting vault" — but nothing vested: no schedule, no cliff, and no
    // way for the contributor ever to claim it. Everything certified is the
    // contributor's.
    uint256 public constant ATTESTATION_TTL = 15 minutes;

    /// @notice What a claim signature commits to.
    /// @dev The claimer's own address, and nothing else. That is the whole
    ///      defence: a signature lifted from the mempool authorises the person
    ///      it was made for and is worthless to anyone else. The domain
    ///      separator already binds the stream, so a key reused across streams
    ///      by mistake still cannot claim the wrong one.
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address claimer)");

    /// @notice How many GitHub accounts one stream may name.
    /// @dev Bounded because the AGENT reads this list on every judgment. An
    ///      unbounded list would let an employer make their own stream expensive
    ///      to serve. Sixteen is far more than the "personal plus work account"
    ///      case this exists for.
    uint256 public constant MAX_AUTHORS = 16;

    /// @notice How long after a milestone ends the employer must wait before
    ///         closing it. Judging a diff, buying a second opinion, signing and
    ///         landing a transaction all take real time, so work merged just
    ///         before the deadline is still being certified when the deadline
    ///         passes. Without this window an employer could close one second
    ///         after the end and refund work that was moments from being
    ///         certified. The agent enforces the same window off-chain for
    ///         routing; this is what makes it a guarantee rather than a setting.
    uint256 public constant CLOSE_GRACE = 4 hours;

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(uint256 nonce,uint256 certifiedBps,uint256 prNumber,string commitSha,uint256 confidenceBps,uint256 issuedAt,bytes32 milestoneHash,bytes32 earnerId)"
    );
    bytes32 public constant PAYEE_BINDING_TYPEHASH =
        keccak256("PayeeBinding(bytes32 earnerId,address payee,uint256 deadline)");
    bytes32 public immutable DOMAIN_SEPARATOR;

    struct Attestation {
        uint256 nonce;
        uint256 certifiedBps; // how much of the milestone the work satisfies
        uint256 prNumber;
        string commitSha;
        uint256 confidenceBps;
        uint256 issuedAt;
        bytes32 milestoneHash; // binds the verdict to the milestone judged
        // WHO EARNED IT, opaque to the contract. The agent hashes a
        // platform-namespaced identity ("github:12345") so nothing here knows
        // or cares which platform. Zero on a named or claimable stream.
        bytes32 earnerId;
    }

    // ---------------------------------------------------------------- events
    event Funded(address indexed from, uint256 amount, uint256 milestoneFunded);
    event MilestoneOpened(uint256 indexed index, bytes32 indexed hash, string text, uint256 budget, uint256 duration);
    event MilestoneActivated(uint256 indexed index, uint64 at, uint256 budget);
    event MilestoneClosed(uint256 indexed index, uint256 creditedToContributor, uint256 returned);
    /// @param certifiedBps the agent's new cumulative verdict for the milestone
    /// @param addedTarget   USDC of entitlement this attestation created
    event MilestoneCertified(
        uint256 indexed nonce,
        uint256 indexed prNumber,
        string commitSha,
        uint256 confidenceBps,
        uint256 certifiedBps,
        uint256 addedTarget
    );
    event Withdrawn(address indexed payee, uint256 amount);
    event StreamPaused(uint64 at);
    event StreamResumed(uint64 at);
    event Reclaimed(uint256 amount);
    event RepoSet(string repo);
    event Claimed(address indexed contributor);
    event ClaimAuthoritySet(address indexed authority);
    event AuthorsSet(string[] authors);
    event PolicyRaised(uint256 maxTranche, uint256 dailyUnlockCap);
    event PayeeBound(bytes32 indexed earnerId, address indexed payee);
    event PaidOut(uint256 indexed milestone, bytes32 indexed earnerId, address indexed to, uint256 amount);

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
    error MilestoneMismatch();
    error PayeeNotAllowlisted();
    error ExceedsWithdrawable();
    error TransferFailed();
    error ZeroAddress();
    error BadBudget();
    error MilestoneNotFunded();
    error MilestoneStillRunning();
    error MilestoneAlreadyClosed();
    error MilestoneAlreadyOpen();
    error NotAnIncrease();
    error BadCertification();
    error CapsMayOnlyRise();
    error RepoLocked();
    error CapCannotStrandTheBudget();
    error AlreadyClaimed();
    error TooManyAuthors();
    error BadClaimSignature();
    error NotClaimable();
    error StreamIsPaused();
    error NoEarner();
    error EarnerOnNamedStream();
    error NotPublic();
    error NotPayee();
    error AlreadyBound();
    error StaleBinding();
    error BadCapPair();
    error OverClaimCap();
    error DailyClaimCapExceeded();

    constructor(
        IERC20 _usdc,
        address _contributor,
        address _claimAuthority,
        address _agent,
        string memory _milestone,
        uint256 _budget,
        uint256 _duration,
        string memory _repo,
        string[] memory _authors_,
        Policy memory _policy
    ) {
        // EXACTLY ONE OF NAMED, CLAIMABLE OR PUBLIC.
        //
        // A named stream knows its contributor and its payee at deploy. A
        // claimable one knows neither, and binds both when someone presents a
        // link. A public one names nobody: anyone's accepted work earns a
        // share, and each earner binds their own payee later.
        //
        // Public is NOT "the other two left blank". It has to carry payout
        // caps, so an employer who simply forgot to name anyone gets a revert
        // rather than a stream open to the world.
        bool named = _contributor != address(0);
        bool claimable = _claimAuthority != address(0);
        bool open = !named && !claimable;
        if (named && claimable) revert ZeroAddress();
        if (_agent == address(0)) revert ZeroAddress();
        if (named != (_policy.payee != address(0))) revert ZeroAddress();
        if (open) {
            if (_policy.claimCap == 0 || _policy.dailyClaimCap < _policy.claimCap) revert BadCapPair();
        } else {
            if (_policy.claimCap != 0 || _policy.dailyClaimCap != 0) revert BadCapPair();
        }

        // THE CAPS MAY THROTTLE THE RATE, NEVER MAKE THE TOTAL UNREACHABLE.
        //
        // Both caps bound the entitlement one attestation creates, and they
        // exist to bound a COMPROMISED AGENT KEY. The same mechanism is what
        // stranded an honest contributor: a `maxTranche` below the budget meant
        // the agent could never certify the milestone in full, the milestone
        // ended, and everything uncertified refunded to the employer. It took
        // 67 of 97 USDC from a real contributor, and no amount of interface
        // warning could stop an employer setting it.
        //
        // `maxTranche` therefore may not bound the total at all. Note the
        // consequence: because `added` can never exceed the budget, and
        // `maxTranche` can never be below it, OverMaxTranche is now unreachable
        // by construction on any stream deployed from this source. The check
        // below stays because `raisePolicy` may only raise, so the invariant
        // holds forever, and because removing a field is a larger change than
        // this deploy is for. DO NOT relax this check to make the field
        // "useful" again: that reintroduces the bug it exists to prevent.
        //
        // `dailyUnlockCap` still throttles, and still protects. It is a RATE, so
        // what it must satisfy is that it can cover the budget across the
        // milestone's own lifetime. An employer may set half the budget per day
        // on a two-day milestone: a stolen key then takes at most half in any
        // one day, while an honest contributor still reaches 100%.
        //
        // Days are rounded UP, so a milestone shorter than a day still gets a
        // full day's allowance rather than zero.
        if (_policy.maxTranche < _budget) revert CapCannotStrandTheBudget();
        uint256 daysLong = (_duration + 1 days - 1) / 1 days;
        if (_policy.dailyUnlockCap * daysLong < _budget) revert CapCannotStrandTheBudget();

        usdc = _usdc;
        employer = msg.sender;
        contributor = _contributor;
        claimAuthority = _claimAuthority;
        agent = _agent;
        repo = _repo;
        _replaceAuthors(_authors_);
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

    /// @notice The GitHub logins whose merges count. Empty means any author.
    /// @dev An explicit getter because Solidity's automatic one for a public
    ///      array returns a single element by index, and every consumer wants
    ///      the whole list.
    function authors() external view returns (string[] memory) {
        return _authors;
    }

    /// @notice Which generation of this contract this is.
    /// @dev Streams from every past deployment stay live and keep their own
    ///      behaviour forever, because each employer deploys their own copy.
    ///      Consumers need to tell them apart to know which actions exist; the
    ///      alternative is probing for a function and reading a revert as an
    ///      answer. This cannot be added to an already-deployed stream, so a
    ///      stream that does not answer is by definition version 1.
    function version() external pure returns (uint256) {
        return 3;
    }

    /// @notice A public stream names nobody at deploy. Recognised by the
    ///         absence of both a contributor and a claim authority, which the
    ///         constructor only permits alongside payout caps.
    function isPublic() public view returns (bool) {
        return contributor == address(0) && claimAuthority == address(0);
    }

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

    /// @notice The agent's standing verdict on the current milestone, in basis
    ///         points of completion. Monotonic within a milestone.
    function certifiedBps() external view returns (uint256) {
        return cur.certifiedBps;
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

    /// @notice The earliest the employer may close, including CLOSE_GRACE.
    function closableAt() public view returns (uint256) {
        return cur.activatedAt == 0 ? 0 : milestoneEndsAt() + CLOSE_GRACE;
    }

    /// @notice What the agent has certified the contributor is owed for this
    ///         milestone, in USDC. Rises only when the agent judges more work
    ///         satisfied; the clock never moves it.
    function target() public view returns (uint256) {
        return (cur.budget * cur.certifiedBps) / BPS;
    }

    /// @notice USDC the clock has released so far on the current milestone:
    ///         `budget × elapsed / duration`, excluding paused time and
    ///         stopping at the milestone's end. Exact at the end — no dust.
    /// @dev    This is the schedule ONLY. It says nothing about whether any of
    ///         it has been earned; `earned()` is what a contributor can take.
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

    /// @notice What the contributor has actually earned on the current
    ///         milestone: the agent's verdict, metered by the clock.
    function earned() public view returns (uint256) {
        // A closed milestone has already been crystallised into settledCredit;
        // counting it here as well would pay for it twice.
        if (cur.closed) return 0;

        uint256 t = target();

        // Complete work ends the schedule. There is nothing further to stream
        // toward, so metering it would be delay for its own sake. This is the
        // ONLY point at which certification touches the clock — see the note
        // on the contract.
        if (cur.certifiedBps == BPS) return t;

        uint256 a = accrued();
        return a < t ? a : t;
    }

    /// @notice Earned but not yet paid out.
    function withdrawable() public view returns (uint256) {
        return settledCredit + earned() - withdrawn;
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

        _activateIfReady();
    }

    /// @dev THE CLOCK MUST NOT RUN BEFORE THERE IS SOMEONE TO PAY. An unclaimed
    ///      stream sitting in an inbox for a week would otherwise cost the
    ///      contributor a week of accrual for a delay they did not cause and
    ///      could not see.
    function _activateIfReady() internal {
        // A claimable stream waits for someone to claim; there is nobody to pay
        // until then. A public stream never has a single contributor, so it
        // starts the moment it is funded: earners are recorded as they arrive.
        if (cur.activatedAt != 0 || !fullyFunded()) return;
        if (contributor == address(0) && !isPublic()) return;
        cur.activatedAt = uint64(block.timestamp);
        pausedSeconds = 0;
        emit MilestoneActivated(milestoneIndex, cur.activatedAt, cur.budget);
    }

    /// @notice Bind yourself as the contributor of a stream shared as a link.
    /// @dev The signature must be the claim authority's, over the CALLER'S OWN
    ///      address. That is what makes this safe to broadcast: a watcher who
    ///      copies the signature out of the mempool holds an authorisation for
    ///      somebody else's address, which does nothing for them.
    ///
    ///      The obvious alternative, storing a secret hash and having the
    ///      claimant reveal it, is front-runnable for exactly the reason this is
    ///      not: the secret works for whoever submits it first.
    function claim(bytes calldata signature) external {
        if (contributor != address(0)) revert AlreadyClaimed();
        if (claimAuthority == address(0)) revert NotClaimable();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(CLAIM_TYPEHASH, msg.sender))
            )
        );
        // `recover` yields address(0) on a malformed signature, and
        // `claimAuthority` is non-zero here, so a bad signature cannot match.
        if (recover(digest, signature) != claimAuthority) revert BadClaimSignature();

        contributor = msg.sender;
        policy.payee = msg.sender;
        emit Claimed(msg.sender);

        _activateIfReady();
    }

    /// @notice Reissue or revoke an unclaimed link.
    /// @dev Only while unclaimed. Afterwards the contributor is settled and this
    ///      would be a way to hand their stream to somebody else.
    function setClaimAuthority(address newAuthority) external {
        if (msg.sender != employer) revert NotEmployer();
        if (contributor != address(0)) revert AlreadyClaimed();
        claimAuthority = newAuthority;
        emit ClaimAuthoritySet(newAuthority);
    }

    /// @notice Open the next milestone with its own budget and duration. It
    ///         will not start accruing until `fund` covers that budget.
    /// @dev Refused while paused. `pausedAt` belongs to the pause window that
    ///      is still open, and carrying it into a fresh milestone poisons that
    ///      milestone's accrual permanently: `accrued()` reads `upTo = pausedAt`
    ///      from before the new activation and returns 0 forever, while
    ///      `resume()` adds the whole inter-milestone gap to `pausedSeconds`.
    ///      Requiring a resume first is one line and removes the trap entirely.
    function openMilestone(string calldata text, uint256 newBudget, uint256 newDuration) external {
        if (msg.sender != employer) revert NotEmployer();
        if (!cur.closed) revert MilestoneAlreadyOpen();
        if (paused) revert StreamIsPaused();
        _openMilestone(text, newBudget, newDuration);
    }

    /// @notice Settle the current milestone so the next can open, crediting the
    ///         contributor everything the agent certified and returning the
    ///         rest to the employer.
    /// @dev Only once the milestone has run its course AND the certification
    ///      grace window has passed, or if it never started. Otherwise an
    ///      employer could close the instant the clock ran out and reclaim work
    ///      that was merged minutes earlier and still being judged.
    ///
    ///      Crystallising `target()` rather than `earned()` is what makes the
    ///      agent's verdict final: whatever the clock had reached, and whether
    ///      or not the stream was paused, the contributor leaves with exactly
    ///      what was certified.
    function closeMilestone() external {
        if (msg.sender != employer) revert NotEmployer();
        if (cur.closed) revert MilestoneAlreadyClosed();
        if (cur.activatedAt != 0 && block.timestamp < closableAt()) revert MilestoneStillRunning();

        uint256 credited = target();
        settledCredit += credited;
        // Freeze what a share is a fraction OF. The next milestone overwrites
        // `cur`, and an earner who has not withdrawn yet must still be able to.
        closedTarget[milestoneIndex] = credited;
        closedBps[milestoneIndex] = cur.certifiedBps;
        cur.closed = true;

        // Everything not owed to the contributor goes home.
        uint256 held = usdc.balanceOf(address(this));
        uint256 owed = withdrawable();
        uint256 refund = held > owed ? held - owed : 0;
        if (refund > 0 && !usdc.transfer(employer, refund)) revert TransferFailed();

        emit MilestoneClosed(milestoneIndex, credited, refund);
        emit Reclaimed(refund);
    }

    /// @notice Raise the agent's standing verdict on the current milestone
    ///         against a signed attestation. Callable by anyone carrying a
    ///         valid signature; in practice the agent sends it from its own
    ///         wallet and pays its own gas.
    /// @dev Deliberately NOT blocked while paused. Pause stops the clock, so no
    ///      new money is scheduled — but work already delivered must stay
    ///      certifiable, otherwise an employer could watch work land, pause,
    ///      and freeze the agent out of recognising it.
    ///
    ///      There is no accrual check here, and that is the point: certification
    ///      records what was EARNED, while `earned()` meters when it arrives.
    ///      The agent may certify a milestone complete on day one; the
    ///      contributor still collects on schedule.
    function certify(Attestation calldata a, bytes calldata signature) external {
        if (cur.activatedAt == 0) revert MilestoneNotFunded();
        if (a.nonce != nonce) revert BadNonce();
        if (a.issuedAt > block.timestamp) revert FutureAttestation();
        if (block.timestamp > a.issuedAt + ATTESTATION_TTL) revert StaleAttestation();
        if (a.milestoneHash != cur.hash) revert MilestoneMismatch();
        if (a.certifiedBps > BPS) revert BadCertification();
        // Monotonic: a later judgment may raise a contributor's claim, never
        // reduce one they have already been told they have.
        if (a.certifiedBps <= cur.certifiedBps) revert NotAnIncrease();

        uint256 added = ((cur.budget * a.certifiedBps) / BPS) - target();
        if (added > policy.maxTranche) revert OverMaxTranche();

        uint256 today = block.timestamp / 1 days;
        if (today != dayBucket) {
            dayBucket = today;
            unlockedToday = 0;
        }
        if (unlockedToday + added > policy.dailyUnlockCap) revert DailyCapExceeded();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        ATTESTATION_TYPEHASH,
                        a.nonce,
                        a.certifiedBps,
                        a.prNumber,
                        keccak256(bytes(a.commitSha)),
                        a.confidenceBps,
                        a.issuedAt,
                        a.milestoneHash,
                        a.earnerId
                    )
                )
            )
        );
        address signer = recover(digest, signature);
        if (signer != agent) revert WrongSigner();

        // WHO EARNED IT. `a.certifiedBps` is still the new TOTAL for the
        // milestone, so the ratchet, both caps, the ceiling and target() all
        // keep working on the total untouched. The delta is what this earner
        // is credited, and the sum over earners stays equal to the total.
        if (isPublic()) {
            if (a.earnerId == bytes32(0)) revert NoEarner();
            creditBps[milestoneIndex][a.earnerId] += a.certifiedBps - cur.certifiedBps;
        } else if (a.earnerId != bytes32(0)) {
            revert EarnerOnNamedStream();
        }

        nonce = a.nonce + 1;
        unlockedToday += added;
        cur.certifiedBps = a.certifiedBps;

        emit MilestoneCertified(a.nonce, a.prNumber, a.commitSha, a.confidenceBps, a.certifiedBps, added);
    }

    /// @notice Pay out earned funds. Only the contributor may call, and only to
    ///         the policy's allowlisted payee (T1/T6 blast-radius bound).
    function withdraw(address to, uint256 amount) external {
        if (msg.sender != contributor) revert NotContributor();
        if (to != policy.payee) revert PayeeNotAllowlisted();
        if (amount > withdrawable()) revert ExceedsWithdrawable();
        withdrawn += amount;
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    // ------------------------------------------------------- public mode

    /// @notice An earner's slice of one milestone, metered PROPORTIONALLY.
    /// @dev When the clock has released less than the total owed, every earner
    ///      may take their fraction of what is released, pro rata to what they
    ///      were credited. Nothing to race and nobody is punished for being
    ///      asleep, which is why first-come was rejected.
    ///
    ///      Integer division leaves at most one unit per earner unassigned. It
    ///      stays in the contract. Sub-cent, permanent, documented in SPEC-V3.
    function earnerShare(uint256 m, bytes32 earnerId) public view returns (uint256) {
        uint256 bps = creditBps[m][earnerId];
        if (bps == 0) return 0;
        if (m == milestoneIndex && !cur.closed) {
            return (earned() * bps) / cur.certifiedBps;
        }
        return (closedTarget[m] * bps) / closedBps[m];
    }

    /// @notice What an earner may still take from one milestone.
    function earnerWithdrawable(uint256 m, bytes32 earnerId) public view returns (uint256) {
        return earnerShare(m, earnerId) - paidTo[m][earnerId];
    }

    /// @notice Choose, once and for ever, where an earner is paid.
    /// @dev Three properties, each load-bearing:
    ///      - `payee` is INSIDE the signed struct, so a signature lifted from
    ///        the mempool authorises somebody else's address and is useless.
    ///      - `msg.sender` must BE the payee, so a typo or a dead address can
    ///        never be bound. That is the whole reason binding is safe to make
    ///        permanent. Gas is sponsored, so a wallet-less earner can still
    ///        be the sender.
    ///      - Once per earner, and that is the replay guard: no nonce needed.
    ///        `deadline` bounds how long an unused authorisation lives.
    function bindPayee(bytes32 earnerId, address payee_, uint256 deadline, bytes calldata signature) external {
        if (!isPublic()) revert NotPublic();
        if (payee_ == address(0)) revert ZeroAddress();
        if (msg.sender != payee_) revert NotPayee();
        if (payeeOf[earnerId] != address(0)) revert AlreadyBound();
        if (block.timestamp > deadline) revert StaleBinding();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PAYEE_BINDING_TYPEHASH, earnerId, payee_, deadline))
            )
        );
        if (recover(digest, signature) != agent) revert WrongSigner();

        payeeOf[earnerId] = payee_;
        emit PayeeBound(earnerId, payee_);
    }

    /// @notice Pay an earner their share of one milestone, to their bound payee.
    /// @dev Capped per call and per UTC day, mirroring certify(). A compromised
    ///      agent that binds itself to an unbound earner drains at this rate
    ///      until the employer closes the milestone, which refunds the rest.
    ///      Same shape as the bound on a compromised certifier.
    function withdrawFor(uint256 m, bytes32 earnerId, uint256 amount) external {
        if (!isPublic()) revert NotPublic();
        address to = payeeOf[earnerId];
        if (to == address(0) || msg.sender != to) revert NotPayee();
        if (amount > earnerWithdrawable(m, earnerId)) revert ExceedsWithdrawable();
        if (amount > policy.claimCap) revert OverClaimCap();

        uint256 today = block.timestamp / 1 days;
        if (today != claimDayBucket) {
            claimDayBucket = today;
            claimedToday = 0;
        }
        if (claimedToday + amount > policy.dailyClaimCap) revert DailyClaimCapExceeded();

        claimedToday += amount;
        paidTo[m][earnerId] += amount;
        // The stream total too, so closeMilestone's refund arithmetic holds.
        withdrawn += amount;
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit PaidOut(m, earnerId, to, amount);
    }

    /// @notice Employer stops the clock (stop shipping → money pauses itself).
    ///         Certification continues; see `certify`. Because closing
    ///         crystallises the certified target, pausing can only ever delay
    ///         certified pay, never reduce it.
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
    /// @dev LOCKED ONCE ANYTHING IS CERTIFIED. Without this an employer could
    ///      point the stream at a different repository after the agent had
    ///      already certified work against the original one. It cannot un-certify
    ///      what was earned, but it redirects what the agent judges NEXT, which
    ///      is enough: the contributor keeps working on the repository they
    ///      agreed to while the agent starts judging somewhere else.
    ///
    ///      Before the first certification this stays open, so an employer can
    ///      still correct a typo in a stream nobody has been paid against.
    function setRepo(string calldata newRepo) external {
        if (msg.sender != employer) revert NotEmployer();
        if (cur.certifiedBps > 0) revert RepoLocked();
        repo = newRepo;
        emit RepoSet(newRepo);
    }

    /// @notice Change whose merges count for this stream.
    /// @dev Locked once anything is certified, exactly as `setRepo` is, and for
    ///      the same reason. Before the first certification an employer may fix
    ///      a mistyped handle. Afterwards, changing the list would be a way to
    ///      stop paying someone they have already been paying for work on this
    ///      milestone.
    function setAuthors(string[] calldata newAuthors) external {
        if (msg.sender != employer) revert NotEmployer();
        if (cur.certifiedBps > 0) revert RepoLocked();
        _replaceAuthors(newAuthors);
        emit AuthorsSet(newAuthors);
    }

    /// @dev Element by element because Solidity cannot copy a nested dynamic
    ///      array straight into storage.
    function _replaceAuthors(string[] memory newAuthors) internal {
        if (newAuthors.length > MAX_AUTHORS) revert TooManyAuthors();
        delete _authors;
        for (uint256 i = 0; i < newAuthors.length; i++) {
            _authors.push(newAuthors[i]);
        }
    }

    /// @notice Loosen the agent's mandate. Caps may only RISE and the payee can
    ///         never change.
    /// @dev An employer who sized `maxTranche` too tightly would otherwise have
    ///      to redeploy to pay a contributor what the agent certified. Lowering
    ///      is forbidden because a cap the employer can tighten mid-milestone is
    ///      a way to strand certified work, and changing the payee is forbidden
    ///      because that allowlist is the contributor's protection, not the
    ///      employer's convenience. The agent may never call this at all: it can
    ///      spend up to its mandate and never widen it (T1/T6).
    function raisePolicy(uint256 newMaxTranche, uint256 newDailyUnlockCap) external {
        if (msg.sender != employer) revert NotEmployer();
        if (newMaxTranche < policy.maxTranche || newDailyUnlockCap < policy.dailyUnlockCap) {
            revert CapsMayOnlyRise();
        }
        policy.maxTranche = newMaxTranche;
        policy.dailyUnlockCap = newDailyUnlockCap;
        emit PolicyRaised(newMaxTranche, newDailyUnlockCap);
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
            certifiedBps: 0,
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
