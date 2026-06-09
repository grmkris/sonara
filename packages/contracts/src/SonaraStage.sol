// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SonaraStage — on-chain control plane for a live Sonara visual session.
/// @notice Event-only by design. The contract holds NO mutable shared state: every
///         call just emits an event. This is deliberate for Monad's parallel
///         execution — a single shared storage slot (e.g. a global counter) would
///         force conflicting txs to re-execute serially and cap throughput, whereas
///         pure event emission lets thousands of independent taps land in parallel.
///         The authoritative "current scene" lives off-chain in the live Session;
///         the backend listener folds these events into it (see apps/server/onchain).
///
/// @dev    `room` binds an event to one live session (a short server-issued room code,
///         left-padded into bytes32). `knob` selects which scene dial moves:
///         0=intensity, 1=softness, 2=surrealness, 3=abstraction, 4=stability.
///         Continuous values are fixed-point in [0, 1000] meaning [0.0, 1.0].
contract SonaraStage {
    /// @notice Relative move of a continuous scene knob (e.g. a "+ weirder" tap).
    /// @param delta signed fixed-point step, /1000 (e.g. +120 => +0.12).
    event Nudge(bytes32 indexed room, address indexed who, uint8 knob, int16 delta);

    /// @notice Absolute set of a continuous scene knob (e.g. an intensity slider).
    /// @param value fixed-point in [0, 1000] meaning [0.0, 1.0]; clamped off-chain.
    event Set(bytes32 indexed room, address indexed who, uint8 knob, uint16 value);

    /// @notice Submit a prompt to the room's queue. `tip` (msg.value) buys priority:
    ///         higher tips are scheduled ahead of cheaper/free prompts off-chain.
    ///         Free (zero-value) prompts still always play, just behind paid ones.
    event Prompt(bytes32 indexed room, address indexed who, string text, uint256 tip);

    function nudge(bytes32 room, uint8 knob, int16 delta) external {
        emit Nudge(room, msg.sender, knob, delta);
    }

    function set(bytes32 room, uint8 knob, uint16 value) external {
        emit Set(room, msg.sender, knob, value);
    }

    function prompt(bytes32 room, string calldata text) external payable {
        emit Prompt(room, msg.sender, text, msg.value);
    }
}
