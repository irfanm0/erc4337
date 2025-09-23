import { ethers, run } from "hardhat";
import { expect } from "chai";
import { EIP7702Delegate } from "../../typechain-types";
import dotenv from "dotenv";

dotenv.config();

const ENTRY_POINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function main() {
  // Use your actual deployed addresses here
  const delegateAddress =
    process.env.DELEGATE_ADDRESS ||
    // "0x34515E7f26BE298979A8e68f5DA33efa87e4C748"; // sepolia addres
    // "0x434853b1A9a125803Bd0f547FA56A98e8f20Ff72"; // holesky
    // "0x3c291Eb0d1f7D7337dCB232b96DCC732728C15Ae" //bsc mainnet address
    // "0xf4Be11bC7CF1Ca8cc69876Aa269f491Ee3ce2c7a" //polygon address
    "0x4db9748a1706fd6d30A4032F16A573a61d53721B" //ethereum address

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
