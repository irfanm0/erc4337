import { run } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  // Use your actual deployed addresses here
  const smartAccount = process.env.SMART_ACCOUNT_FACTORY || ""; //smart account factory on bsc testnet
  const entryPoint = process.env.ENTRY_POINT || ""; //entry point v8
  const paymasterAddress = process.env.PAYMASTER || ""; //paymaster on bsc testnet

  console.log("Starting verification...");

  // Verify contract on BSC Scan
  console.log("Verifying Paymaster on BSC Scan...");
  console.log("entryPoint", entryPoint);
  console.log("smartAccount", smartAccount);
  console.log("paymasterAddress", paymasterAddress);
  try {
    await run("verify:verify", {
      address: paymasterAddress,
      constructorArguments: [entryPoint, smartAccount],
    });
    console.log("✅ Paymaster verified on BSC Scan");
  } catch (error) {
    console.error("❌ Paymaster verification failed:", error);
  }
  console.log("Verification complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
