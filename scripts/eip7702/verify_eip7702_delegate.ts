import { ethers, run } from "hardhat";
import { expect } from "chai";
import { EIP7702Delegate } from "../../typechain-types";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  // Use your actual deployed addresses here
  const delegateAddress = process.env.DELEGATE_ADDRESS || "0xC5536B558F48750183554ecd4098ac508dC9e616"; // Replace with your actual address

  // Get the contract instances
  const delegate = (await ethers.getContractAt(
    "EIP7702Delegate",
    delegateAddress
  )) as EIP7702Delegate;

  console.log("Starting verification...");
    // Verify contract on BSC Scan
    console.log("Verifying EIP7702Delegate on Holesky Scan...");
    try {
      await run("verify:verify", {
        address: delegateAddress,
        constructorArguments: [],
      });
      console.log("✅ AccountFactory verified on BSC Scan");
    } catch (error) {
      console.error("❌ AccountFactory verification failed:", error);
    }
  console.log("Verification complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
