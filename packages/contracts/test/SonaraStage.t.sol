// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SonaraStage} from "../src/SonaraStage.sol";

contract SonaraStageTest is Test {
    SonaraStage stage;
    bytes32 constant ROOM = bytes32("room-abc");

    event Nudge(bytes32 indexed room, address indexed who, uint8 knob, int16 delta);
    event Set(bytes32 indexed room, address indexed who, uint8 knob, uint16 value);
    event Prompt(bytes32 indexed room, address indexed who, string text, uint256 tip);

    function setUp() public {
        stage = new SonaraStage();
    }

    function test_nudge_emits() public {
        vm.expectEmit(true, true, false, true);
        emit Nudge(ROOM, address(this), 1, int16(120));
        stage.nudge(ROOM, 1, int16(120));
    }

    function test_set_emits() public {
        vm.expectEmit(true, true, false, true);
        emit Set(ROOM, address(this), 0, uint16(1000));
        stage.set(ROOM, 0, uint16(1000));
    }

    function test_prompt_free_emits_zero_tip() public {
        vm.expectEmit(true, true, false, true);
        emit Prompt(ROOM, address(this), "neon jellyfish", 0);
        stage.prompt(ROOM, "neon jellyfish");
    }

    function test_prompt_with_tip_records_value() public {
        vm.deal(address(this), 1 ether);
        vm.expectEmit(true, true, false, true);
        emit Prompt(ROOM, address(this), "cut the line", 0.5 ether);
        stage.prompt{value: 0.5 ether}(ROOM, "cut the line");
    }
}
