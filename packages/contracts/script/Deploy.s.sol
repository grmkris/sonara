// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SonaraStage} from "../src/SonaraStage.sol";

/// @notice Deploy SonaraStage to Monad testnet.
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url monad_testnet --private-key $DEPLOYER_KEY --broadcast
contract Deploy is Script {
    function run() external returns (SonaraStage stage) {
        vm.startBroadcast();
        stage = new SonaraStage();
        console.log("SonaraStage deployed at:", address(stage));
        vm.stopBroadcast();
    }
}
