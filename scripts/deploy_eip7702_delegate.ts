import { ethers } from "hardhat";

async function main() {
  console.log("Deploying EIP7702Delegate contract...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await deployer.provider.getBalance(deployer.address))
  );

  // Deploy the delegate contract
  const EIP7702Delegate = await ethers.getContractFactory("EIP7702Delegate");
  const delegate = await EIP7702Delegate.deploy();

  await delegate.waitForDeployment();
  const delegateAddress = await delegate.getAddress();

  console.log("✅ EIP7702Delegate deployed to:", delegateAddress);
  console.log("🎯 This contract can serve unlimited EOAs!");

  // Display useful information
  console.log("\n📋 Contract Info:");
  console.log("- Contract address:", delegateAddress);
  console.log(
    "- Delegation designator format: 0xef0100" + delegateAddress.slice(2)
  );

  console.log("\n🚀 Next steps:");
  console.log(
    "1. Users create authorization signatures pointing to:",
    delegateAddress
  );
  console.log("2. Submit setcode transactions with authorization lists");
  console.log("3. EOAs now execute code from this delegate contract!");

  return {
    delegate: delegateAddress,
    deployer: deployer.address,
  };
}

main()
  .then((result) => {
    console.log("\n✅ Deployment completed successfully!");
    console.log("Delegate contract:", result.delegate);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
