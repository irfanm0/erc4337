import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

const smartAccount = process.env.SMART_ACCOUNT_FACTORY || ""; //smart account factory on bsc testnet
const entryPoint = process.env.ENTRY_POINT || ""; //entry point v8

async function main() {
  const paymaster = await ethers.getContractFactory("Paymaster");
  const paymasterContract = await paymaster.deploy(entryPoint, smartAccount);
  await paymasterContract.waitForDeployment();

  const paymasterAddress = await paymasterContract.getAddress();
  console.log("Paymaster deployed to:", paymasterAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
