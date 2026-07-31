// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface IWorkStream {
    function employer() external view returns (address);
    function agent() external view returns (address);
    function repo() external view returns (string memory);
}

/// @title StreamRegistry — discovery for WorkStreams the agent should watch
/// @notice A WorkStream records its employer as `msg.sender` at construction,
///         and that field is immutable. So a factory cannot mint one on a
///         user's behalf: the stream would belong to the factory, and refunds
///         from `closeMilestone` would be stranded there forever. Instead the
///         employer deploys their own stream — from a browser wallet or from
///         Foundry, the two are the same transaction — and then announces it
///         here.
///
/// @dev This contract holds no money, owns nothing, and can refuse nothing but
///      an impostor. It exists so one agent process can discover the streams it
///      serves by reading logs, instead of being configured with a single
///      address in its environment.
///
///      `register` is deliberately repeatable. An employer may call `setRepo`
///      on their stream, and the registry must be able to say so — so each call
///      emits a fresh event and **the latest event for a given stream wins**.
///      Consumers must fold the log newest-last per stream, not accumulate it,
///      or a renamed repository will leave a stale entry pointing at the stream.
contract StreamRegistry {
    /// @notice `agent` is indexed so an agent can filter the whole log down to
    ///         the streams naming it, without reading anyone else's.
    event StreamRegistered(address indexed stream, address indexed employer, address indexed agent, string repo);

    error ZeroAddress();
    error NotStreamEmployer();

    /// @notice Announce a stream. Only that stream's own employer may do so,
    ///         which is what keeps the log free of junk: the caller must prove
    ///         control by matching a value the stream itself reports.
    /// @dev Reverts for any address that does not answer `employer()` — an EOA
    ///      or an unrelated contract returns no data and decoding fails.
    function register(address stream) external {
        if (stream == address(0)) revert ZeroAddress();

        address employer = IWorkStream(stream).employer();
        if (employer != msg.sender) revert NotStreamEmployer();

        emit StreamRegistered(stream, employer, IWorkStream(stream).agent(), IWorkStream(stream).repo());
    }
}
