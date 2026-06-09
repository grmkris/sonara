// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Minimal, SonaraStage} from "../src/SonaraStage.sol";

/// @dev Minimal USDC stand-in: 6-decimal balances + allowances, bool returns
///      like Circle's FiatToken.
contract MockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (allowance[from][msg.sender] < value || balanceOf[from] < value) {
            return false;
        }
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}

contract SonaraStageTest is Test {
    uint256 constant PROMPT_PRICE = 50_000; // 0.05 USDC
    bytes32 constant ROOM = bytes32("room-abc");
    address constant TREASURY = address(0xBEEF);

    MockUsdc usdc;
    SonaraStage stage;

    event Nudge(bytes32 indexed room, address indexed who, uint8 knob, int16 delta);
    event Set(bytes32 indexed room, address indexed who, uint8 knob, uint16 value);
    event Prompt(bytes32 indexed room, address indexed who, string text, uint256 paid, uint256 tip);

    function setUp() public {
        usdc = new MockUsdc();
        stage = new SonaraStage(IERC20Minimal(address(usdc)), TREASURY, PROMPT_PRICE);
        usdc.mint(address(this), 1_000_000); // 1 USDC
        usdc.approve(address(stage), type(uint256).max);
    }

    function test_nudge_emits_and_is_free() public {
        vm.expectEmit(true, true, false, true);
        emit Nudge(ROOM, address(this), 1, int16(120));
        stage.nudge(ROOM, 1, int16(120));
        assertEq(usdc.balanceOf(address(this)), 1_000_000);
    }

    function test_set_emits_and_is_free() public {
        vm.expectEmit(true, true, false, true);
        emit Set(ROOM, address(this), 0, uint16(1000));
        stage.set(ROOM, 0, uint16(1000));
        assertEq(usdc.balanceOf(address(this)), 1_000_000);
    }

    function test_prompt_pulls_base_price() public {
        vm.expectEmit(true, true, false, true);
        emit Prompt(ROOM, address(this), "neon jellyfish", PROMPT_PRICE, 0);
        stage.prompt(ROOM, "neon jellyfish", 0);
        assertEq(usdc.balanceOf(TREASURY), PROMPT_PRICE);
        assertEq(usdc.balanceOf(address(this)), 1_000_000 - PROMPT_PRICE);
    }

    function test_prompt_with_tip_pulls_price_plus_tip() public {
        uint256 tip = 200_000; // 0.20 USDC
        vm.expectEmit(true, true, false, true);
        emit Prompt(ROOM, address(this), "cut the line", PROMPT_PRICE + tip, tip);
        stage.prompt(ROOM, "cut the line", tip);
        assertEq(usdc.balanceOf(TREASURY), PROMPT_PRICE + tip);
    }

    function test_prompt_reverts_without_allowance() public {
        address broke = address(0xCAFE);
        usdc.mint(broke, 1_000_000);
        vm.prank(broke); // funded but never approved
        vm.expectRevert(bytes("usdc transfer failed"));
        stage.prompt(ROOM, "freeloader", 0);
    }

    function test_prompt_reverts_without_balance() public {
        address broke = address(0xDEAD);
        vm.startPrank(broke);
        usdc.approve(address(stage), type(uint256).max);
        vm.expectRevert(bytes("usdc transfer failed"));
        stage.prompt(ROOM, "no funds", 0);
        vm.stopPrank();
    }

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(bytes("usdc=0"));
        new SonaraStage(IERC20Minimal(address(0)), TREASURY, PROMPT_PRICE);
        vm.expectRevert(bytes("treasury=0"));
        new SonaraStage(IERC20Minimal(address(usdc)), address(0), PROMPT_PRICE);
    }
}
