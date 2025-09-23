import { ethers } from "hardhat"

async function main() {
  const name = "LBFC TOKEN"
  const symbol = "LBFC"
  const imageDataUri = "ipfs://bafkreibqkvmoxlst43fulrp75g5wy2g5enstvxgxxzw45svqhxkeklwnwm"

  const MemoriesToken = await ethers.getContractFactory("MemoriesToken")
  const contract = await MemoriesToken.deploy(name, symbol, imageDataUri)
  await contract.waitForDeployment()

  const address = await contract.getAddress()
  console.log("MemoriesToken deployed to:", address)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})


