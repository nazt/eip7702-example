// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title LogEmitter
 * @notice A simple contract that can emit Hello and World events, similar to the Rust example
 * @dev For demonstration of EIP-7702 with sponsored gas transactions
 */
contract LogEmitter {
    /**
     * @notice Emitted when the emitHello function is called
     */
    event Hello();

    /**
     * @notice Emitted when the emitWorld function is called
     */
    event World();

    /**
     * @notice Emits the Hello event
     * @dev Can be called via EIP-7702 sponsored transaction
     */
    function emitHello() public {
        emit Hello();
    }

    /**
     * @notice Emits the World event
     * @dev Can be called via EIP-7702 sponsored transaction
     */
    function emitWorld() public {
        emit World();
    }
}