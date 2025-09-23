import { ethers } from "ethers";
import axios from "axios";
import CryptoJS from "crypto-js";
import dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.DEV_PRIVATE_KEY!;

interface BroadcastApiResponse {
  code: string;
  msg?: string;
  data: Array<{
    orderId: string;
  }>;
}

enum Chain {
  "binance" = "56",
  "eth" = "1",
  "matic" = "137",
  "avalanche" = "43114",
  "base" = "8453",
}

enum UsdtAddress {
  "binance" = "0x55d398326f99059ff775485246999027b3197955",
  "eth" = "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "matic" = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
}

enum UsdcAddress {
  "binance" = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  "eth" = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "matic" = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
}

enum approvalContract {
  "eth" = "0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f",
  "binance" = "0x2c34A2Fb1d0b4f55de51E1d0bDEfaDDce6b7cDD6",
  "matic" = "0x3B86917369B83a6892f553609F3c2F439C184e31",
  "avalanche" = "0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f",
  "base" = "0x57df6092665eb6058DE53939612413ff4B09114E",
}

enum rpcUrl {
  "binance" = "https://bsc-dataseed1.bnbchain.org",
}

const baseUrl = "https://web3.okx.com/api/v5/";

export function getHeaders(
  timestamp: string,
  method: string,
  requestPath: string,
  queryString = "",
  body = ""
) {
  // Check https://web3.okx.com/zh-hans/web3/build/docs/waas/rest-authentication for api-key
  const apiKey = process.env.OKX_API_KEY;
  const secretKey = process.env.OKX_SECRET_KEY;
  const apiPassphrase = process.env.OKX_API_PASSPHRASE;
  const projectId = process.env.OKX_PROJECT_ID;

  if (!apiKey || !secretKey || !apiPassphrase || !projectId) {
    throw new Error("Missing required environment variables");
  }

  const stringToSign = timestamp + method + requestPath + queryString + body;
  return {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": CryptoJS.enc.Base64.stringify(
      CryptoJS.HmacSHA256(stringToSign, secretKey)
    ),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": apiPassphrase,
    "OK-ACCESS-PROJECT": projectId,
  };
}

async function checkAllowance(
  signer: ethers.Signer,
  tokenAddress: string,
  userAddress: string,
  spenderAddress: string
) {
  const tokenABI = [
    {
      constant: true,
      inputs: [
        { name: "_owner", type: "address" },
        { name: "_spender", type: "address" },
      ],
      name: "allowance",
      outputs: [{ name: "", type: "uint256" }],
      payable: false,
      stateMutability: "view",
      type: "function",
    },
  ];
  const tokenContract = new ethers.Contract(tokenAddress, tokenABI, signer);
  try {
    const allowance = await tokenContract.allowance(
      userAddress,
      spenderAddress
    );
    return BigInt(String(allowance));
  } catch (error) {
    console.error("Failed to query allowance:", error);
    throw error;
  }
}
async function getApproveTransaction(
  tokenAddress: string,
  amount: string,
  chainId: string
) {
  try {
    const path = "dex/aggregator/approve-transaction";
    const url = `${baseUrl}${path}`;
    const params = {
      chainId: chainId,
      tokenContractAddress: tokenAddress,
      approveAmount: amount,
    };

    // Prepare authentication
    const timestamp = new Date().toISOString();
    const requestPath = `/api/v5/${path}`;
    const queryString = "?" + new URLSearchParams(params).toString();
    const headers = getHeaders(timestamp, "GET", requestPath, queryString);

    const response = await axios.get(url, { params, headers });

    if (response.data.code === "0") {
      return response.data.data[0];
    } else {
      throw new Error(`API Error: ${response.data.msg || "Unknown error"}`);
    }
  } catch (error) {
    console.error(
      "Failed to get approval transaction data:",
      (error as Error).message
    );
    throw error;
  }
}

//this can be used to calculate the gas fees
async function getGasLimit(
  fromAddress: string,
  toAddress: string,
  amount: string = "0",
  inputData: string = "",
  chainId: string
): Promise<string> {
  try {
    const path = "dex/pre-transaction/gas-limit";
    const url = `https://web3.okx.com/api/v5/${path}`;

    const body = {
      chainIndex: chainId,
      fromAddress: fromAddress,
      toAddress: toAddress,
      txAmount: amount,
      extJson: {
        inputData: inputData,
      },
    };

    // Prepare authentication with body included in signature
    const bodyString = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const requestPath = `/api/v5/${path}`;
    const headers = getHeaders(timestamp, "POST", requestPath, "", bodyString);

    const response = await axios.post(url, body, { headers });

    if (response.data.code === "0") {
      return response.data.data[0].gasLimit;
    } else {
      throw new Error(`API Error: ${response.data.msg || "Unknown error"}`);
    }
  } catch (error) {
    console.error("Failed to get gas limit:", (error as Error).message);
    throw error;
  }
}

async function approveToken(
  signer: ethers.Signer,
  tokenAddress: string,
  amount: string,
  chain: string,
  userAddress: string
): Promise<string | null> {
  const spenderAddress =
    approvalContract[chain as keyof typeof approvalContract];
  const currentAllowance = await checkAllowance(
    signer,
    tokenAddress,
    userAddress,
    spenderAddress
  );
  console.log("currentAllowance", currentAllowance);
  if (currentAllowance >= BigInt(amount)) {
    console.log("Sufficient allowance already exists");
    return null;
  }
  const chainId = Chain[chain as keyof typeof Chain];
  const approveData = await getApproveTransaction(
    tokenAddress,
    amount,
    chainId
  );
  console.log("approveData", approveData);
  const nonce = await signer.provider!.getTransactionCount(userAddress);
  const txObject = {
    from: userAddress,
    to: tokenAddress,
    data: approveData.data,
    value: "0",
    gasLimit: approveData.gasLimit,
    gasPrice: approveData.gasPrice,
    nonce: nonce,
  };
  console.log("txObject", txObject);
  const tx = await signer.sendTransaction(txObject);
  console.log("tx", tx);
  const receipt = await tx.wait();
  return receipt?.hash || null;
}

async function getSwapQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  slippage: number,
  chainId: string
) {
  try {
    const path = "dex/aggregator/quote";
    const url = `${baseUrl}${path}`;
    const params = {
      chainId: chainId,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount: amount,
    };
    const timestamp = new Date().toISOString();
    const requestPath = `/api/v5/${path}`;
    const queryString = "?" + new URLSearchParams(params).toString();
    const headers = getHeaders(timestamp, "GET", requestPath, queryString);
    const response = await axios.get(url, { params, headers });
    if (response.data.code === "0") {
      return response.data.data[0];
    } else {
      throw new Error(`API Error: ${response.data.msg || "Unknown error"}`);
    }
  } catch (error) {
    console.error("Failed to get swap quote:", (error as Error).message);
    throw error;
  }
}

//slippage 0.005 is for 0.5%; 1 is for 100%
async function getSwapTransaction(
  fromToken: string,
  toToken: string,
  amount: string,
  slippage: string,
  chainId: string,
  userAddress: string
) {
  try {
    const path = "dex/aggregator/swap";
    const url = `${baseUrl}${path}`;

    const params = {
      chainId: chainId,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount,
      userWalletAddress: userAddress,
      slippage,
    };

    // Prepare authentication
    const timestamp = new Date().toISOString();
    const requestPath = `/api/v5/${path}`;
    const queryString = "?" + new URLSearchParams(params).toString();
    const headers = getHeaders(timestamp, "GET", requestPath, queryString);

    const response = await axios.get(url, { params, headers });

    if (response.data.code === "0") {
      return response.data.data[0];
    } else {
      throw new Error(`API Error: ${response.data.msg || "Unknown error"}`);
    }
  } catch (error) {
    console.error(
      "Failed to get swap transaction data:",
      (error as Error).message
    );
    throw error;
  }
}
async function getDecimal(signer: ethers.Signer, tokenAddress: string) {
  const tokenABI = [
    {
      constant: true,
      inputs: [],
      name: "decimals",
      outputs: [{ name: "", type: "uint8" }],
      payable: false,
      stateMutability: "view",
      type: "function",
    },
  ];
  const contract = new ethers.Contract(tokenAddress, tokenABI, signer);
  const decimals = await contract.decimals();
  return Number(decimals);
}

async function main() {
  const chain = "binance";
  const amount = 0.001;
  const slippage = 0.01;
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  const provider = new ethers.JsonRpcProvider(
    rpcUrl[chain as keyof typeof rpcUrl]
  );
  const signer = wallet.connect(provider);
  const amountWithDecimals =
    amount *
    10 **
      (await getDecimal(
        signer,
        UsdtAddress[chain as keyof typeof UsdtAddress]
      ));
  const quote = await getSwapQuote(
    UsdtAddress[chain as keyof typeof UsdtAddress],
    UsdcAddress[chain as keyof typeof UsdcAddress],
    amountWithDecimals.toString(),
    slippage,
    Chain[chain as keyof typeof Chain]
  );
  console.log("quote", quote);
  // const approvalTx =urovalTx", approvalTx);
  const tx = await getSwapTransaction(
    UsdtAddress.binance,
    UsdcAddress.binance,
    amountWithDecimals.toString(),
    slippage.toString(),
    Chain.binance,
    wallet.address
  );
  console.log("tx", tx.tx);
  // const nonce = await signer.provider!.getTransactionCount(wallet.address);
  // const signedTx = await buildAndSignTransaction(
  //   signer,
  //   tx,
  //   nonce,
  //   Chain.binance
  // );
  // console.log("signedTx", signedTx);
  // const broadcastTx = await broadcastTransaction(
  //   signer,
  //   signedTx,
  //   Chain.binance
  // );
  // console.log("broadcastTx", broadcastTx);clear

  const { maxPriorityFeePerGas, maxFeePerGas, ...txWithoutEIP1559 } = tx.tx; //can't include maxPriorityFeePerGas and maxFeePerGas, if we include it it will reverted
  const txSend = await signer.sendTransaction(txWithoutEIP1559);
  const receipt = await txSend.wait();
  console.log("txSend", receipt);
}

main().catch(console.error);
