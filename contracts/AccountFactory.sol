// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "./Account.sol";

contract AccountFactory {
    // Mapping to track accounts by email hash
    mapping(bytes32 => address) public accountsByEmailHash;
    mapping(address => address) public accountsByMerchantAddress;
    // Platform signer that will sign operations
    address public platformSigner;
    address public entryPoint;
    // Event emitted when a new account is created
    event AccountCreated(
        bytes32 indexed emailHash,
        address indexed account,
        address indexed merchantAddress
    );

    constructor(address _platformSigner, address _entryPoint) {
        platformSigner = _platformSigner;
        entryPoint = _entryPoint;
    }

    // Update platform signer - this should be controlled by a governance mechanism
    function updatePlatformSigner(address _newPlatformSigner) external {
        require(msg.sender == platformSigner, "Not authorized");
        platformSigner = _newPlatformSigner;
    }

    function createAccount(
        string memory _email,
        address _merchantAddress
    ) public returns (address) {
        require(accountsByEmailHash[keccak256(abi.encodePacked(_email))] == address(0), "Account already exists");
        Account newAccount = new Account(
            entryPoint,
            platformSigner,
            _merchantAddress,
            _email
        );
        bytes32 emailHash = keccak256(abi.encodePacked(_email));
        accountsByEmailHash[emailHash] = address(newAccount);
        accountsByMerchantAddress[_merchantAddress] = address(newAccount);
        // Emit event with merchant address
        emit AccountCreated(emailHash, address(newAccount), _merchantAddress);

        return address(newAccount);
    }

    function batchCreateAccounts(
        string[] memory _emails,
        address[] memory _merchantAddresses
    ) public returns (address[] memory) {
        address[] memory accounts = new address[](_emails.length);
        for (uint256 i = 0; i < _emails.length; i++) {
            accounts[i] = createAccount(_emails[i], _merchantAddresses[i]);
        }
        return accounts;
    }

    // Get account for a specific email
    function getAccounts(string calldata _email) public view returns (address) {
        bytes32 emailHash = keccak256(abi.encodePacked(_email));
        return accountsByEmailHash[emailHash];
    }
    function getAccountByMerchantAddress(address _merchantAddress) public view returns (address) {
        return accountsByMerchantAddress[_merchantAddress];
    }
}
