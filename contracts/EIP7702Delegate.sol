// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EIP7702Delegate
 * @notice A delegate contract that multiple EOAs can delegate to via EIP-7702
 * @dev This single contract can serve many EOAs - no need to deploy per user
 */
contract EIP7702Delegate {
    // Events
    event BatchExecuted(address indexed account, uint256 nonce);
    event SessionKeyAdded(
        address indexed account,
        address indexed sessionKey,
        uint256 validUntil
    );

    // Structs
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct SessionKey {
        uint256 validUntil;
        uint256 maxValue;
        bool isActive;
    }

    // Storage - using account-specific mappings since multiple EOAs delegate here
    mapping(address => uint256) public nonces;
    mapping(address => mapping(address => SessionKey)) public sessionKeys;

    // Modifiers
    modifier onlyDelegatingAccount() {
        // msg.sender is the EOA that delegated to this contract
        require(msg.sender == address(this), "Not delegating account");
        _;
    }

    modifier onlyAccountOrSession() {
        require(
            tx.origin == msg.sender || // Direct call from the EOA
                isValidSessionKey(msg.sender, tx.origin), // Valid session key
            "Unauthorized"
        );
        _;
    }

    /**
     * @notice Execute multiple calls in a single transaction (batching)
     * @param calls Array of calls to execute
     */
    function executeBatch(
        Call[] calldata calls
    ) external onlyDelegatingAccount {
        uint256 currentNonce = nonces[msg.sender]++;

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

        emit BatchExecuted(msg.sender, currentNonce);
    }

    /**
     * @notice Add a session key with limited permissions
     * @param sessionKey Address of the session key
     * @param validUntil Timestamp when the session key expires
     * @param maxValue Maximum value the session key can spend
     */
    function addSessionKey(
        address sessionKey,
        uint256 validUntil,
        uint256 maxValue
    ) external onlyDelegatingAccount {
        sessionKeys[msg.sender][sessionKey] = SessionKey({
            validUntil: validUntil,
            maxValue: maxValue,
            isActive: true
        });

        emit SessionKeyAdded(msg.sender, sessionKey, validUntil);
    }

    /**
     * @notice Execute a call using a session key
     * @param target Target contract
     * @param value ETH value to send
     * @param data Call data
     */
    function executeWithSessionKey(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyAccountOrSession {
        address account = tx.origin; // The EOA that delegated
        SessionKey storage sessionKey = sessionKeys[account][msg.sender];

        require(sessionKey.isActive, "Session key not active");
        require(
            block.timestamp <= sessionKey.validUntil,
            "Session key expired"
        );
        require(value <= sessionKey.maxValue, "Value exceeds session limit");

        (bool success, bytes memory result) = target.call{value: value}(data);

        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /**
     * @notice Check if a session key is valid
     */
    function isValidSessionKey(
        address sessionKey,
        address account
    ) public view returns (bool) {
        SessionKey storage key = sessionKeys[account][sessionKey];
        return key.isActive && block.timestamp <= key.validUntil;
    }

    /**
     * @notice Revoke a session key
     */
    function revokeSessionKey(
        address sessionKey
    ) external onlyDelegatingAccount {
        sessionKeys[msg.sender][sessionKey].isActive = false;
    }

    /**
     * @notice Fallback to handle ETH transfers
     */
    receive() external payable {
        // Allow ETH transfers to delegating EOAs
    }

    /**
     * @notice Get the current nonce for an account
     */
    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }
}
