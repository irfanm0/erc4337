import { run } from "hardhat"
import dotenv from "dotenv"

dotenv.config()

async function main() {
  const tokenAddress = "0xABed0f84B84f52b6167b50CB7e6E3252EC82aA76"
  const name = "LBFC TOKEN"
  const symbol = "LBFC"
  const imageDataUri = "ipfs://bafkreibqkvmoxlst43fulrp75g5wy2g5enstvxgxxzw45svqhxkeklwnwm"

  if (!tokenAddress) throw new Error("MEMORIES_TOKEN is required")
  if (!imageDataUri) throw new Error("MEMORIES_IMAGE is required")

  console.log("Starting verification for MemoriesToken...")
  console.log("address:", tokenAddress)

  try {
    await run("verify:verify", {
      address: tokenAddress,
      constructorArguments: [name, symbol, imageDataUri]
    })
    console.log("✅ MemoriesToken verified")
  } catch (error) {
    console.error("❌ Verification failed:", error)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})


