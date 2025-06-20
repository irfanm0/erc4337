import { ethers } from "hardhat";

async function main() {
  const EntryPoint = await ethers.getContractFactory("EntryPoint");
  const entryPoint = await EntryPoint.deploy();
  await entryPoint.waitForDeployment();

  const entryPointAddress = await entryPoint.getAddress();
  console.log("EntryPoint deployed to:", entryPointAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
