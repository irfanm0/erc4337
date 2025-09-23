import { ethers } from "ethers";
import EIP7702Delegate from "../../artifacts/contracts/EIP7702Delegate.sol/EIP7702Delegate.json";
import dotenv from "dotenv";

dotenv.config();

// Use official Polygon RPC
const POLYGON_RPC_URL = "https://polygon-rpc.com";
const PRIVATE_KEY_1 = process.env.PRIVATE_KEY!;
const PRIVATE_KEY_2 = process.env.DEV_PRIVATE_KEY!;

const TARGET_ADDRESS_1 = "0x9E864E196698cE11cB9374bA9f258f5e5c011c48";
const TARGET_ADDRESS_2 = "0x9E864E196698cE11cB9374bA9f258f5e5c011c48";
const DELEGATE_CONTRACT = "0x17828f983d83aEcA76979362f26065DD76F3e36a";

const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
const delegatingAccount = new ethers.Wallet(PRIVATE_KEY_1, provider);
const sponsorAccount = new ethers.Wallet(PRIVATE_KEY_2, provider);

async function checkDelegationStatus(
  accountAddress: string,
  expectedDelegateAddress: string
): Promise<{
  isDelegated: boolean;
  isExpectedDelegate?: boolean;
}> {
  const code = await provider.getCode(accountAddress);

  if (code === "0x") {
    return { isDelegated: false };
  }

  if (code.startsWith("0xef0100") && code.length === 48) {
    const delegateAddress = "0x" + code.slice(8);
    const isExpectedDelegate =
      delegateAddress.toLowerCase() === expectedDelegateAddress.toLowerCase();

    return {
      isDelegated: true,
      isExpectedDelegate,
    };
  }

  return { isDelegated: false };
}

async function sendNonSponsoredTransaction(): Promise<void> {
  console.log("=== Installing EIP-7702 Delegation ===");
  
  const delegationStatus = await checkDelegationStatus(
    delegatingAccount.address,
    DELEGATE_CONTRACT
  );

  const needsDelegation =
    !delegationStatus.isDelegated || !delegationStatus.isExpectedDelegate;

  console.log(`Needs delegation: ${needsDelegation}`);

  if (!needsDelegation) {
    console.log("Account already delegated, skipping...");
    return;
  }

  const calls = [
    {
      target: TARGET_ADDRESS_1,
      value: ethers.parseEther("0.001"),
      data: "0x",
    },
    {
      target: TARGET_ADDRESS_2,
      value: ethers.parseEther("0.001"),
      data: "0x",
    },
  ];

  const delegateContract = new ethers.Contract(
    DELEGATE_CONTRACT,
    EIP7702Delegate.abi,
    delegatingAccount
  );
  
  const tx = await delegateContract.executeDirect.populateTransaction(calls);

  const currentNonce = await delegatingAccount.getNonce();
  
  // Use ethers built-in authorization (should work with Polygon post-Bhilai)
  const authorization = await delegatingAccount.authorize({
    address: DELEGATE_CONTRACT,
    nonce: currentNonce + 1,
    chainId: 137, // Polygon mainnet
  });

  const eip7702Tx = {
    to: delegatingAccount.address,
    data: tx.data,
    value: 0,
    gasLimit: 300000,
    authorizationList: [authorization],
  };

  console.log("Sending EIP-7702 delegation transaction...");
  const response = await delegatingAccount.sendTransaction(eip7702Tx);
  await response.wait();
  console.log(`Delegation successful: ${response.hash}`);
  
  // Verify delegation
  const newCode = await provider.getCode(delegatingAccount.address);
  console.log(`Account code after delegation: ${newCode}`);
}

async function sendSponsoredTransaction(): Promise<void> {
  console.log("=== Sending Sponsored Transaction ===");
  
  // Verify delegation
  const delegationStatus = await checkDelegationStatus(
    delegatingAccount.address,
    DELEGATE_CONTRACT
  );
  
  if (!delegationStatus.isDelegated || !delegationStatus.isExpectedDelegate) {
    throw new Error("Account not properly delegated");
  }

  const calls = [
    {
      target: TARGET_ADDRESS_1,
      value: ethers.parseEther("0.001"),
      data: "0x",
    },
    {
      target: TARGET_ADDRESS_2,
      value: ethers.parseEther("0.001"),
      data: "0x",
    },
  ];

  const delegateContractRead = new ethers.Contract(
    delegatingAccount.address,
    EIP7702Delegate.abi,
    provider
  );
  
  const currentNonce = await delegateContractRead.getNonce();
  console.log(`Current nonce: ${currentNonce}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  console.log(`Execution deadline: ${deadline}`);

  const callsArray = calls.map((call) => [call.target, call.value, call.data]);

  const network = await provider.getNetwork();
  const chainId = network.chainId;

  const callsHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["(address,uint256,bytes)[]"],
      [callsArray]
    )
  );

  const typedHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "uint256", "bytes32"],
      [delegatingAccount.address, chainId, currentNonce, deadline, callsHash]
    )
  );

  const digest = ethers.keccak256(
    ethers.concat([
      ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n32"),
      typedHash,
    ])
  );

  const signingKey = new ethers.SigningKey(delegatingAccount.privateKey);
  const signature = signingKey.sign(digest).serialized;

  const delegateInterface = new ethers.Interface(EIP7702Delegate.abi);
  const txData = delegateInterface.encodeFunctionData(
    "execute((address,uint256,bytes)[],uint256,bytes)",
    [calls, deadline, signature]
  );

  const finalTxRequest = {
    to: delegatingAccount.address,
    data: txData,
    value: 0,
    gasLimit: 300000,
  };

  console.log("Sending sponsored transaction...");
  const response = await sponsorAccount.sendTransaction(finalTxRequest);
  await response.wait();
  console.log(`Sponsored transaction successful: ${response.hash}`);
}

async function main(): Promise<void> {
  try {
    console.log("🚀 Starting EIP-7702 Demo on Polygon (post-Bhilai)");
    console.log(`Delegating Account: ${delegatingAccount.address}`);
    console.log(`Sponsor Account: ${sponsorAccount.address}`);
    console.log(`Delegate Contract: ${DELEGATE_CONTRACT}`);

    const network = await provider.getNetwork();
    console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);

    if (network.chainId !== 137n) {
      throw new Error(`Expected Polygon mainnet (137), got: ${network.chainId}`);
    }

    // Check balances
    const delegatingBalance = await provider.getBalance(delegatingAccount.address);
    const sponsorBalance = await provider.getBalance(sponsorAccount.address);
    console.log(`Delegating balance: ${ethers.formatEther(delegatingBalance)} MATIC`);
    console.log(`Sponsor balance: ${ethers.formatEther(sponsorBalance)} MATIC`);

    if (delegatingBalance === 0n || sponsorBalance === 0n) {
      throw new Error("Insufficient MATIC balance");
    }

    // Verify delegate contract
    const delegateCode = await provider.getCode(DELEGATE_CONTRACT);
    if (delegateCode === "0x") {
      throw new Error(`Delegate contract not found at: ${DELEGATE_CONTRACT}`);
    }

    await sendNonSponsoredTransaction();
    await sendSponsoredTransaction();

    console.log("✅ Demo completed successfully!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
    throw error;
  }
}

main().catch(console.error);
