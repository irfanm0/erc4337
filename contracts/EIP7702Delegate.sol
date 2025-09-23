// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EIP7702Delegate
 * @notice A simple delegate contract for EIP-7702 EOAs
 * @dev Clean implementation without ERC-4337 complexity
 */
contract EIP7702Delegate {
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

    uint256 private constant SECP256K1N_DIV_2 =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    // Custom errors keep reverts cheap and explicit
    error EmptyCalls();
    error InvalidCaller();
    error SignatureExpired();

    modifier onlySelf() {
        if (msg.sender != address(this)) revert InvalidCaller();
        _;
    }

    /**
     * @notice Execute multiple calls in a single transaction (batching) with signature verification
     * @param calls Array of calls to execute
     * @param signature Signature from the delegating account owner
     */
    function execute(
        Call[] calldata calls,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (calls.length == 0) revert EmptyCalls();

        uint256 currentNonce = nonces[address(this)];

        // Create digest for signature verification
        bytes32 digest = _computeDigest(currentNonce, calls, deadline);

        if (block.timestamp > deadline) revert SignatureExpired();

        // Recover signer from signature
        address signer = _recoverSigner(digest, signature);

        // For EIP-7702, the delegated account address itself should sign
        // In EIP-7702, address(this) IS the delegated EOA address
        require(signer == address(this), "Invalid signature");

        nonces[address(this)] = currentNonce + 1;

        _executeCalls(calls);

        emit BatchExecuted(address(this), currentNonce, calls.length);
    }

    /**
     * @notice Execute multiple calls without signature (only for self-transactions)
     * @param calls Array of calls to execute
     */
    function executeDirect(Call[] calldata calls) external onlySelf {
        if (calls.length == 0) revert EmptyCalls();

        uint256 currentNonce = nonces[address(this)];
        nonces[address(this)] = currentNonce + 1;

        _executeCalls(calls);

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
    ) external onlySelf {
        _executeCall(target, value, data);

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

    function _executeCalls(Call[] calldata calls) internal {
        for (uint256 i = 0; i < calls.length; i++) {
            Call calldata callStruct = calls[i];
            _executeCall(callStruct.target, callStruct.value, callStruct.data);
        }
    }

    function _executeCall(
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);

        if (!success) {
            // Bubble up the revert reason
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
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

        require(
            uint256(s) > 0 && uint256(s) <= SECP256K1N_DIV_2,
            "Invalid signature s value"
        );

        return ecrecover(digest, v, r, s);
    }

    function getDigest(
        uint256 nonce,
        Call[] calldata calls,
        uint256 deadline
    ) public view returns (bytes32) {
        return _computeDigest(nonce, calls, deadline);
    }

    /**
     * @notice Allow contract to receive ETH
     */
    receive() external payable {}

    function _computeDigest(
        uint256 nonce,
        Call[] calldata calls,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 callsHash = keccak256(abi.encode(calls));
        return
            keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    keccak256(
                        abi.encode(
                            address(this),
                            block.chainid,
                            nonce,
                            deadline,
                            callsHash
                        )
                    )
                )
            );
    }
}
