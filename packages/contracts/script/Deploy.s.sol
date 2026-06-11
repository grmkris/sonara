// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20Minimal, SonaraStage} from "../src/SonaraStage.sol";

/// @notice Deploy SonaraStage to Monad testnet.
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url monad_testnet --private-key $DEPLOYER_KEY --broadcast
///
/// Optional env overrides:
///   USDC_ADDRESS       — payment token (default: canonical Monad testnet USDC)
///   STAGE_TREASURY     — where prompt payments land (default: the deployer)
///   PROMPT_PRICE_UNITS — base prompt price in 6-dec USDC units (default: 50000 = 0.05)
contract Deploy is Script {
    // Circle-issued USDC on Monad testnet (chain 10143), 6 decimals.
    address constant MONAD_TESTNET_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    uint256 constant DEFAULT_PROMPT_PRICE_UNITS = 50_000;

    function run() external returns (SonaraStage stage) {
        address usdc = vm.envOr("USDC_ADDRESS", MONAD_TESTNET_USDC);
        address treasury = vm.envOr("STAGE_TREASURY", msg.sender);
        uint256 price = vm.envOr("PROMPT_PRICE_UNITS", DEFAULT_PROMPT_PRICE_UNITS);

        vm.startBroadcast();
        stage = new SonaraStage(IERC20Minimal(usdc), treasury, price);
        vm.stopBroadcast();

        console.log("SonaraStage deployed at:", address(stage));
        console.log("  usdc:", usdc);
        console.log("  treasury:", treasury);
        console.log("  promptPriceUnits:", price);
    }
}
