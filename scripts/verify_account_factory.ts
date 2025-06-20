import { ethers, run } from "hardhat";
import { expect } from "chai";
import { AccountFactory, Account } from "../typechain-types";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  // Use your actual deployed addresses here
  const accountFactoryAddress = process.env.SMART_ACCOUNT_FACTORY || ""; // Replace with your actual address
  const accountAddress = process.env.SMART_ACCOUNT || ""; // Replace with your actual address
  const entryPoint = process.env.ENTRY_POINT || ""; // Replace with your actual address

  const platformSigner = "0xC685a2d48Fae9D85aeFa34Ee09dB7c7F2bF5A47e";
  const merchantAddress = "0xae42fa2461bd0631e9E6b55558241FC6Cca20E78";
  const email = "irfan@email.com";

  // Get the contract instances
  const accountFactory = (await ethers.getContractAt(
    "AccountFactory",
    accountFactoryAddress
  )) as AccountFactory;
  const account = (await ethers.getContractAt(
    "Account",
    accountAddress
  )) as Account;

  console.log("Starting verification...");

  // Verify the platform signer is set correctly in the factory
  const factoryPlatformSigner = await accountFactory.platformSigner();
  console.log("Factory platform signer:", factoryPlatformSigner);
  if (factoryPlatformSigner.toLowerCase() === platformSigner.toLowerCase()) {
    console.log("✅ Platform signer correctly set in factory");

    // Verify contract on BSC Scan
    console.log("Verifying AccountFactory on BSC Scan...");
    try {
      await run("verify:verify", {
        address: accountFactoryAddress,
        constructorArguments: [platformSigner, entryPoint],
      });
      console.log("✅ AccountFactory verified on BSC Scan");
    } catch (error) {
      console.error("❌ AccountFactory verification failed:", error);
    }
  } else {
    console.log("❌ Platform signer mismatch in factory");
  }

  // Verify the account email is set correctly
  const storedEmail = await account.userEmail();
  console.log("Account email:", storedEmail);
  if (storedEmail === email) {
    console.log("✅ Email correctly set in account");
  } else {
    console.log("❌ Email mismatch in account");
  }

  // Test account lookup by email
  const retrievedAccount = await accountFactory.getAccounts(email);
  console.log("Retrieved account by email:", retrievedAccount);
  if (retrievedAccount.toLowerCase() === accountAddress.toLowerCase()) {
    console.log("✅ Account lookup by email works correctly");

    // Verify Account contract on BSC Scan
    console.log("Verifying Account on BSC Scan...");
    try {
      await run("verify:verify", {
        address: accountAddress,
        constructorArguments: [entryPoint,platformSigner, merchantAddress, email],
      });
      console.log("✅ Account verified on BSC Scan");
    } catch (error) {
      console.error("❌ Account verification failed:", error);
    }
  } else {
    console.log("❌ Account lookup by email failed");
  }

  console.log("Verification complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
