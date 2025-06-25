import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// Minimal ABI for demonstration
const EIP7702DelegateABI = [
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
  "function addSessionKey(address sessionKey, uint256 validUntil, uint256 maxValue)",
  "function executeWithSessionKey(address target, uint256 value, bytes data)",
  "function getNonce(address account) external view returns (uint256)",
  "function isValidSessionKey(address sessionKey, address account) external view returns (bool)",
];

// EIP-7702 Constants
const SET_CODE_TX_TYPE = 0x04;

// Note: We now use ethers.js built-in authorization instead of manual construction

/**
 * Check if a wallet is delegated to EIP-7702
 */
async function checkDelegationStatus(
  provider: ethers.Provider,
  walletAddress: string,
  expectedDelegateAddress?: string
): Promise<{
  isDelegated: boolean;
  currentCode: string;
  delegateAddress?: string;
  isExpectedDelegate?: boolean;
}> {
  const code = await provider.getCode(walletAddress);

  if (code === "0x") {
    return { isDelegated: false, currentCode: code };
  }

  // Check if it's an EIP-7702 delegation designator format: 0xef0100{address}
  if (code.startsWith("0xef0100") && code.length === 48) {
    const delegateAddress = "0x" + code.slice(8); // Skip 0xef0100 (8 chars)

    const isExpectedDelegate = expectedDelegateAddress
      ? delegateAddress.toLowerCase() === expectedDelegateAddress.toLowerCase()
      : undefined;

    return {
      isDelegated: true,
      currentCode: code,
      delegateAddress,
      isExpectedDelegate,
    };
  }

  return { isDelegated: false, currentCode: code };
}

/**
 * Create an EIP-7702 authorization signature using ethers.js built-in method
 */
async function createAuthorization(
  signer: ethers.Wallet | ethers.HDNodeWallet,
  delegateAddress: string,
  nonce: bigint,
  chainId: bigint = 0n
): Promise<any> {
  // Use ethers.js built-in authorize method for EIP-7702
  const authorization = await signer.authorize({
    address: delegateAddress,
    nonce: Number(nonce),
    chainId: chainId === 0n ? undefined : Number(chainId),
  });

  return authorization;
}

/**
 * Actually execute batch operations with delegated EOA
 */
async function demonstrateBatching(delegate: ethers.Contract) {
  console.log(`\n💰 Executing batch operations...`);

  const simpleCalls = [
    {
      target: "0x742d35cc6440c45b8c566c64af4e6477d6c27bec",
      value: 0n,
      data: "0x",
    },
    {
      target: "0x0000000000000000000000000000000000000001",
      value: 0n,
      data: "0x",
    },
  ];

  try {
    const tx = await delegate.executeBatch(simpleCalls);
    const receipt = await tx.wait();
    console.log(`✅ Batch executed successfully! Gas: ${receipt.gasUsed}`);
  } catch (error) {
    console.log(`❌ Batch execution failed: ${(error as Error).message}`);
  }
}

/**
 * Actually add and use session keys
 */
async function demonstrateSessionKeys(
  delegate: ethers.Contract,
  provider: ethers.Provider,
  eoaAddress: string
) {
  console.log(`\n🔑 Adding session key...`);

  const sessionKey = ethers.Wallet.createRandom().connect(provider);
  const validUntil = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const maxValue = ethers.parseEther("0.1"); // 0.1 ETH

  try {
    const addTx = await delegate.addSessionKey(
      sessionKey.address,
      validUntil,
      maxValue
    );
    await addTx.wait();
    console.log(`✅ Session key added successfully!`);

    const isActive = await delegate.isValidSessionKey(
      sessionKey.address,
      eoaAddress
    );
    if (isActive) {
      console.log(`✅ Session key is ready for limited transactions`);
    }
  } catch (error) {
    console.log(`❌ Session key operation failed: ${(error as Error).message}`);
  }
}

/**
 * Generate a mock EIP-7702 setcode transaction structure
 */
function generateSetCodeTransaction(
  signer: ethers.Wallet,
  authorization: any,
  target: string = ethers.ZeroAddress,
  value: bigint = 0n,
  data: string = "0x"
) {
  const transaction = {
    type: SET_CODE_TX_TYPE, // 0x04
    chainId: authorization.chainId,
    to: target,
    value: value,
    data: data,
    authorizationList: [authorization],
  };

  return transaction;
}

/**
 * Actually submit the EIP-7702 setcode transaction to enable delegation
 */
async function enableDelegation(
  signer: ethers.Wallet,
  authorization: any,
  target: string = ethers.ZeroAddress,
  value: bigint = 0n,
  data: string = "0x"
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`🚀 Enabling delegation...`);

  try {
    const feeData = await signer.provider!.getFeeData();

    const transaction = {
      type: SET_CODE_TX_TYPE, // 0x04
      to: target,
      value: value,
      data: data,
      maxPriorityFeePerGas:
        feeData.maxPriorityFeePerGas || ethers.parseUnits("2", "gwei"),
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("20", "gwei"),
      gasLimit: 1000000n,
      authorizationList: [authorization],
    };

    const txResponse = await signer.sendTransaction(transaction);
    const receipt = await txResponse.wait();

    if (receipt?.status === 1) {
      console.log(`🎉 Delegation enabled successfully!`);
      return { success: true, txHash: txResponse.hash };
    } else {
      return { success: false, error: "Transaction failed" };
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.log(`❌ Failed to enable delegation: ${errorMessage}`);

    if (errorMessage.includes("unsupported transaction type")) {
      return {
        success: false,
        error: "EIP-7702 not supported by current network/client",
      };
    } else if (errorMessage.includes("insufficient funds")) {
      return { success: false, error: "Insufficient funds for gas" };
    } else {
      return { success: false, error: errorMessage };
    }
  }
}

/**
 * Revoke EIP-7702 delegation by setting delegate to zero address
 */
async function undelegate(
  signer: ethers.Wallet
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`🔄 Revoking delegation...`);

  try {
    const currentNonce = await signer.getNonce();

    const revokeAuth = await signer.authorize({
      address: ethers.ZeroAddress,
      nonce: currentNonce + 1,
      chainId: 17000,
    });

    const feeData = await signer.provider!.getFeeData();

    const transaction = {
      type: SET_CODE_TX_TYPE,
      to: signer.address,
      value: 0n,
      data: "0x",
      maxPriorityFeePerGas:
        feeData.maxPriorityFeePerGas || ethers.parseUnits("2", "gwei"),
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("20", "gwei"),
      gasLimit: 100000n,
      authorizationList: [revokeAuth],
    };

    const txResponse = await signer.sendTransaction(transaction);
    const receipt = await txResponse.wait();

    if (receipt?.status === 1) {
      console.log(`✅ Delegation revoked successfully!`);
      return { success: true, txHash: txResponse.hash };
    } else {
      return { success: false, error: "Transaction failed" };
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.log(`❌ Failed to revoke delegation: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

async function main() {
  console.log("=== EIP-7702 Wallet Delegation Demo ===\n");

  // Initialize provider and signer
  const provider = new ethers.JsonRpcProvider(process.env.HOLESKY_RPC_URL!);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

  // Create delegate contract instance
  const delegateAddress = "0x77779e1661d94046d3452f14Ce1246def602071A";
  const delegate = new ethers.Contract(
    signer.address,
    EIP7702DelegateABI,
    signer
  );

  console.log(`👤 Wallet: ${signer.address}`);
  console.log(`🎯 Delegate: ${delegateAddress}\n`);

  // Check if wallet is already delegated
  const delegationStatus = await checkDelegationStatus(
    provider,
    signer.address,
    delegateAddress
  );

  if (delegationStatus.isDelegated && delegationStatus.isExpectedDelegate) {
    console.log(`✅ Wallet is already delegated!`);

    // Execute actual batch operations and session keys
    await demonstrateBatching(delegate);
    await demonstrateSessionKeys(delegate, provider, signer.address);
    console.log(`\n🎉 Your wallet has smart contract capabilities!`);
  } else {
    console.log(`❌ Wallet is not delegated. Enabling delegation...`);

    const currentNonce = await signer.getNonce();

    // Create authorization signature
    const authorization = await createAuthorization(
      signer,
      delegateAddress,
      BigInt(currentNonce + 1),
      17000n
    );

    // Generate setcode transaction
    generateSetCodeTransaction(signer, authorization);

    // Enable delegation
    const result = await enableDelegation(signer, authorization);

    if (result.success) {
      console.log(`\n🎉 SUCCESS! Your wallet is now delegated!`);

      // Verify delegation status
      const newStatus = await checkDelegationStatus(
        provider,
        signer.address,
        delegateAddress
      );

      if (newStatus.isDelegated) {
        await demonstrateBatching(delegate);
        await demonstrateSessionKeys(delegate, provider, signer.address);
        console.log(`\n🎉 Your wallet now has smart contract capabilities!`);
      }
    } else {
      console.log(`\n❌ Delegation failed: ${result.error}`);
    }
  }

  // Uncomment to test undelegation:
  // const undelegateResult = await undelegate(signer);
}

main().catch(console.error);
