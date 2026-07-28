// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title WorkStream — USDC payroll stream unlocked by agent attestations
/// @notice Salary accrues per second but stays locked until the attestor agent
///         signs an EIP-712 attestation that the current milestone was
///         satisfied. The agent is a single trusted key (see README "Known
///         limitations"), so the on-chain Policy bounds what a compromised key
///         can drain: at most `maxTranche` per unlock and `dailyUnlockCap` per
///         UTC day, withdrawable only to the allowlisted payee.
/// @dev All token amounts are 6-decimal ERC-20 USDC units.
contract WorkStream {
    // ---------------------------------------------------------------- actors
    IERC20 public immutable usdc;
    address public immutable employer;
    address public immutable contributor;
    address public immutable agent; // attestor key that signs unlocks
    address public immutable vestingVault;

    // ---------------------------------------------------------------- stream
    uint256 public immutable ratePerSecond; // 6-dp USDC accrued per second
    uint64 public immutable startTime;
    uint64 public immutable endTime;

    bool public paused;
    uint64 public pausedAt; // start of the current pause window
    uint256 public pausedSeconds; // completed pause time, excluded from accrual

    // ------------------------------------------------------------ accounting
    uint256 public unlocked; // cumulative unlocked (contributor + vault)
    uint256 public contributorCredited; // cumulative contributor share
    uint256 public withdrawn; // paid out to the allowlisted payee
    uint256 public nonce; // next expected attestation nonce

    // ------------------------------------------------------------- milestone
    string public milestone;
    bytes32 public milestoneHash;

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
    uint256 public constant VAULT_BPS = 1500; // 15% of each tranche vests
    uint256 public constant BPS = 10_000;
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
        uint256 confidenceBps; // agent confidence, basis points
        uint256 issuedAt;
        bytes32 milestoneHash; // binds the verdict to the milestone judged
    }

    // ---------------------------------------------------------------- events
    event Funded(address indexed from, uint256 amount);
    event TrancheUnlocked(
        uint256 indexed nonce,
        uint256 prNumber,
        string commitSha,
        uint256 confidenceBps,
        uint256 tranche,
        uint256 contributorShare,
        uint256 vaultShare
    );
    event Withdrawn(address indexed payee, uint256 amount);
    event StreamPaused(uint64 at);
    event StreamResumed(uint64 at);
    event Reclaimed(uint256 amount);
    event MilestoneSet(bytes32 indexed hash, string text);

    // ---------------------------------------------------------------- errors
    error NotEmployer();
    error NotContributor();
    error AlreadyPaused();
    error NotPaused();
    error Paused();
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
    error StreamNotEnded();
    error TransferFailed();
    error ZeroAddress();
    error BadTimeRange();

    constructor(
        IERC20 _usdc,
        address _contributor,
        address _agent,
        address _vestingVault,
        uint256 _ratePerSecond,
        uint64 _startTime,
        uint64 _endTime,
        string memory _milestone,
        Policy memory _policy
    ) {
        if (
            _contributor == address(0) || _agent == address(0) || _vestingVault == address(0)
                || _policy.payee == address(0)
        ) revert ZeroAddress();
        if (_endTime <= _startTime) revert BadTimeRange();

        usdc = _usdc;
        employer = msg.sender;
        contributor = _contributor;
        agent = _agent;
        vestingVault = _vestingVault;
        ratePerSecond = _ratePerSecond;
        startTime = _startTime;
        endTime = _endTime;
        milestone = _milestone;
        milestoneHash = keccak256(bytes(_milestone));
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
    }

    // ---------------------------------------------------------------- views

    /// @notice USDC earned so far: active seconds × rate, where paused time
    ///         does not count and accrual stops at `endTime`.
    function accrued() public view returns (uint256) {
        uint256 upTo = paused ? pausedAt : block.timestamp;
        if (upTo > endTime) upTo = endTime;
        if (upTo <= startTime) return 0;
        return (upTo - startTime - pausedSeconds) * ratePerSecond;
    }

    /// @notice Contributor share unlocked but not yet withdrawn.
    function withdrawable() public view returns (uint256) {
        return contributorCredited - withdrawn;
    }

    // ------------------------------------------------------------- mutations

    /// @notice Pull USDC from the employer into the stream (approve first).
    function fund(uint256 amount) external {
        if (msg.sender != employer) revert NotEmployer();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Funded(msg.sender, amount);
    }

    /// @notice Unlock a tranche against a signed agent attestation. Callable
    ///         by anyone carrying a valid signature; in practice the agent
    ///         sends it from its own wallet and pays its own gas.
    function unlock(Attestation calldata a, bytes calldata signature) external {
        if (paused) revert Paused();
        if (a.nonce != nonce) revert BadNonce();
        if (a.issuedAt > block.timestamp) revert FutureAttestation();
        if (block.timestamp > a.issuedAt + ATTESTATION_TTL) revert StaleAttestation();
        if (a.milestoneHash != milestoneHash) revert MilestoneMismatch();
        if (a.tranche > policy.maxTranche) revert OverMaxTranche();

        uint256 today = block.timestamp / 1 days;
        if (today != dayBucket) {
            dayBucket = today;
            unlockedToday = 0;
        }
        if (unlockedToday + a.tranche > policy.dailyUnlockCap) revert DailyCapExceeded();

        if (unlocked + a.tranche > accrued()) revert ExceedsAccrued();

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

        uint256 vaultShare = (a.tranche * VAULT_BPS) / BPS;
        uint256 contributorShare = a.tranche - vaultShare;
        contributorCredited += contributorShare;

        if (vaultShare > 0 && !usdc.transfer(vestingVault, vaultShare)) revert TransferFailed();

        emit TrancheUnlocked(
            a.nonce, a.prNumber, a.commitSha, a.confidenceBps, a.tranche, contributorShare, vaultShare
        );
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

    /// @notice Employer pauses accrual and unlocks (stop shipping → money
    ///         pauses itself).
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
        // Pause time past endTime does not count: accrual had already stopped.
        uint256 windowEnd = block.timestamp > endTime ? endTime : block.timestamp;
        if (windowEnd > pausedAt) pausedSeconds += windowEnd - pausedAt;
        paused = false;
        pausedAt = 0;
        emit StreamResumed(uint64(block.timestamp));
    }

    /// @notice Employer moves to the next milestone after a tranche unlocks.
    function setMilestone(string calldata text) external {
        if (msg.sender != employer) revert NotEmployer();
        milestone = text;
        milestoneHash = keccak256(bytes(text));
        emit MilestoneSet(milestoneHash, text);
    }

    /// @notice After the stream ends, the employer reclaims everything that
    ///         was never unlocked. Funds already credited to the contributor
    ///         stay withdrawable.
    function reclaimUnattested() external {
        if (msg.sender != employer) revert NotEmployer();
        if (block.timestamp <= endTime) revert StreamNotEnded();
        uint256 amount = usdc.balanceOf(address(this)) - withdrawable();
        if (!usdc.transfer(employer, amount)) revert TransferFailed();
        emit Reclaimed(amount);
    }

    // ------------------------------------------------------------- internals

    function recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        return ecrecover(digest, v, r, s);
    }
}
