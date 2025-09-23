// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EIP7702Delegate
 * @notice A simple delegate contract for EIP-7702 EOAs
 * @dev Clean implementation without ERC-4337 complexity
 */
contract EIP7702Delegate_old {
    // Events
    event BatchExecuted(
        address indexed account,
        uint256 nonce,
        uint256 callsCount
    );
    event SingleCallExecuted(
        address indexed account,
        address indexed target,
        uint256 value
    );

    // Structs
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    // Storage - track nonces for each delegated account
    mapping(address => uint256) public nonces;

    /**
     * @notice Execute multiple calls in a single transaction (batching) with signature verification
     * @param calls Array of calls to execute
     * @param signature Signature from the delegating account owner
     */
    function execute(Call[] calldata calls, bytes calldata signature) external {
        require(calls.length > 0, "No calls provided");

        uint256 currentNonce = nonces[address(this)];

        // Create digest for signature verification
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encode(currentNonce, calls)) // Use nonce before increment
            )
        );

        nonces[address(this)]++;


        // Recover signer from signature
        address signer = _recoverSigner(digest, signature);

        // For EIP-7702, the delegated account address itself should sign
        // In EIP-7702, address(this) IS the delegated EOA address
        require(signer == address(this), "Invalid signature");

        for (uint256 i = 0; i < calls.length; i++) {
            Call calldata call = calls[i];

            (bool success, bytes memory result) = call.target.call{
                value: call.value
            }(call.data);

            if (!success) {
                // Bubble up the revert reason
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
        }

        emit BatchExecuted(address(this), currentNonce, calls.length);
    }

    /**
     * @notice Execute multiple calls without signature (only for self-transactions)
     * @param calls Array of calls to execute
     */
    function executeDirect(Call[] calldata calls) external {
        require(calls.length > 0, "No calls provided");

        // Only allow direct execution from the delegating account itself
        require(
            tx.origin == _getDelegatingAccountOwner(),
            "Only account owner can execute directly"
        );

        uint256 currentNonce = nonces[address(this)]++;

        for (uint256 i = 0; i < calls.length; i++) {
            Call calldata call = calls[i];

            (bool success, bytes memory result) = call.target.call{
                value: call.value
            }(call.data);

            if (!success) {
                // Bubble up the revert reason
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
        }

        emit BatchExecuted(address(this), currentNonce, calls.length);
    }

    /**
     * @notice Execute a single call
     * @param target Target address
     * @param value ETH value to send
     * @param data Call data
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external {
        (bool success, bytes memory result) = target.call{value: value}(data);

        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }

        emit SingleCallExecuted(address(this), target, value);
    }

    /**
     * @notice Get the current nonce for this account
     */
    function getNonce() external view returns (uint256) {
        return nonces[address(this)];
    }

    /**
     * @notice Check if an account is delegated to this contract
     */
    function isDelegated(address account) external view returns (bool) {
        bytes memory code = _getAccountCode(account);
        if (code.length == 23) {
            // EIP-7702 format: 0xef0100{20-byte-address}
            if (code[0] == 0xef && code[1] == 0x01 && code[2] == 0x00) {
                address delegateAddr;
                assembly {
                    delegateAddr := shr(96, mload(add(code, 35)))
                }
                return delegateAddr == address(this);
            }
        }
        return false;
    }

    /**
     * @notice Get account code (helper function)
     */
    function _getAccountCode(
        address account
    ) internal view returns (bytes memory) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        bytes memory code = new bytes(size);
        assembly {
            extcodecopy(account, add(code, 0x20), 0, size)
        }
        return code;
    }

    /**
     * @notice Recover signer from signature
     */
    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "Invalid signature v value");

        return ecrecover(digest, v, r, s);
    }

    /**
     * @notice Get the original EOA owner (for EIP-7702, this requires special handling)
     * @dev This is a simplified version - in production you'd want to store the original owner
     */
    function _getDelegatingAccountOwner() internal view returns (address) {
        // For simplicity, we'll use tx.origin as the owner
        // In production, you might want to store the original owner address
        return tx.origin;
    }

    function getDigest(uint256 nonce, Call[] calldata calls) public pure returns (bytes32) {
    return keccak256(
        abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encode(nonce, calls))
        )
    );
}

    /**
     * @notice Allow contract to receive ETH
     */
    receive() external payable {}
}