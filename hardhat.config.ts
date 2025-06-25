import { HardhatUserConfig } from "hardhat/config";
import {
  ETH_RPC_URL,
  POLYGON_RPC_URL,
  BINANCE_RPC_URL,
  SEPOLIA_RPC_URL,
  HOLESKY_RPC_URL,
} from "./rpcList";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";

dotenv.config();

const FORK_NETWORK = "ethereum";

const forkingConfig = {
  ethereum: {
    url: ETH_RPC_URL,
    blockNumber: 22337449,
    chainId: 1,
  },
  polygon: {
    url: POLYGON_RPC_URL,
    blockNumber: 70685817,
    chainId: 137,
  },
  binance: {
    url: BINANCE_RPC_URL,
    blockNumber: 48631395,
    chainId: 56,
  },
  sepolia: {
    url: SEPOLIA_RPC_URL,
    blockNumber: 22337449,
    chainId: 11155111,
  },
};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "prague",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: forkingConfig[FORK_NETWORK].url,
        blockNumber: forkingConfig[FORK_NETWORK].blockNumber,
        enabled: true,
      },
      chains: {
        1: {
          hardforkHistory: {
            cancun: 22337449,
          },
        },
        137: {
          hardforkHistory: {
            london: 70685817,
          },
        },
        56: {
          hardforkHistory: {
            london: 48631395,
          },
        },
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      gasPrice: 1000000000, // 1 gwei
      gas: 6000000,
      gasMultiplier: 2,
    },
    bscTestnet: {
      url:
        process.env.BSC_TESTNET_URL ||
        "https://data-seed-prebsc-1-s1.binance.org:8545",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 97,
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_URL || "https://bsc-dataseed.binance.org",
      accounts: process.env.DEV_PRIVATE_KEY
        ? [process.env.DEV_PRIVATE_KEY]
        : [],
      chainId: 56,
    },
    holesky: {
      url: HOLESKY_RPC_URL,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 17000,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 11155111,
    },
    // ethereum: {
    //   url: ETH_RPC_URL,
    //   accounts: [process.env.PRIVATE_KEY!],
    // },
    // sepolia: {
    //   url: SEPOLIA_RPC_URL,
    //   accounts: [process.env.PRIVATE_KEY!],
    // },
  },
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      holesky: process.env.ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
  },
};

export default config;
