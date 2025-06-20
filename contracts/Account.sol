// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract Account is IAccount {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public count;

    // Platform verification data
    address public platformSigner;
    // Merchant address that controls this account
    address public merchantAddress;
    string public userEmail;
    address public entryPoint;

    constructor(
        address _entryPoint,
        address _platformSigner,
        address _merchantAddress,
        string memory _email
    ) {
        platformSigner = _platformSigner;
        merchantAddress = _merchantAddress;
        userEmail = _email;
        entryPoint = _entryPoint;
    }

    // Set the platform signer - this should be set only once or by the owner
    function setPlatformSigner(address _platformSigner) external {
        require(
            msg.sender == address(this) || msg.sender == platformSigner,
            "Not authorized"
        );
        platformSigner = _platformSigner;
    }

    // Update merchant address - can only be changed by platform or self-execution
    function setMerchantAddress(address _merchantAddress) external {
        require(
            msg.sender == address(this) || msg.sender == platformSigner || msg.sender == merchantAddress,
            "Not authorized"
        );
        merchantAddress = _merchantAddress;
    }

    function updateEmail(string memory _email) external {
        require(
            msg.sender == address(this) || msg.sender == platformSigner,
            "Not authorized"
        );
        userEmail = _email;
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        // Standard ERC-4337 signature validation
        bytes32 hash = userOpHash.toEthSignedMessageHash();

        // Signature should come directly in userOp.signature
        address recoveredSigner = hash.recover(userOp.signature);

        // Check if the signer is the merchant who controls this account
        if (recoveredSigner == merchantAddress) {
            _handleMissingFunds(missingAccountFunds);
            return 0; // Valid signature - return 0 for valid operation with no time range
        }

        // Also allow platform signer as a fallback (optional, can be removed for stricter security)
        if (recoveredSigner == platformSigner) {
            _handleMissingFunds(missingAccountFunds);
            return 0; // Valid signature from platform
        }

        return 1; // Invalid signature
    }

    function _handleMissingFunds(uint256 missingAccountFunds) internal {
        if (missingAccountFunds > 0) {
            (bool success, ) = payable(msg.sender).call{
                value: missingAccountFunds
            }("");
            require(success, "Failed to transfer missingAccountFunds");
        }
    }

    // Execute a function call with arbitrary calldata
    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external {
   require(
       msg.sender == address(this) ||
       msg.sender == platformSigner ||
       msg.sender == merchantAddress ||
       msg.sender == address(entryPoint),  // Add this line
       "Account: not authorized"
   );
        (bool success, bytes memory result) = dest.call{value: value}(func);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // For receiving ETH
    receive() external payable {}

    function withdraw() external {
        require(msg.sender == merchantAddress, "Not authorized");
        (bool success, ) = payable(merchantAddress).call{
            value: address(this).balance
        }("");
        require(success, "Failed to withdraw");
    }
    function deposit() external payable {
        require(msg.sender == merchantAddress, "Not authorized");
        (bool success, ) = payable(address(this)).call{
            value: msg.value
        }("");
        require(success, "Failed to deposit");
    }
}
