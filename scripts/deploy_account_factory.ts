import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const entryPoint = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"; //entrypoint for bsc testnet
  const platformSigner = "0xC685a2d48Fae9D85aeFa34Ee09dB7c7F2bF5A47e";
  const email = "irfan@email.com";
  // Merchant address - the wallet that will control this account
  const merchantAddress = "0xae42fa2461bd0631e9E6b55558241FC6Cca20E78";

  const accountFactoryContract = await ethers.getContractFactory(
    "AccountFactory"
  );
  const accountContract = await ethers.getContractFactory("Account");

  const accountFactoryDeploy = await accountFactoryContract.deploy(
    platformSigner,
    entryPoint,
    {
      gasLimit: 8000000, // 8M gas limit
      gasPrice: ethers.parseUnits("5", "gwei"), // 5 gwei
    }
  );
  await accountFactoryDeploy.waitForDeployment();

  const accountFactoryAddress = await accountFactoryDeploy.getAddress();
  console.log("AccountFactory deployed to:", accountFactoryAddress);

  // Attach to the deployed contract with proper interface
  const accountFactory = accountFactoryDeploy;

  const accountDeploy = await accountFactory.createAccount(
    email,
    merchantAddress
  );
  const receipt = await accountDeploy.wait();
  console.log("Receipt:", receipt?.logs[0]?.address);
  const accountAddress = await accountFactory.getAccounts(email);
  console.log("Account deployed to:", accountAddress);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
