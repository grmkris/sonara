// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The two USDC calls we make. Circle's FiatToken returns bool on both.
interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title SonaraStage — on-chain control plane for a live Sonara visual session.
/// @notice Knob moves (nudge/set) are free and event-only: the contract holds NO
///         mutable shared state for them, deliberately — on Monad's parallel
///         execution a shared storage slot would force conflicting txs to
///         re-execute serially, whereas pure event emission lets thousands of
///         independent taps land in parallel. Prompts are the one paid action:
///         each pulls a fixed USDC price (plus an optional tip for queue
///         priority) from the sender to the treasury. That transfer serializes
///         on the treasury balance slot, which is fine — prompts are rare
///         relative to taps. The authoritative "current scene" lives off-chain
///         in the live Session; the backend listener folds these events into it
///         (see apps/server/onchain).
///
/// @dev    `room` binds an event to one live session (a short server-issued room code,
///         left-padded into bytes32). `knob` selects which scene dial moves:
///         0=intensity, 1=softness, 2=surrealness, 3=abstraction, 4=stability.
///         Continuous values are fixed-point in [0, 1000] meaning [0.0, 1.0].
///         All USDC amounts are 6-decimal token units (1 USDC = 1_000_000).
contract SonaraStage {
    /// @notice The USDC token payments are denominated in (6 decimals).
    IERC20Minimal public immutable usdc;
    /// @notice Where prompt payments land.
    address public immutable treasury;
    /// @notice Base price of one prompt, in USDC units (e.g. 50_000 = 0.05).
    uint256 public immutable promptPriceUnits;

    /// @notice Relative move of a continuous scene knob (e.g. a "+ weirder" tap).
    /// @param delta signed fixed-point step, /1000 (e.g. +120 => +0.12).
    event Nudge(bytes32 indexed room, address indexed who, uint8 knob, int16 delta);

    /// @notice Absolute set of a continuous scene knob (e.g. an intensity slider).
    /// @param value fixed-point in [0, 1000] meaning [0.0, 1.0]; clamped off-chain.
    event Set(bytes32 indexed room, address indexed who, uint8 knob, uint16 value);

    /// @notice A paid prompt joined the room's queue. `paid` is the total USDC
    ///         pulled (base price + tip); `tip` buys priority — higher tips are
    ///         scheduled ahead of base-price prompts off-chain.
    event Prompt(bytes32 indexed room, address indexed who, string text, uint256 paid, uint256 tip);

    constructor(IERC20Minimal usdc_, address treasury_, uint256 promptPriceUnits_) {
        require(address(usdc_) != address(0), "usdc=0");
        require(treasury_ != address(0), "treasury=0");
        usdc = usdc_;
        treasury = treasury_;
        promptPriceUnits = promptPriceUnits_;
    }

    function nudge(bytes32 room, uint8 knob, int16 delta) external {
        emit Nudge(room, msg.sender, knob, delta);
    }

    function set(bytes32 room, uint8 knob, uint16 value) external {
        emit Set(room, msg.sender, knob, value);
    }

    /// @notice Pay `promptPriceUnits + tipUnits` USDC and queue a prompt. The
    ///         sender must have approved this contract for at least that much.
    function prompt(bytes32 room, string calldata text, uint256 tipUnits) external {
        uint256 paid = promptPriceUnits + tipUnits;
        require(usdc.transferFrom(msg.sender, treasury, paid), "usdc transfer failed");
        emit Prompt(room, msg.sender, text, paid, tipUnits);
    }
}
