import { ethers } from "ethers";
import EIP7702Delegate from "../../artifacts/contracts/EIP7702Delegate.sol/EIP7702Delegate.json";
import dotenv from "dotenv";

dotenv.config();

// ============================================
// CONFIGURATION - Edit these values
// ============================================

interface NetworkConfig {
  name: string;
  rpcUrl: string;
  wsUrl?: string; // Optional WebSocket for real-time monitoring
  explorerUrl: string;
  chainId: number;
}

interface MonitoredAccount {
  address: string;
  label: string;
  network: string;
}

// Add your networks here
const NETWORKS: Record<string, NetworkConfig> = {
  polygon: {
    name: "Polygon",
    rpcUrl: "https://polygon-rpc.com",
    wsUrl: "wss://polygon-bor-rpc.publicnode.com",
    explorerUrl: "https://polygonscan.com",
    chainId: 137,
  },
  ethereum: {
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    wsUrl: "wss://ethereum-rpc.publicnode.com",
    explorerUrl: "https://etherscan.io",
    chainId: 1,
  },
  bsc: {
    name: "BSC",
    rpcUrl: "https://bsc-dataseed.binance.org",
    wsUrl: "wss://bsc-rpc.publicnode.com",
    explorerUrl: "https://bscscan.com",
    chainId: 56,
  },
};

// Your delegate contract address
const DELEGATE_CONTRACT = "0xbbe94AfA7754531aBA2F2D430FCAd1cf3a62adDA";

// Add accounts to monitor here
const MONITORED_ACCOUNTS: MonitoredAccount[] = [
  {
    address: "0x6C527bCfA56b5Bc73634dd70de89bbEffC2e088E",
    label: "Delegated EOA #1",
    network: "polygon",
  },
  // Add more accounts as needed:
  // {
  //   address: "0x...",
  //   label: "My Main Wallet",
  //   network: "polygon",
  // },
];

// Alert thresholds
const ALERT_CONFIG = {
  // Alert if balance drops by more than this amount (in native token)
  balanceDropThreshold: 0.1,
  // Alert if nonce increases by more than 1 in a single check
  nonceJumpThreshold: 1,
  // Check interval in milliseconds
  checkIntervalMs: 30000, // 30 seconds
  // Enable Telegram alerts (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env)
  enableTelegram: false,
  // Enable Discord alerts (set DISCORD_WEBHOOK_URL in .env)
  enableDiscord: false,
};

// ============================================
// TYPES
// ============================================

interface AccountState {
  balance: bigint;
  nonce: number;
  delegateNonce: bigint;
  isDelegated: boolean;
  delegatedTo: string | null;
  lastChecked: Date;
}

interface Alert {
  type: "BALANCE_DROP" | "NONCE_JUMP" | "DELEGATION_CHANGE" | "SUSPICIOUS_TX" | "ERROR";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  account: string;
  network: string;
  message: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

// ============================================
// MONITORING CLASS
// ============================================

class EIP7702Monitor {
  private providers: Record<string, ethers.JsonRpcProvider> = {};
  private wsProviders: Record<string, ethers.WebSocketProvider> = {};
  private accountStates: Map<string, AccountState> = new Map();
  private alerts: Alert[] = [];
  private isRunning = false;

  constructor() {
    // Initialize providers for each network
    for (const [key, config] of Object.entries(NETWORKS)) {
      this.providers[key] = new ethers.JsonRpcProvider(config.rpcUrl);
      if (config.wsUrl) {
        try {
          this.wsProviders[key] = new ethers.WebSocketProvider(config.wsUrl);
        } catch (e) {
          console.log(`[${config.name}] WebSocket not available, using polling`);
        }
      }
    }
  }

  // ============================================
  // CORE MONITORING FUNCTIONS
  // ============================================

  async checkDelegationStatus(
    address: string,
    network: string
  ): Promise<{ isDelegated: boolean; delegatedTo: string | null }> {
    const provider = this.providers[network];
    const code = await provider.getCode(address);

    if (code === "0x" || code === "0x0") {
      return { isDelegated: false, delegatedTo: null };
    }

    // EIP-7702 format: 0xef0100 + 20-byte address
    if (code.startsWith("0xef0100") && code.length === 48) {
      const delegatedTo = "0x" + code.slice(8);
      return { isDelegated: true, delegatedTo };
    }

    return { isDelegated: false, delegatedTo: null };
  }

  async getAccountState(
    address: string,
    network: string
  ): Promise<AccountState> {
    const provider = this.providers[network];

    const [balance, nonce, delegationStatus] = await Promise.all([
      provider.getBalance(address),
      provider.getTransactionCount(address),
      this.checkDelegationStatus(address, network),
    ]);

    let delegateNonce = 0n;
    if (delegationStatus.isDelegated) {
      try {
        const delegateContract = new ethers.Contract(
          address,
          EIP7702Delegate.abi,
          provider
        );
        delegateNonce = await delegateContract.getNonce();
      } catch (e) {
        // Contract might not have getNonce function
      }
    }

    return {
      balance,
      nonce,
      delegateNonce,
      isDelegated: delegationStatus.isDelegated,
      delegatedTo: delegationStatus.delegatedTo,
      lastChecked: new Date(),
    };
  }

  async checkForChanges(account: MonitoredAccount): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const stateKey = `${account.network}:${account.address}`;
    const previousState = this.accountStates.get(stateKey);
    
    try {
      const currentState = await this.getAccountState(account.address, account.network);

      if (previousState) {
        // Check for balance drop
        const balanceDiff = previousState.balance - currentState.balance;
        const threshold = ethers.parseEther(ALERT_CONFIG.balanceDropThreshold.toString());
        
        if (balanceDiff > threshold) {
          alerts.push({
            type: "BALANCE_DROP",
            severity: balanceDiff > ethers.parseEther("1") ? "CRITICAL" : "HIGH",
            account: account.address,
            network: account.network,
            message: `Balance dropped by ${ethers.formatEther(balanceDiff)} on ${account.label}`,
            details: {
              previousBalance: ethers.formatEther(previousState.balance),
              currentBalance: ethers.formatEther(currentState.balance),
              difference: ethers.formatEther(balanceDiff),
            },
            timestamp: new Date(),
          });
        }

        // Check for nonce jump
        const nonceJump = currentState.nonce - previousState.nonce;
        if (nonceJump > ALERT_CONFIG.nonceJumpThreshold) {
          alerts.push({
            type: "NONCE_JUMP",
            severity: "MEDIUM",
            account: account.address,
            network: account.network,
            message: `Nonce jumped by ${nonceJump} on ${account.label}`,
            details: {
              previousNonce: previousState.nonce,
              currentNonce: currentState.nonce,
              jump: nonceJump,
            },
            timestamp: new Date(),
          });
        }

        // Check for delegation change
        if (previousState.delegatedTo !== currentState.delegatedTo) {
          const severity = currentState.delegatedTo === null ? "HIGH" : 
                          currentState.delegatedTo?.toLowerCase() !== DELEGATE_CONTRACT.toLowerCase() ? "CRITICAL" : "MEDIUM";
          
          alerts.push({
            type: "DELEGATION_CHANGE",
            severity,
            account: account.address,
            network: account.network,
            message: `Delegation changed on ${account.label}`,
            details: {
              previousDelegation: previousState.delegatedTo,
              currentDelegation: currentState.delegatedTo,
              expectedDelegation: DELEGATE_CONTRACT,
            },
            timestamp: new Date(),
          });
        }
      }

      // Update state
      this.accountStates.set(stateKey, currentState);
      
    } catch (error) {
      alerts.push({
        type: "ERROR",
        severity: "LOW",
        account: account.address,
        network: account.network,
        message: `Error checking ${account.label}: ${error}`,
        details: { error: String(error) },
        timestamp: new Date(),
      });
    }

    return alerts;
  }

  // ============================================
  // REAL-TIME TRANSACTION MONITORING
  // ============================================

  async watchTransactions(account: MonitoredAccount): Promise<void> {
    const wsProvider = this.wsProviders[account.network];
    if (!wsProvider) {
      console.log(`[${account.label}] No WebSocket provider, skipping real-time monitoring`);
      return;
    }

    console.log(`[${account.label}] Starting real-time transaction monitoring...`);

    // Watch for pending transactions involving this account
    wsProvider.on("pending", async (txHash) => {
      try {
        const tx = await wsProvider.getTransaction(txHash);
        if (!tx) return;

        const isIncoming = tx.to?.toLowerCase() === account.address.toLowerCase();
        const isOutgoing = tx.from?.toLowerCase() === account.address.toLowerCase();

        if (isIncoming || isOutgoing) {
          console.log(`\n${"=".repeat(60)}`);
          console.log(`🚨 TRANSACTION DETECTED on ${account.label}`);
          console.log(`${"=".repeat(60)}`);
          console.log(`Type: ${isOutgoing ? "OUTGOING ⬆️" : "INCOMING ⬇️"}`);
          console.log(`Hash: ${txHash}`);
          console.log(`From: ${tx.from}`);
          console.log(`To: ${tx.to}`);
          console.log(`Value: ${ethers.formatEther(tx.value)} ${NETWORKS[account.network].name}`);
          console.log(`Data: ${tx.data?.slice(0, 42)}...`);
          
          // Decode if it's calling our delegate
          if (tx.data && tx.data.length > 10) {
            const selector = tx.data.slice(0, 10);
            const functionNames: Record<string, string> = {
              "0x143ca9b0": "execute(Call[],uint256,bytes) - SPONSORED EXECUTION",
              "0x5c975abb": "executeDirect(Call[]) - DIRECT EXECUTION",
            };
            console.log(`Function: ${functionNames[selector] || `Unknown (${selector})`}`);
          }
          console.log(`${"=".repeat(60)}\n`);

          // Create alert for suspicious outgoing transactions
          if (isOutgoing && tx.value > ethers.parseEther("0.1")) {
            await this.handleAlert({
              type: "SUSPICIOUS_TX",
              severity: "HIGH",
              account: account.address,
              network: account.network,
              message: `Large outgoing transaction detected on ${account.label}`,
              details: {
                txHash,
                value: ethers.formatEther(tx.value),
                to: tx.to,
              },
              timestamp: new Date(),
            });
          }
        }
      } catch (e) {
        // Transaction might not be available yet
      }
    });
  }

  // ============================================
  // ALERT HANDLING
  // ============================================

  async handleAlert(alert: Alert): Promise<void> {
    this.alerts.push(alert);

    // Console output with colors
    const colors: Record<string, string> = {
      LOW: "\x1b[33m",      // Yellow
      MEDIUM: "\x1b[35m",   // Magenta
      HIGH: "\x1b[31m",     // Red
      CRITICAL: "\x1b[41m", // Red background
    };
    const reset = "\x1b[0m";

    console.log(`\n${colors[alert.severity]}${"!".repeat(60)}${reset}`);
    console.log(`${colors[alert.severity]}🚨 ALERT: ${alert.type} [${alert.severity}]${reset}`);
    console.log(`${colors[alert.severity]}${"!".repeat(60)}${reset}`);
    console.log(`Account: ${alert.account}`);
    console.log(`Network: ${alert.network}`);
    console.log(`Message: ${alert.message}`);
    console.log(`Details:`, JSON.stringify(alert.details, null, 2));
    console.log(`Time: ${alert.timestamp.toISOString()}`);

    // Send to Telegram
    if (ALERT_CONFIG.enableTelegram) {
      await this.sendTelegramAlert(alert);
    }

    // Send to Discord
    if (ALERT_CONFIG.enableDiscord) {
      await this.sendDiscordAlert(alert);
    }
  }

  async sendTelegramAlert(alert: Alert): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) return;

    const emoji = {
      LOW: "⚠️",
      MEDIUM: "🟠",
      HIGH: "🔴",
      CRITICAL: "🚨",
    };

    const message = `
${emoji[alert.severity]} *${alert.type}* [${alert.severity}]

*Account:* \`${alert.account}\`
*Network:* ${alert.network}
*Message:* ${alert.message}

*Details:*
\`\`\`
${JSON.stringify(alert.details, null, 2)}
\`\`\`

_${alert.timestamp.toISOString()}_
    `.trim();

    try {
      await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "Markdown",
          }),
        }
      );
    } catch (e) {
      console.error("Failed to send Telegram alert:", e);
    }
  }

  async sendDiscordAlert(alert: Alert): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    const colors: Record<string, number> = {
      LOW: 0xffff00,      // Yellow
      MEDIUM: 0xff00ff,   // Magenta
      HIGH: 0xff0000,     // Red
      CRITICAL: 0x800000, // Dark red
    };

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: `🚨 ${alert.type}`,
            description: alert.message,
            color: colors[alert.severity],
            fields: [
              { name: "Account", value: `\`${alert.account}\``, inline: true },
              { name: "Network", value: alert.network, inline: true },
              { name: "Severity", value: alert.severity, inline: true },
              { name: "Details", value: `\`\`\`json\n${JSON.stringify(alert.details, null, 2)}\n\`\`\`` },
            ],
            timestamp: alert.timestamp.toISOString(),
          }],
        }),
      });
    } catch (e) {
      console.error("Failed to send Discord alert:", e);
    }
  }

  // ============================================
  // MAIN MONITORING LOOP
  // ============================================

  async start(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║          EIP-7702 DELEGATE ACCOUNT MONITOR                  ║
║                                                              ║
║  Monitoring ${MONITORED_ACCOUNTS.length} accounts across ${Object.keys(NETWORKS).length} networks            ║
║  Check interval: ${ALERT_CONFIG.checkIntervalMs / 1000}s                                     ║
╚══════════════════════════════════════════════════════════════╝
    `);

    this.isRunning = true;

    // Initial state fetch
    console.log("\n📊 Fetching initial account states...\n");
    for (const account of MONITORED_ACCOUNTS) {
      const state = await this.getAccountState(account.address, account.network);
      const stateKey = `${account.network}:${account.address}`;
      this.accountStates.set(stateKey, state);

      const networkConfig = NETWORKS[account.network];
      console.log(`┌─────────────────────────────────────────────────────────┐`);
      console.log(`│ ${account.label.padEnd(55)} │`);
      console.log(`├─────────────────────────────────────────────────────────┤`);
      console.log(`│ Address: ${account.address}  │`);
      console.log(`│ Network: ${networkConfig.name.padEnd(47)} │`);
      console.log(`│ Balance: ${ethers.formatEther(state.balance).padEnd(47)} │`);
      console.log(`│ Nonce: ${state.nonce.toString().padEnd(49)} │`);
      console.log(`│ Delegated: ${state.isDelegated ? "Yes ✅" : "No ❌"}${" ".repeat(43)} │`);
      if (state.isDelegated) {
        console.log(`│ Delegate: ${state.delegatedTo?.slice(0, 42)}...│`);
        console.log(`│ Delegate Nonce: ${state.delegateNonce.toString().padEnd(40)} │`);
        
        const isExpected = state.delegatedTo?.toLowerCase() === DELEGATE_CONTRACT.toLowerCase();
        console.log(`│ Expected Delegate: ${isExpected ? "Yes ✅" : "⚠️ NO - UNEXPECTED!"}${" ".repeat(isExpected ? 35 : 24)} │`);
      }
      console.log(`└─────────────────────────────────────────────────────────┘\n`);
    }

    // Start real-time monitoring for each account
    for (const account of MONITORED_ACCOUNTS) {
      this.watchTransactions(account);
    }

    // Polling loop
    console.log(`\n🔄 Starting monitoring loop (checking every ${ALERT_CONFIG.checkIntervalMs / 1000}s)...\n`);
    
    while (this.isRunning) {
      for (const account of MONITORED_ACCOUNTS) {
        const alerts = await this.checkForChanges(account);
        for (const alert of alerts) {
          await this.handleAlert(alert);
        }
      }

      process.stdout.write(`\r[${new Date().toISOString()}] ✓ All accounts checked`);
      await new Promise((resolve) => setTimeout(resolve, ALERT_CONFIG.checkIntervalMs));
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log("\n\n🛑 Monitor stopped");
  }
}

// ============================================
// RUN MONITOR
// ============================================

const monitor = new EIP7702Monitor();

// Handle graceful shutdown
process.on("SIGINT", () => {
  monitor.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  monitor.stop();
  process.exit(0);
});

// Start monitoring
monitor.start().catch((error) => {
  console.error("Monitor error:", error);
  process.exit(1);
});
