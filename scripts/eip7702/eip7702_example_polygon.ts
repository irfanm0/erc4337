import { ethers } from "ethers";
import EIP7702Delegate from "../../artifacts/contracts/EIP7702Delegate.sol/EIP7702Delegate.json";
import dotenv from "dotenv";

dotenv.config();

const POLYGON_RPC_URL = "https://dimensional-patient-card.matic.quiknode.pro/4881363ed657eafc1dfa4da1c551980e0ce6b9af/";
const PRIVATE_KEY_1 = process.env.PRIVATE_KEY!;
const PRIVATE_KEY_2 = process.env.DEV_PRIVATE_KEY!;

const TARGET_ADDRESS_1 = "0x9E864E196698cE11cB9374bA9f258f5e5c011c48";
const TARGET_ADDRESS_2 = "0x9E864E196698cE11cB9374bA9f258f5e5c011c48";
const DELEGATE_CONTRACT = "0xf4Be11bC7CF1Ca8cc69876Aa269f491Ee3ce2c7a";

const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
const delegatingAccount = new ethers.Wallet(PRIVATE_KEY_1, provider);
const sponsorAccount = new ethers.Wallet(PRIVATE_KEY_2, provider);

async function checkDelegationStatus(
  accountAddress: string,
  expectedDelegateAddress: string
): Promise<{
  isDelegated: boolean;
  isExpectedDelegate?: boolean;
  code: string;
  delegatedAddress?: string;
}> {
  console.log(`[Check] Checking delegation status for ${accountAddress}`);
  const code = await provider.getCode(accountAddress);
  console.log(`[Check] Account code: ${code}`);

  if (code === "0x") {
    console.log(`[Check] No delegation - account code is empty`);
    return { isDelegated: false, code };
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
      code,
      delegatedAddress: delegateAddress,
    };
  }

  console.log(`[Check] Unknown code format - not EIP-7702 delegation`);
  return { isDelegated: false, code };
}

type AuthorizationEntry = {
  chainId: bigint;
  address: string;
  nonce: bigint;
  signature: ethers.Signature;
};

async function createEIP7702Authorization(
  wallet: ethers.Wallet,
  delegateAddress: string,
  nonce: bigint,
  opts?: { chainIdOverride?: bigint }
): Promise<AuthorizationEntry> {
  const network = await provider.getNetwork();
  const chainId = opts?.chainIdOverride ?? BigInt(network.chainId);
  const normalizedDelegate = ethers.getAddress(delegateAddress);

  console.log(`[Auth] Creating EIP-7702 authorization for delegate: ${normalizedDelegate}`);
  console.log(`[Auth] Using nonce: ${nonce.toString()}`);
  console.log(`[Auth] Chain ID: ${chainId.toString()}`);

  const MAGIC = '0x05';
  const rlpData = ethers.encodeRlp([
    ethers.toBeHex(chainId),
    normalizedDelegate.toLowerCase(),
    ethers.toBeHex(nonce)
  ]);
  const digest = ethers.keccak256(ethers.concat([MAGIC, rlpData]));

  const signingKey = (wallet as any).signingKey
    ? (wallet as any).signingKey
    : new ethers.SigningKey(wallet.privateKey);

  const sig = signingKey.sign(digest);
  const signature = ethers.Signature.from(sig);

  const authorization: AuthorizationEntry = {
    chainId,
    address: normalizedDelegate,
    nonce,
    signature,
  };

  console.log(`[Auth] Authorization prepared:`, {
    chainId: authorization.chainId.toString(),
    address: authorization.address,
    nonce: authorization.nonce.toString(),
    yParity: authorization.signature.yParity,
    r: authorization.signature.r,
    s: authorization.signature.s,
  });

  return authorization;
}

async function sendDelegationTransaction(
  delegateTarget: string,
  txData: string,
  options?: { chainIdOverride?: bigint }
): Promise<AuthorizationEntry> {
  const currentNonceBigInt = BigInt(await provider.getTransactionCount(delegatingAccount.address));
  console.log(
    `[Delegate] Using nonce ${currentNonceBigInt.toString()} for delegation transaction`
  );

  const authorization = await createEIP7702Authorization(
    delegatingAccount,
    delegateTarget,
    currentNonceBigInt,
    options
  );

  const feeData = await provider.getFeeData();

  const delegationTx: any = {
    to: delegatingAccount.address,
    data: txData,
    value: 0,
    gasLimit: 500000,
    type: 4,
    authorizationList: [authorization],
  };

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    delegationTx.maxFeePerGas = feeData.maxFeePerGas;
    delegationTx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  } else if (feeData.gasPrice) {
    delegationTx.gasPrice = feeData.gasPrice;
  }

  console.log(`[Delegate] Sending delegation Type 4 transaction...`);
  const response = await sponsorAccount.sendTransaction(delegationTx);
  console.log(`[Delegate] Delegation transaction sent: ${response.hash}`);

  const receipt = await response.wait();
  console.log(`[Delegate] Delegation tx confirmed in block: ${receipt?.blockNumber}`);
  console.log(`[Delegate] Delegation tx status: ${receipt?.status}`);

  if (receipt?.status !== 1) {
    throw new Error(
      `Delegation transaction failed with status: ${receipt?.status}`
    );
  }

  return authorization;
}

async function ensureDelegation(
  txData: string,
  currentStatus?: {
    isDelegated: boolean;
    isExpectedDelegate?: boolean;
    code: string;
    delegatedAddress?: string;
  }
): Promise<{
  redelegated: boolean;
  status: {
    isDelegated: boolean;
    isExpectedDelegate?: boolean;
    code: string;
    delegatedAddress?: string;
  };
}> {
  const normalizedData = txData && txData !== "" ? txData : "0x";

  const initialStatus =
    currentStatus ??
    (await checkDelegationStatus(delegatingAccount.address, DELEGATE_CONTRACT));

  if (initialStatus.isDelegated && initialStatus.isExpectedDelegate) {
    console.log(
      `[Delegate] Account already delegated to expected contract ${DELEGATE_CONTRACT}`
    );
    return { redelegated: false, status: initialStatus };
  }

  console.log(
    `[Delegate] Re-delegating account ${delegatingAccount.address} to ${DELEGATE_CONTRACT}`
  );

  const zeroTarget = ethers.ZeroAddress;

  const attempts: Array<{
    label: string;
    target: string;
    chainIdOverride?: bigint;
    expectDelegate?: boolean;
    expectZero?: boolean;
  }> = [
    {
      label: 'clear-to-zero',
      target: zeroTarget,
      expectZero: true,
    },
    {
      label: 'assign-primary',
      target: DELEGATE_CONTRACT,
      expectDelegate: true,
    },
    {
      label: 'assign-fallback-chainId-0',
      target: DELEGATE_CONTRACT,
      chainIdOverride: 0n,
      expectDelegate: true,
    },
  ];

  for (const attempt of attempts) {
    console.log(`[Delegate] Attempting delegation (${attempt.label})...`);
    await sendDelegationTransaction(
      attempt.target,
      attempt.expectZero ? "0x" : normalizedData,
      attempt.chainIdOverride != null
        ? { chainIdOverride: attempt.chainIdOverride }
        : undefined
    );

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const updatedStatus = await checkDelegationStatus(
      delegatingAccount.address,
      DELEGATE_CONTRACT
    );

    if (attempt.expectZero) {
      if (updatedStatus.code === "0x" || updatedStatus.code === "0x0") {
        console.log(`[Delegate] ✅ Delegation cleared to zero address`);
        continue;
      }
      console.log(
        `[Delegate] Delegation clearing attempt (${attempt.label}) did not reset code`
      );
      continue;
    }

    if (updatedStatus.isDelegated && updatedStatus.isExpectedDelegate) {
      console.log(
        `[Delegate] ✅ Delegation now points to expected contract ${DELEGATE_CONTRACT}`
      );
      return { redelegated: true, status: updatedStatus };
    }

    console.log(
      `[Delegate] Delegation check after ${attempt.label} attempt is still mismatched`
    );
  }

  throw new Error(`Delegation still not pointing to expected contract after update`);
}

async function sendNonSponsoredTransaction(): Promise<void> {
  console.log(`\n=== EIP-7702 NON-SPONSORED TRANSACTION ===`);
  
  const delegationStatus = await checkDelegationStatus(
    delegatingAccount.address,
    DELEGATE_CONTRACT
  );
  console.log(
    `[NonSponsored] Delegated: ${delegationStatus.isDelegated}, expected delegate: ${delegationStatus.isExpectedDelegate}`
  );

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
  
  let txData = "0x";
  if (calls.length > 0) {
    const populatedTx = await delegateContract.executeDirect.populateTransaction(
      calls
    );
    txData = populatedTx.data ?? "0x";
  }

  console.log(`[NonSponsored] Transaction data prepared: ${txData.slice(0, 42)}...`);

  const delegationResult = await ensureDelegation(txData, delegationStatus);

  if (delegationResult.redelegated) {
    console.log(`[NonSponsored] ✅ Delegation updated via Type 4 transaction`);
    return;
  }

  console.log(`[NonSponsored] Account already has expected delegation, sending normal transaction...`);

  const normalTx = {
    to: delegatingAccount.address,
    data: txData,
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

async function sendSponsoredTransaction(): Promise<void> {
  console.log(`\n=== EIP-7702 SPONSORED TRANSACTION ===`);
  
  // Check if account is properly delegated
  const delegationStatus = await checkDelegationStatus(
    delegatingAccount.address,
    DELEGATE_CONTRACT
  );
  const ensureResult = await ensureDelegation("0x", delegationStatus);

  const finalDelegationStatus = ensureResult.status;

  if (!finalDelegationStatus.isDelegated) {
    throw new Error(`Account ${delegatingAccount.address} is not delegated via EIP-7702`);
  }

  if (!finalDelegationStatus.isExpectedDelegate) {
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
      ["address", "uint256", "uint256", "bytes32"],
      [delegatingAccount.address, chainId, currentNonce, callsHash]
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
    "execute((address,uint256,bytes)[],bytes)",
    [calls, signature]
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
  
  if (network.chainId !== 137n) {
    throw new Error(`Expected Polygon mainnet (chainId: 137), got chainId: ${network.chainId}`);
  }

  // Check initial balances
  const delegatingBalance = await provider.getBalance(delegatingAccount.address);
  const sponsorBalance = await provider.getBalance(sponsorAccount.address);
  console.log(`💳 Delegating account balance: ${ethers.formatEther(delegatingBalance)} POL`);
  console.log(`💳 Sponsor account balance: ${ethers.formatEther(sponsorBalance)} POL`);

  if (sponsorBalance === 0n) {
    throw new Error(`Sponsor account has no POL for gas fees`);
  }

  const hasDelegatorBalance = delegatingBalance > 0n;
  if (!hasDelegatorBalance) {
    console.log(
      `[Warn] Delegating account has 0 POL; will skip non-sponsored flow and rely entirely on sponsored transactions`
    );
  }

  // Verify delegate contract exists
  const delegateCode = await provider.getCode(DELEGATE_CONTRACT);
  if (delegateCode === "0x") {
    throw new Error(`Delegate contract not deployed at: ${DELEGATE_CONTRACT}`);
  }
  console.log(`✅ Delegate contract verified at: ${DELEGATE_CONTRACT}`);

  if (hasDelegatorBalance) {
    await sendNonSponsoredTransaction();
  } else {
    console.log(`[Main] Skipping non-sponsored execution because delegating account is empty`);
  }
  await sendSponsoredTransaction();

  console.log("🎉 EIP-7702 Demo completed successfully!");
}

main().catch((error) => {
  console.error("💥 EIP-7702 Demo failed:", error.message);
  console.error("Full error:", error);
  process.exit(1);
});
