import { ethers } from "ethers";
import EIP7702Delegate from "../../artifacts/contracts/EIP7702Delegate.sol/EIP7702Delegate.json";
import dotenv from "dotenv";

dotenv.config();

const HOLESKY_RPC_URL = process.env.HOLESKY_RPC_URL!;
const PRIVATE_KEY_1 = process.env.MERCHANT_PRIVATE_KEY!;
const PRIVATE_KEY_2 = process.env.PRIVATE_KEY!;

const TARGET_ADDRESS_1 = "0x541A53d783a90fb0224d86f90b366E8b33f63874";
const TARGET_ADDRESS_2 = "0x14A561f3FCC1efa259897BE672e5D9C0b5ba28ab";
const DELEGATE_CONTRACT = "0x434853b1A9a125803Bd0f547FA56A98e8f20Ff72";

const provider = new ethers.JsonRpcProvider(HOLESKY_RPC_URL);
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
  const delegationStatus = await checkDelegationStatus(
    delegatingAccount.address,
    DELEGATE_CONTRACT
  );

  const needsDelegation =
    !delegationStatus.isDelegated || !delegationStatus.isExpectedDelegate;

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
  // const calls: Array<{ target: string; value: bigint; data: string }> = [];

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
  if (needsDelegation) {
    const currentNonce = await delegatingAccount.getNonce();
    const authorization = await delegatingAccount.authorize({
      address: DELEGATE_CONTRACT,
      nonce: currentNonce + 1,
      chainId: 17000,
    });

    const eip7702Tx = {
      to: delegatingAccount.address,
      data: tx.data,
      value: 0,
      gasLimit: 300000,
      authorizationList: [authorization],
    };

    const response = await delegatingAccount.sendTransaction(eip7702Tx);
    await response.wait();
    console.log(`Non-sponsored transaction successful: ${response.hash}`);
  } else {
    const normalTx = {
      to: delegatingAccount.address,
      data: tx.data,
      value: 0,
      gasLimit: 300000,
    };

    const response = await delegatingAccount.sendTransaction(normalTx);
    await response.wait();
    console.log(`Non-sponsored transaction successful: ${response.hash}`);
  }
}

async function sendSponsoredTransaction(): Promise<void> {
  const calls = [
    {
      target: TARGET_ADDRESS_1,
      value: ethers.parseEther("0.01"),
      data: "0x",
    },
    {
      target: TARGET_ADDRESS_2,
      value: ethers.parseEther("0.01"),
      data: "0x",
    },
  ];

  const delegateContractRead = new ethers.Contract(
    delegatingAccount.address,
    EIP7702Delegate.abi,
    provider
  );
  const currentNonce = await delegateContractRead.getNonce();

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

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

  const response = await sponsorAccount.sendTransaction(finalTxRequest);
  await response.wait();
  console.log(`Sponsored transaction successful: ${response.hash}`);
}

async function main(): Promise<void> {
  try {
    console.log("Starting EIP-7702 Demo");
    console.log(`Delegating Account: ${delegatingAccount.address}`);
    console.log(`Sponsor Account: ${sponsorAccount.address}`);

    await sendNonSponsoredTransaction();
    await sendSponsoredTransaction();

    console.log("Demo completed successfully!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

main().catch(console.error);
