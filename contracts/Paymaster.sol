// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./AccountFactory.sol";

contract Paymaster is IPaymaster, Ownable {
    bool public isShutdown;
    IEntryPoint public entryPoint;
    AccountFactory public accountFactory;

    uint256 public constant MAX_GAS_LIMIT = 10000000; // 10M gas
    uint256 public constant MAX_FEE_PER_GAS = 100 gwei; // Maximum gas price allowed

    // Track gas usage per account
    mapping(address => uint256) public accountGasUsage;

    // Whitelist of accounts this paymaster will sponsor
    mapping(address => bool) public sponsoredAccounts;

    constructor(
        address _entryPoint,
        address _accountFactory
    ) Ownable(msg.sender) {
        isShutdown = false;
        entryPoint = IEntryPoint(_entryPoint);
        accountFactory = AccountFactory(_accountFactory);
    }

    modifier notShutdown() {
        require(!isShutdown, "Paymaster is shut down");
        _;
    }

    // Add account to sponsored accounts list
    function addSponsoredAccount(address account) external onlyOwner {
        sponsoredAccounts[account] = true;
    }

    // Remove account from sponsored accounts list
    function removeSponsoredAccount(address account) external onlyOwner {
        sponsoredAccounts[account] = false;
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    )
        external
        view
        override
        notShutdown
        returns (bytes memory context, uint256 validationData)
    {
        // Verify caller is the EntryPoint
        require(address(entryPoint) == msg.sender, "Invalid entry point");

        // Basic gas and paymaster data validation
        require(
            userOp.preVerificationGas <= MAX_GAS_LIMIT,
            "Gas limits too high"
        );

        // Check if paymaster has enough deposit
        require(
            entryPoint.balanceOf(address(this)) >= maxCost,
            "Insufficient funds for gas"
        );

        // Parse gas fees
        (uint256 maxFeePerGas, ) = _parseGasFees(userOp.gasFees);
        require(maxFeePerGas <= MAX_FEE_PER_GAS, "Gas fee too high");

        // Check if this is a sponsored account
        require(sponsoredAccounts[userOp.sender], "Account not sponsored");

        // Return the account address in context for tracking
        context = abi.encode(userOp.sender);

        return (context, 0); // validationData = 0 means no time limits
    }

    function _parseGasFees(
        bytes32 packedFees
    )
        internal
        pure
        returns (uint256 maxFeePerGas, uint256 maxPriorityFeePerGas)
    {
        maxFeePerGas = uint256(uint128(bytes16(packedFees)));
        maxPriorityFeePerGas = uint256(uint128(bytes16(packedFees << 128)));
        return (maxFeePerGas, maxPriorityFeePerGas);
    }

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external override notShutdown {
        require(address(entryPoint) == msg.sender, "Invalid entry point");

        // Decode user account from context
        address userAccount = abi.decode(context, (address));

        // track gas usage
        accountGasUsage[userAccount] += actualGasCost;
    }

    // still don't know difference between deposit and stake
    function deposit() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function withdrawFromEntryPoint(uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(payable(owner()), amount);
    }

    function withdraw() external onlyOwner notShutdown {
        payable(owner()).transfer(address(this).balance);
    }

    function shutdown() external onlyOwner {
        isShutdown = true;
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}
}
