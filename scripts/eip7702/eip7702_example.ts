import { ethers } from "hardhat";
import {
  keccak256,
  AbiCoder,
  getBytes,
  Wallet,
} from "ethers";

// EIP-7702 Constants
const SET_CODE_TX_TYPE = 0x04;
const MAGIC = 0x05;

interface AuthorizationTuple {
  chainId: bigint;
  address: string;
  nonce: bigint;
  yParity: number;
  r: string;
  s: string;
}

interface Call {
  target: string;
  value: bigint;
  data: string;
}

/**
 * Create an EIP-7702 authorization signature
 * @param signer The EOA that will delegate
 * @param delegateAddress Address of the delegate contract
 * @param nonce Current nonce of the EOA
 * @param chainId Chain ID (0 for universal)
 */
async function createAuthorization(
  signer: Wallet,
  delegateAddress: string,
  nonce: bigint,
  chainId: bigint = 0n
): Promise<AuthorizationTuple> {
  // Create the message to sign: MAGIC || rlp([chain_id, address, nonce])
  const abiCoder = new AbiCoder();
  const encodedData = abiCoder.encode(
    ["uint256", "address", "uint64"],
    [chainId, delegateAddress, nonce]
  );

  // Create the hash with MAGIC prefix
  const magicBytes = new Uint8Array([MAGIC]);
  const dataBytes = getBytes(encodedData);
  const combined = new Uint8Array(magicBytes.length + dataBytes.length);
  combined.set(magicBytes);
  combined.set(dataBytes, magicBytes.length);

  const messageHash = keccak256(combined);

  // Sign the message
  const signature = signer.signingKey.sign(messageHash);

  return {
    chainId,
    address: delegateAddress,
    nonce,
    yParity: signature.yParity,
    r: signature.r,
    s: signature.s,
  };
}

/**
 * Submit an EIP-7702 setcode transaction
 * @param sponsor The account paying for the transaction
 * @param authorizations Array of authorization tuples
 * @param target Target address for the transaction (can be any address)
 * @param value ETH value to send
 * @param data Transaction data
 */
async function submitSetCodeTransaction(
  sponsor: Wallet,
  authorizations: AuthorizationTuple[],
  target: string = ethers.ZeroAddress,
  value: bigint = 0n,
  data: string = "0x"
) {
  // Note: This is a conceptual implementation
  // Actual EIP-7702 support would need to be implemented in the Ethereum client
  console.log("Submitting EIP-7702 transaction:");
  console.log("Sponsor:", sponsor.address);
  console.log("Authorizations:", authorizations);
  console.log("Target:", target);
  console.log("Value:", value.toString());
  console.log("Data:", data);

  // For now, we'll simulate the transaction structure
  const transaction = {
    type: SET_CODE_TX_TYPE,
    chainId: await sponsor.provider!.getNetwork().then((n) => n.chainId),
    nonce: await sponsor.getNonce(),
    maxPriorityFeePerGas: ethers.parseUnits("2", "gwei"),
    maxFeePerGas: ethers.parseUnits("20", "gwei"),
    gasLimit: 1000000n,
    to: target,
    value: value,
    data: data,
    authorizationList: authorizations,
  };

  console.log("Transaction structure:", transaction);
  return transaction;
}

/**
 * Example: Single delegate contract serving multiple EOAs
 */
async function demonstrateEIP7702() {
  console.log("=== EIP-7702 Demonstration ===\n");

  // Deploy the delegate contract (this happens once)
  const DelegateFactory = await ethers.getContractFactory("EIP7702Delegate");
  const delegate = await DelegateFactory.deploy();
  await delegate.waitForDeployment();
  const delegateAddress = await delegate.getAddress();

  console.log("🚀 Deployed delegate contract at:", delegateAddress);
  console.log("✅ This ONE contract can serve MULTIPLE EOAs!\n");

  // Create multiple EOAs that will delegate to the same contract
  const eoa1 = new ethers.Wallet(ethers.randomBytes(32).toString());
  const eoa2 = new ethers.Wallet(ethers.randomBytes(32).toString());
  const eoa3 = new ethers.Wallet(ethers.randomBytes(32).toString());

  console.log("👤 EOA 1:", eoa1.address);
  console.log("👤 EOA 2:", eoa2.address);
  console.log("👤 EOA 3:", eoa3.address);

  // Create authorizations for each EOA
  const auth1 = await createAuthorization(eoa1, delegateAddress, 0n);
  const auth2 = await createAuthorization(eoa2, delegateAddress, 0n);
  const auth3 = await createAuthorization(eoa3, delegateAddress, 0n);

  console.log("\n📝 Created authorizations for all EOAs");

  // A sponsor can submit all authorizations in one transaction!
  const [sponsor] = await ethers.getSigners();
  const setCodeTx = await submitSetCodeTransaction(sponsor as any, [
    auth1,
    auth2,
    auth3,
  ]);

  console.log("\n🎯 After setcode transaction:");
  console.log("- EOA1 code: 0xef0100" + delegateAddress.slice(2));
  console.log("- EOA2 code: 0xef0100" + delegateAddress.slice(2));
  console.log("- EOA3 code: 0xef0100" + delegateAddress.slice(2));
  console.log("- All point to the SAME delegate contract!");

  // Example usage: Batching with the delegated EOA
  console.log("\n💰 Example: EOA1 doing a batch transaction");

  const calls: Call[] = [
    {
      target: "0x1234567890123456789012345678901234567890",
      value: ethers.parseEther("0.1"),
      data: "0x",
    },
    {
      target: "0xA0b86991c431C76c1f3F4a2F1F61c2B5F0e8c6FA3", // USDC
      value: 0n,
      data: delegate.interface.encodeFunctionData("transfer", [
        "0x9876543210987654321098765432109876543210",
        1000000n, // 1 USDC
      ]),
    },
  ];

  console.log("Batch calls:", calls);
  console.log(
    "✅ This executes in the context of EOA1 but uses delegate logic!"
  );
}

/**
 * Example: Session keys for delegated EOAs
 */
async function demonstrateSessionKeys() {
  console.log("\n=== Session Keys Demo ===\n");

  const [deployer] = await ethers.getSigners();
  const DelegateFactory = await ethers.getContractFactory("EIP7702Delegate");
  const delegate = await DelegateFactory.deploy();
  await delegate.waitForDeployment();

  // Simulate EOA delegation (in practice this would be done via EIP-7702)
  const eoaOwner = new ethers.Wallet(ethers.randomBytes(32).toString());
  const sessionKey = new ethers.Wallet(ethers.randomBytes(32).toString());

  console.log("EOA Owner:", eoaOwner.address);
  console.log("Session Key:", sessionKey.address);

  // The EOA owner adds a session key (this would happen after delegation)
  const validUntil = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const maxValue = ethers.parseEther("0.1"); // 0.1 ETH limit

  console.log("Session key valid until:", new Date(validUntil * 1000));
  console.log(
    "Session key spending limit:",
    ethers.formatEther(maxValue),
    "ETH"
  );

  // Example of how the session key would be used
  console.log(
    "\n✨ Session key can now execute limited transactions on behalf of the EOA"
  );
}

// Main execution
async function main() {
  try {
    await demonstrateEIP7702();
    await demonstrateSessionKeys();
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
