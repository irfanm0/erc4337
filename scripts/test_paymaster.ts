import { ethers } from "hardhat";
import { Paymaster, AccountFactory, Account } from "../typechain-types";
import dotenv from "dotenv";
dotenv.config();

const entryPoint = process.env.ENTRY_POINT || ""; //entry point v8
const paymasterAddress = process.env.PAYMASTER || ""; //paymaster
const merchantAddress = process.env.MERCHANT_ADDRESS || ""; //merchant address

// Helper function to pack uint values as bytes32
function packUints(a: bigint, b: bigint): string {
  return ethers.solidityPacked(["uint128", "uint128"], [a, b]);
}

// Define the UserOperation type
interface PackedUserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: number;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

async function main() {
  // Get contract instances
  const paymaster = (await ethers.getContractAt(
    "Paymaster",
    paymasterAddress
  )) as Paymaster;

  const accountFactoryAddress = await paymaster.accountFactory();
  console.log("Account Factory address:", accountFactoryAddress);
  const depositBalance = await paymaster.getDeposit();
  console.log(
    `Paymaster balance in EntryPoint: ${ethers.formatEther(depositBalance)} BNB`
  );

  // Check if we need to deposit more funds
  const minRequiredBalance = ethers.parseEther("0.005"); // Require at least 0.01 BNB
  if (depositBalance < minRequiredBalance) {
    console.log("Deposit balance insufficient. Depositing more funds...");

    // Get the owner to deposit funds
    const [owner] = await ethers.getSigners();
    console.log(`Depositing from account: ${owner.address}`);

    // Deposit 0.02 BNB
    const depositAmount = ethers.parseEther("0.01");
    console.log(
      `Depositing ${ethers.formatEther(
        depositAmount
      )} BNB to EntryPoint via Paymaster`
    );

    const depositTx = await paymaster.deposit({
      value: depositAmount,
    });

    console.log(`Deposit transaction sent: ${depositTx.hash}`);
    await depositTx.wait();

    const newDepositBalance = await paymaster.getDeposit();
    console.log(
      `New paymaster balance in EntryPoint: ${ethers.formatEther(
        newDepositBalance
      )} BNB`
    );

    if (newDepositBalance < minRequiredBalance) {
      throw new Error("Deposit failed. Balance still insufficient.");
    }
  }

  const entryPointCheck = await paymaster.entryPoint();
  if (entryPointCheck.toLowerCase() !== entryPoint.toLowerCase()) {
    throw new Error("Entry point mismatch");
  }

  // Get EntryPoint instance
  const entryPointContract = await ethers.getContractAt(
    "IEntryPoint",
    entryPoint
  );

  const accountFactory = (await ethers.getContractAt(
    "AccountFactory",
    accountFactoryAddress
  )) as AccountFactory;

  const userEmail = "irfan@email.com";
  const expectedAccount = process.env.SMART_ACCOUNT || "";
  const userAccount = await accountFactory.getAccounts(userEmail);

  console.log("User account address:", userAccount);
  if (userAccount !== expectedAccount) {
    throw new Error("Account mismatch");
  }

  // Transfer details
  const targetAddress = "0xE9801621b1E4D5A9B64282df5484E0dB382512fC";
  const transferAmount = ethers.parseEther("0.001");

  // Get the Account contract
  const accountContract = (await ethers.getContractAt(
    "Account",
    userAccount
  )) as Account;

  // Verify Account configuration
  console.log("\n--- Verifying Account Configuration ---");
  const accountEntryPoint = await accountContract.entryPoint();
  console.log(`Account's EntryPoint: ${accountEntryPoint}`);
  console.log(`Expected EntryPoint: ${entryPoint}`);

  if (accountEntryPoint.toLowerCase() !== entryPoint.toLowerCase()) {
    console.log("❌ ERROR: EntryPoint address mismatch in Account contract!");
    console.log(
      "This will cause validation failures. The account may need to be redeployed."
    );
  } else {
    console.log("✅ EntryPoint address is correctly set in Account contract");
  }

  const accountMerchant = await accountContract.merchantAddress();
  console.log(`Account's Merchant: ${accountMerchant}`);
  console.log(`Expected Merchant: ${merchantAddress}`);

  if (accountMerchant.toLowerCase() !== merchantAddress.toLowerCase()) {
    console.log("❌ ERROR: Merchant address mismatch in Account contract!");
  } else {
    console.log("✅ Merchant address is correctly set in Account contract");
  }

  // Check if the account has funds
  console.log("\n--- Checking Account Funds ---");
  const initialAccountBalance = await ethers.provider.getBalance(userAccount);
  console.log(
    `Account balance: ${ethers.formatEther(initialAccountBalance)} BNB`
  );

  if (initialAccountBalance < transferAmount) {
    console.log(
      "❌ WARNING: Account doesn't have enough funds for the transfer"
    );

    // Fund the account for testing
    console.log("Funding account for testing...");
    const [owner] = await ethers.getSigners();
    const fundTx = await owner.sendTransaction({
      to: userAccount,
      value: ethers.parseEther("0.002"),
    });
    console.log(`Funding transaction sent: ${fundTx.hash}`);
    await fundTx.wait();

    const newBalance = await ethers.provider.getBalance(userAccount);
    console.log(`New account balance: ${ethers.formatEther(newBalance)} BNB`);
  } else {
    console.log("✅ Account has sufficient funds for the transfer");
  }

  const initialTargetBalance = await ethers.provider.getBalance(targetAddress);
  console.log(
    `Initial target balance: ${ethers.formatEther(initialTargetBalance)} BNB`
  );

  const checkMerchant = await accountContract.merchantAddress();
  if (checkMerchant !== merchantAddress) {
    throw new Error("Merchant address mismatch");
  }

  // Test sponsor capability
  console.log("\n--- Testing Paymaster Sponsorship ---");

  // Step 1: Ensure the account is sponsored in the paymaster
  const isSponsoredBefore = await paymaster.sponsoredAccounts(userAccount);
  console.log(`Is account sponsored before: ${isSponsoredBefore}`);

  // Add account to sponsored list if not already sponsored
  if (!isSponsoredBefore) {
    console.log("Adding account to sponsored list...");
    const sponsorTx = await paymaster.addSponsoredAccount(userAccount);
    console.log(`Sponsor transaction sent: ${sponsorTx.hash}`);
    await sponsorTx.wait();

    // Verify sponsorship was successful
    const isSponsoredAfter = await paymaster.sponsoredAccounts(userAccount);
    console.log(`Is account sponsored after: ${isSponsoredAfter}`);

    if (!isSponsoredAfter) {
      console.log(
        "WARNING: Account sponsorship failed! Checking transaction..."
      );
      const receipt = await ethers.provider.getTransactionReceipt(
        sponsorTx.hash
      );
      console.log(
        `Transaction status: ${receipt?.status ? "Success" : "Failed"}`
      );

      // Try one more time with higher gas limit
      console.log("Trying again with higher gas limit...");
      const sponsorTx2 = await paymaster.addSponsoredAccount(userAccount, {
        gasLimit: 500000,
      });
      console.log(`Second sponsor transaction sent: ${sponsorTx2.hash}`);
      await sponsorTx2.wait();

      // Final check
      const isSponsoredFinal = await paymaster.sponsoredAccounts(userAccount);
      console.log(`Is account sponsored final check: ${isSponsoredFinal}`);

      if (!isSponsoredFinal) {
        throw new Error("Could not sponsor account. Test cannot continue.");
      }
    }
  }

  // Step 2: Get the merchant signer
  console.log("\nGetting merchant wallet to sign transaction...");
  const merchantPrivateKey = process.env.MERCHANT_PRIVATE_KEY || "";
  if (!merchantPrivateKey) {
    throw new Error("MERCHANT_PRIVATE_KEY not found in .env file");
  }

  const merchantSigner = new ethers.Wallet(merchantPrivateKey, ethers.provider);
  console.log(`Merchant address from signer: ${merchantSigner.address}`);

  if (merchantSigner.address.toLowerCase() !== merchantAddress.toLowerCase()) {
    throw new Error(
      "Merchant signer address doesn't match expected merchant address"
    );
  }

  // Now try with EntryPoint and UserOperation
  console.log("\n--- Testing ERC-4337 UserOperation with Paymaster ---");

  try {
    // Prepare the calldata for the Account's execute function
    const executeData = accountContract.interface.encodeFunctionData(
      "execute",
      [
        targetAddress,
        transferAmount,
        "0x", // Empty bytes for simple transfer
      ]
    );

    // Get the current nonce of the account
    const nonce = await entryPointContract.getNonce(userAccount, 0);
    console.log("Current nonce:", nonce.toString());

    // Use more conservative gas values
    const verificationGasLimit = 1000000n;
    const callGasLimit = 500000n;
    const maxFeePerGas = ethers.parseUnits("5", "gwei");
    const maxPriorityFeePerGas = ethers.parseUnits("1", "gwei");
    const preVerificationGas = 50000;

    // Pack the gas limits
    const accountGasLimits = packUints(verificationGasLimit, callGasLimit);
    const gasFees = packUints(maxFeePerGas, maxPriorityFeePerGas);

    // Construct the paymaster data - add proper verification and postOp gas limits
    // Here we're using 300k for both verification and postOp gas limits
    const paymasterVerificationGasLimit = 300000n;
    const paymasterPostOpGasLimit = 300000n;

    const paymasterAndData = ethers.solidityPacked(
      ["address", "uint128", "uint128", "bytes"],
      [
        paymasterAddress,
        paymasterVerificationGasLimit,
        paymasterPostOpGasLimit,
        "0x",
      ]
    );

    console.log("Paymaster and data:", paymasterAndData);

    // Create UserOperation
    const userOp: PackedUserOperation = {
      sender: userAccount,
      nonce: nonce,
      initCode: "0x", // No init code since account already deployed
      callData: executeData,
      accountGasLimits: accountGasLimits,
      preVerificationGas: preVerificationGas,
      gasFees: gasFees,
      paymasterAndData: paymasterAndData,
      signature: "0x",
    };

    // Print the UserOperation for debugging
    console.log("UserOperation:", {
      sender: userOp.sender,
      nonce: userOp.nonce.toString(),
      callData: userOp.callData.slice(0, 66) + "...",
      accountGasLimits: userOp.accountGasLimits,
      paymasterAndData: userOp.paymasterAndData.slice(0, 66) + "...",
    });

    // Get the hash to sign
    const userOpHash = await entryPointContract.getUserOpHash(userOp);
    console.log("UserOp hash:", userOpHash);

    // Sign the hash with the merchant - be careful with the format
    const messageHash = ethers.getBytes(userOpHash);

    // Make sure we're signing correctly - use the correct format required by the account
    const signature = await merchantSigner.signMessage(messageHash);
    console.log("Signature:", signature);

    // Add the signature to the userOp
    userOp.signature = signature;

    console.log("Submitting UserOperation to EntryPoint...");

    // We'll use the merchant as the bundler/beneficiary for this test
    const [bundlerAddress] = await ethers.getSigners();
    const tx = await entryPointContract.handleOps(
      [userOp],
      bundlerAddress,
      { gasLimit: 3000000 } // Use a higher gas limit to ensure it goes through
    );
    console.log(`Transaction sent: ${tx.hash}`);

    const receipt = await tx.wait();
    if (!receipt) {
      console.log("Transaction was mined but receipt is null");
      return;
    }

    console.log(`Transaction confirmed: ${receipt.hash}`);
    console.log(`Gas used: ${receipt.gasUsed}`);

    // Sleep for a few seconds to ensure blockchain state is updated
    console.log("Waiting for blockchain state to update...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check balances after EntryPoint transaction
    const postAccountBalance = await ethers.provider.getBalance(userAccount);
    const postTargetBalance = await ethers.provider.getBalance(targetAddress);

    console.log("\n--- Balance Check After EntryPoint Transaction ---");
    console.log(
      `Account balance after: ${ethers.formatEther(postAccountBalance)} BNB`
    );
    console.log(
      `Target balance after: ${ethers.formatEther(postTargetBalance)} BNB`
    );

    console.log("\n--- Balance Changes ---");
    console.log(
      `Account balance change: ${ethers.formatEther(
        postAccountBalance - initialAccountBalance
      )} BNB`
    );
    console.log(
      `Target balance change: ${ethers.formatEther(
        postTargetBalance - initialTargetBalance
      )} BNB`
    );

    if (postTargetBalance - initialTargetBalance === transferAmount) {
      console.log("✅ SUCCESS: Target received exactly the transfer amount!");
    } else {
      console.log("❌ FAILURE: Target did not receive the expected amount!");
    }

    if (initialAccountBalance - postAccountBalance === transferAmount) {
      console.log(
        "✅ SUCCESS: Account balance reduced by exactly the transfer amount!"
      );
    } else {
      console.log(
        "❌ FAILURE: Account balance did not reduce by the expected amount!"
      );
      console.log(
        `Expected reduction: ${ethers.formatEther(transferAmount)} BNB`
      );
      console.log(
        `Actual reduction: ${ethers.formatEther(
          initialAccountBalance - postAccountBalance
        )} BNB`
      );
    }

    // Check paymaster usage information
    console.log("\n--- Paymaster Usage Information ---");
    const paymasterDepositAfter = await paymaster.getDeposit();
    const paymasterDepositChange = depositBalance - paymasterDepositAfter;

    console.log(
      `Paymaster deposit before: ${ethers.formatEther(depositBalance)} BNB`
    );
    console.log(
      `Paymaster deposit after: ${ethers.formatEther(
        paymasterDepositAfter
      )} BNB`
    );
    console.log(
      `Paymaster deposit used: ${ethers.formatEther(
        paymasterDepositChange
      )} BNB`
    );

    // Check if the paymaster tracks gas usage
    const gasUsage = await paymaster.accountGasUsage(userAccount);
    console.log(
      `Gas usage tracked for account: ${ethers.formatEther(gasUsage)} BNB`
    );

    // Check transaction events
    const events = receipt.logs;
    console.log(`\nTransaction had ${events.length} events/logs`);

    // Check EntryPoint events to confirm UserOperation was processed
    const entryPointInterface = new ethers.Interface([
      "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGas)",
    ]);

    const userOpEvents = events
      .filter((log) => log.address.toLowerCase() === entryPoint.toLowerCase())
      .map((log) => {
        try {
          return entryPointInterface.parseLog(log);
        } catch (e) {
          return null;
        }
      })
      .filter((event) => event !== null && event.name === "UserOperationEvent");

    if (userOpEvents.length > 0) {
      console.log("✅ SUCCESS: UserOperationEvent was emitted by EntryPoint!");
      const eventData = userOpEvents[0];
      if (eventData && eventData.args) {
        console.log("UserOperationEvent details:", eventData.args);

        // Check operation success flag
        const success = eventData.args[4]; // success is the 5th parameter (index 4)
        if (success) {
          console.log("✅ SUCCESS: UserOperation was executed successfully!");
        } else {
          console.log("❌ FAILURE: UserOperation execution failed!");
          console.log(
            "This might indicate an error in the Account contract or insufficient gas provided."
          );

          // Check if we can decode the revert reason
          if (receipt.status === 1) {
            console.log(
              "Note: Transaction succeeded at blockchain level, but the UserOperation itself failed."
            );
            console.log(
              "This typically means the EntryPoint processed the operation but the Account's execute function reverted."
            );
          }
        }
      }
    } else {
      console.log(
        "❌ FAILURE: No UserOperationEvent was emitted by EntryPoint!"
      );
    }
  } catch (error) {
    console.error("EntryPoint execution failed:", error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
