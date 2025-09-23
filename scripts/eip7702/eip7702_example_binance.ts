import { ethers } from "ethers";
import EIP7702Delegate from "../../artifacts/contracts/EIP7702Delegate.sol/EIP7702Delegate.json";
import dotenv from "dotenv";

dotenv.config();

const BINANCE_RPC_URL = "https://bsc-dataseed.binance.org";
const PRIVATE_KEY_1 = process.env.PRIVATE_KEY!;
const PRIVATE_KEY_2 = process.env.DEV_PRIVATE_KEY!;

const TARGET_ADDRESS_1 = "0x9E864E196698cE11cB9374bA9f258f5e5c011c48";
const TARGET_ADDRESS_2 = "0x9E864E196698cE11cB9374bA9f258f5e5c011c48";
const DELEGATE_CONTRACT = "0x3c291Eb0d1f7D7337dCB232b96DCC732728C15Ae";

const provider = new ethers.JsonRpcProvider(BINANCE_RPC_URL);
const delegatingAccount = new ethers.Wallet(PRIVATE_KEY_1, provider);
const sponsorAccount = new ethers.Wallet(PRIVATE_KEY_2, provider);

async function checkDelegationStatus(
  accountAddress: string,
  expectedDelegateAddress: string
): Promise<{
  isDelegated: boolean;
  isExpectedDelegate?: boolean;
}> {
  console.log(`[Check] Checking delegation status for ${accountAddress}`);
  const code = await provider.getCode(accountAddress);
  console.log(`[Check] Account code: ${code}`);

  if (code === "0x") {
    console.log(`[Check] No delegation - account code is empty`);
    return { isDelegated: false };
  }

  // EIP-7702 delegation format: 0xef0100 + 20-byte address
  if (code.startsWith("0xef0100") && code.length === 48) {
    const delegateAddress = "0x" + code.slice(8);
    const isExpectedDelegate =
      delegateAddress.toLowerCase() === expectedDelegateAddress.toLowerCase();
    
    console.log(`[Check] Delegated to: ${delegateAddress}`);
    console.log(`[Check] Expected: ${expectedDelegateAddress}`);
    console.log(`[Check] Is expected delegate: ${isExpectedDelegate}`);

    return {
      isDelegated: true,
      isExpectedDelegate,
    };
  }

  console.log(`[Check] Unknown code format - not EIP-7702 delegation`);
  return { isDelegated: false };
}

async function createEIP7702Authorization(
  wallet: ethers.Wallet,
  delegateAddress: string,
  nonce: number
): Promise<any> {
  console.log(`[Auth] Creating EIP-7702 authorization for delegate: ${delegateAddress}`);
  console.log(`[Auth] Using nonce: ${nonce}`);
  
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`[Auth] Chain ID: ${chainId}`);

  // Try built-in authorize method first (if available in this ethers version)
  if (typeof (wallet as any).authorize === 'function') {
    console.log(`[Auth] Using built-in wallet.authorize method`);
    const authorization = await (wallet as any).authorize({
      address: delegateAddress,
      nonce: nonce,
      chainId: chainId,
    });
    console.log(`[Auth] Built-in authorization created successfully`);
    return authorization;
  }

  // Manual EIP-7702 authorization creation
  console.log(`[Auth] Built-in authorize not available, creating manual EIP-7702 authorization`);
  
  const signingKey = new ethers.SigningKey(wallet.privateKey);
  
  // EIP-7702 authorization signing format:
  // keccak256(MAGIC || rlp([chain_id, address, nonce]))
  const MAGIC = '0x05'; // EIP-7702 magic byte
  
  // RLP encode [chain_id, address, nonce]
  const rlpData = ethers.encodeRlp([
    ethers.toBeHex(chainId),
    delegateAddress.toLowerCase(),
    ethers.toBeHex(nonce)
  ]);
  
  // Create the digest: keccak256(MAGIC || rlp_data)
  const digest = ethers.keccak256(ethers.concat([MAGIC, rlpData]));
  
  const sig = signingKey.sign(digest);
  
  const authorization = {
    chainId: BigInt(chainId),
    address: delegateAddress,
    nonce: BigInt(nonce),
    yParity: sig.yParity,
    r: sig.r,
    s: sig.s
  };
  
  console.log(`[Auth] Manual EIP-7702 authorization created:`, {
    chainId: authorization.chainId.toString(),
    address: authorization.address,
    nonce: authorization.nonce.toString(),
    yParity: authorization.yParity
  });
  
  return authorization;
}

async function sendNonSponsoredTransaction(): Promise<void> {
  console.log(`\n=== EIP-7702 NON-SPONSORED TRANSACTION ===`);
  
  const delegationStatus = await checkDelegationStatus(
    delegatingAccount.address,
    DELEGATE_CONTRACT
  );

  const needsDelegation =
    !delegationStatus.isDelegated || !delegationStatus.isExpectedDelegate;

  console.log(`[NonSponsored] Needs EIP-7702 delegation: ${needsDelegation}`);

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
  
  let tx;
  if (calls.length > 0) {
    tx = await delegateContract.executeDirect.populateTransaction(calls);
  } else {
    tx = {
      data: "0x",
    };
  }

  console.log(`[NonSponsored] Transaction data prepared: ${tx.data?.slice(0, 42)}...`);

  if (needsDelegation) {
    console.log(`[NonSponsored] Performing EIP-7702 delegation injection...`);
    
    const currentNonce = await delegatingAccount.getNonce();
    console.log(`[NonSponsored] Current nonce: ${currentNonce}`);
    
    // Create EIP-7702 authorization with SAME nonce as transaction
    const authorization = await createEIP7702Authorization(
      delegatingAccount,
      DELEGATE_CONTRACT,
      currentNonce
    );

    // Get fee data
    const feeData = await provider.getFeeData();
    console.log(`[NonSponsored] Fee data:`, {
      gasPrice: feeData.gasPrice?.toString(),
      maxFeePerGas: feeData.maxFeePerGas?.toString()
    });

    // Create EIP-7702 transaction (TYPE 4)
    const eip7702Tx: any = {
      to: delegatingAccount.address,
      data: tx.data,
      value: 0,
      gasLimit: 500000,
      nonce: currentNonce,
      type: 4, // STRICT EIP-7702 transaction type
      authorizationList: [authorization],
    };

    // Add appropriate fee fields
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      eip7702Tx.maxFeePerGas = feeData.maxFeePerGas;
      eip7702Tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else if (feeData.gasPrice) {
      eip7702Tx.gasPrice = feeData.gasPrice;
    }

    console.log(`[NonSponsored] Sending EIP-7702 Type 4 transaction...`);
    console.log(`[NonSponsored] Tx details:`, {
      type: eip7702Tx.type,
      to: eip7702Tx.to,
      gasLimit: eip7702Tx.gasLimit?.toString(),
      authListLength: eip7702Tx.authorizationList?.length,
      hasGasPrice: !!eip7702Tx.gasPrice,
      hasMaxFeePerGas: !!eip7702Tx.maxFeePerGas
    });

    const response = await delegatingAccount.sendTransaction(eip7702Tx);
    console.log(`[NonSponsored] EIP-7702 transaction sent: ${response.hash}`);
    
    const receipt = await response.wait();
    console.log(`[NonSponsored] Transaction confirmed in block: ${receipt?.blockNumber}`);
    console.log(`[NonSponsored] Gas used: ${receipt?.gasUsed}`);
    console.log(`[NonSponsored] Transaction status: ${receipt?.status}`);
    
    if (receipt?.status !== 1) {
      throw new Error(`EIP-7702 delegation transaction failed with status: ${receipt?.status}`);
    }
    
    // Verify delegation worked
    const newCode = await provider.getCode(delegatingAccount.address);
    console.log(`[NonSponsored] Account code after delegation: ${newCode}`);
    
    if (newCode === "0x" || newCode === "0x00") {
      throw new Error(`EIP-7702 delegation failed - account code is still empty`);
    }
    
    if (!newCode.startsWith("0xef0100")) {
      throw new Error(`EIP-7702 delegation failed - account code doesn't match EIP-7702 format`);
    }
    
    console.log(`[NonSponsored] ✅ EIP-7702 delegation successful: ${response.hash}`);
  } else {
    console.log(`[NonSponsored] Account already has EIP-7702 delegation, sending normal transaction...`);
    
    const normalTx = {
      to: delegatingAccount.address,
      data: tx.data,
      value: 0,
      gasLimit: 300000,
    };

    const response = await delegatingAccount.sendTransaction(normalTx);
    const receipt = await response.wait();
    
    if (receipt?.status !== 1) {
      throw new Error(`Normal transaction failed with status: ${receipt?.status}`);
    }
    
    console.log(`[NonSponsored] ✅ Normal transaction successful: ${response.hash}`);
  }
}

async function sendSponsoredTransaction(): Promise<void> {
  console.log(`\n=== EIP-7702 SPONSORED TRANSACTION ===`);
  
  // Check if account is properly delegated
  const delegationStatus = await checkDelegationStatus(
    delegatingAccount.address,
    DELEGATE_CONTRACT
  );
  
  if (!delegationStatus.isDelegated) {
    throw new Error(`Account ${delegatingAccount.address} is not delegated via EIP-7702`);
  }
  
  if (!delegationStatus.isExpectedDelegate) {
    throw new Error(`Account is delegated but not to the expected contract. Expected: ${DELEGATE_CONTRACT}`);
  }
  
  console.log(`[Sponsored] ✅ Account has proper EIP-7702 delegation`);

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
  console.log(`[Sponsored] Delegate contract nonce: ${currentNonce}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  console.log(`[Sponsored] Execution deadline: ${deadline}`);

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
      [
        delegatingAccount.address,
        chainId,
        currentNonce,
        deadline,
        callsHash,
      ]
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
  
  console.log(`[Sponsored] Signature created for EIP-7702 sponsored execution`);

  const delegateInterface = new ethers.Interface(EIP7702Delegate.abi);
  const txData = delegateInterface.encodeFunctionData(
    "execute((address,uint256,bytes)[],uint256,bytes)",
    [calls, deadline, signature]
  );

  const finalTxRequest = {
    to: delegatingAccount.address, // Send to the delegated account
    data: txData,
    value: 0,
    gasLimit: 400000,
  };

  console.log(`[Sponsored] Sending EIP-7702 sponsored transaction...`);
  const response = await sponsorAccount.sendTransaction(finalTxRequest);
  console.log(`[Sponsored] Transaction sent: ${response.hash}`);
  
  const receipt = await response.wait();
  console.log(`[Sponsored] Transaction confirmed in block: ${receipt?.blockNumber}`);
  console.log(`[Sponsored] Gas used: ${receipt?.gasUsed}`);
  console.log(`[Sponsored] Transaction status: ${receipt?.status}`);
  
  if (receipt?.status !== 1) {
    throw new Error(`EIP-7702 sponsored transaction failed with status: ${receipt?.status}`);
  }
  
  console.log(`[Sponsored] ✅ EIP-7702 sponsored transaction successful: ${response.hash}`);
}

async function main(): Promise<void> {
  console.log("🚀 Starting STRICT EIP-7702 Demo on BSC");
  console.log(`📋 Delegating Account: ${delegatingAccount.address}`);
  console.log(`💰 Sponsor Account: ${sponsorAccount.address}`);
  console.log(`🎯 Delegate Contract: ${DELEGATE_CONTRACT}`);
  
  const network = await provider.getNetwork();
  console.log(`🌐 Network: ${network.name} (Chain ID: ${network.chainId})`);
  
  if (network.chainId !== 56n) {
    throw new Error(`Expected BSC mainnet (chainId: 56), got chainId: ${network.chainId}`);
  }

  // Check initial balances
  const delegatingBalance = await provider.getBalance(delegatingAccount.address);
  const sponsorBalance = await provider.getBalance(sponsorAccount.address);
  console.log(`💳 Delegating account balance: ${ethers.formatEther(delegatingBalance)} BNB`);
  console.log(`💳 Sponsor account balance: ${ethers.formatEther(sponsorBalance)} BNB`);

  if (delegatingBalance === 0n) {
    throw new Error(`Delegating account has no BNB for gas fees`);
  }

  if (sponsorBalance === 0n) {
    throw new Error(`Sponsor account has no BNB for gas fees`);
  }

  // Verify delegate contract exists
  const delegateCode = await provider.getCode(DELEGATE_CONTRACT);
  if (delegateCode === "0x") {
    throw new Error(`Delegate contract not deployed at: ${DELEGATE_CONTRACT}`);
  }
  console.log(`✅ Delegate contract verified at: ${DELEGATE_CONTRACT}`);

  await sendNonSponsoredTransaction();
  await sendSponsoredTransaction();

  console.log("🎉 EIP-7702 Demo completed successfully!");
}

main().catch((error) => {
  console.error("💥 EIP-7702 Demo failed:", error.message);
  console.error("Full error:", error);
  process.exit(1);
});
