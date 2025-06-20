import { ethers } from "hardhat";
import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const accountFactory = await ethers.getContractAt(
    "AccountFactory",
    process.env.SMART_ACCOUNT_FACTORY || ""
  );

  // Generate 100 random emails and addresses
  const emails = [];
  const addresses = [];

  for (let i = 0; i < 30; i++) {
    // Generate random email with format: user_X@example.com
    const randomEmail = `user_${Math.floor(
      Math.random() * 1000000
    )}@example.com`;

    // Generate random Ethereum address
    const wallet = ethers.Wallet.createRandom();
    const randomAddress = wallet.address;

    emails.push(randomEmail);
    addresses.push(randomAddress);
  }

  console.log(`Creating 100 accounts...`);
  const batch100Accounts = await accountFactory.batchCreateAccounts(
    emails,
    addresses,
    { gasLimit: 30000000 }
  );
  console.log("Batch accounts deployed to:", batch100Accounts);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
