// script/dexscreener.ts
import WebSocket from 'ws';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { chromium, Cookie } from 'playwright'

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

interface PairData {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
}

interface WebSocketMessage {
  type: string;
  data: {
    pairs: PairData[];
  };
}

async function getDexCookies(): Promise<string> {
  if (process.env.DEX_COOKIES && process.env.DEX_COOKIES.trim().length > 0) return process.env.DEX_COOKIES

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('https://dexscreener.com', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const cookies = await context.cookies()
  await browser.close()

  const cookieHeader = cookies
    .filter(c => c.domain.includes('dexscreener.com'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ')

  return cookieHeader
}

class DexScreenerClient {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;

  private readonly wsUrl = 'wss://io.dexscreener.com/dex/screener/v5/pairs/m5/1?rankBy[key]=trendingScoreM5&rankBy[order]=desc&filters[chainIds][0]=solana&filters[baseTokenSuffixes][0]=pump&filters[baseTokenSuffixes][1]=bonk';

  constructor() {
    this.connect();
  }

  private async connect(): Promise<void> {
    console.log('🔌 Connecting to DexScreener WebSocket...');

    const cookieHeader = await getDexCookies()
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

    this.ws = new WebSocket(this.wsUrl, {
      headers: {
        Origin: 'https://dexscreener.com',
        Referer: 'https://dexscreener.com/solana',
        'User-Agent': userAgent,
        Cookie: cookieHeader
      }
    });

    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('error', this.onError.bind(this));
    this.ws.on('close', this.onClose.bind(this));
  }

  private onOpen(): void {
    console.log('✅ Connected to DexScreener WebSocket');
    this.isConnected = true;
    this.reconnectAttempts = 0;
  }

  private async onMessage(data: Buffer): Promise<void> {
    try {
      let decodedData: string;

      // Try different decompression methods
      if (this.isGzipped(data)) {
        const decompressed = await gunzip(data);
        decodedData = decompressed.toString('utf8');
      } else if (this.isDeflated(data)) {
        const decompressed = await inflate(data);
        decodedData = decompressed.toString('utf8');
      } else {
        decodedData = data.toString('utf8');
      }

      // Clean up the data and try to extract JSON
      const cleanedData = this.extractJsonFromString(decodedData);
      
      if (cleanedData) {
        const message: WebSocketMessage = JSON.parse(cleanedData);
        this.handleMessage(message);
      } else {
        // If no JSON found, try to parse the raw data for readable content
        this.parseRawData(decodedData);
      }

    } catch (error) {
      console.error('❌ Error processing message:', error);
      // Log raw data for debugging
      console.log('📝 Raw data sample:', data.slice(0, 200).toString());
    }
  }

  private isGzipped(data: Buffer): boolean {
    return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  }

  private isDeflated(data: Buffer): boolean {
    return data.length >= 2 && data[0] === 0x78;
  }

  private extractJsonFromString(str: string): string | null {
    // Look for JSON objects in the string
    const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    const matches = str.match(jsonRegex);
    
    if (matches) {
      // Try to find the largest/most complete JSON object
      return matches.sort((a, b) => b.length - a.length)[0];
    }

    return null;
  }

  private parseRawData(data: string): void {
    // Look for recognizable patterns in the data
    const tokenRegex = /([A-Za-z0-9]{32,})/g; // Token addresses
    const priceRegex = /(\d+\.?\d*)/g; // Numbers that might be prices
    
    console.log('📊 Raw data parsing...');
    
    if (data.includes('solana') || data.includes('pump') || data.includes('SOL')) {
      console.log('🎯 Found Solana-related data');
      
      // Extract potential token addresses
      const addresses = data.match(tokenRegex);
      if (addresses) {
        console.log(`🏷️  Found ${addresses.length} potential addresses`);
      }
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    if (message.data && message.data.pairs) {
      console.clear();
      console.log('🚀 DexScreener Top 30 Trending Pools (Solana - Pump/Bonk)');
      console.log('=' .repeat(120));
      
      const pairs = message.data.pairs.slice(0, 30);
      
      pairs.forEach((pair, index) => {
        this.displayPairData(pair, index + 1);
      });

      console.log('\n📊 Data updated at:', new Date().toLocaleString());
      console.log('🔄 Listening for updates...\n');
    }
  }

  private displayPairData(pair: PairData, rank: number): void {
    const baseSymbol = pair.baseToken?.symbol || 'Unknown';
    const quoteSymbol = pair.quoteToken?.symbol || 'Unknown';
    const price = pair.priceUsd || pair.priceNative || '0';
    const marketCap = pair.marketCap ? `$${this.formatNumber(pair.marketCap)}` : 'N/A';
    const fdv = pair.fdv ? `$${this.formatNumber(pair.fdv)}` : 'N/A';
    const liquidity = pair.liquidity?.usd ? `$${this.formatNumber(pair.liquidity.usd)}` : 'N/A';
    
    const volume24h = pair.volume?.h24 ? `$${this.formatNumber(pair.volume.h24)}` : 'N/A';
    const volume1h = pair.volume?.h1 ? `$${this.formatNumber(pair.volume.h1)}` : 'N/A';
    const volume5m = pair.volume?.m5 ? `$${this.formatNumber(pair.volume.m5)}` : 'N/A';
    
    const change24h = pair.priceChange?.h24 ? `${pair.priceChange.h24.toFixed(2)}%` : 'N/A';
    const change1h = pair.priceChange?.h1 ? `${pair.priceChange.h1.toFixed(2)}%` : 'N/A';
    const change5m = pair.priceChange?.m5 ? `${pair.priceChange.m5.toFixed(2)}%` : 'N/A';

    const txns24h = pair.txns?.h24 ? `${pair.txns.h24.buys + pair.txns.h24.sells}` : 'N/A';
    const txns1h = pair.txns?.h1 ? `${pair.txns.h1.buys + pair.txns.h1.sells}` : 'N/A';
    
    console.log(`\n#${rank.toString().padStart(2, '0')} ${baseSymbol}/${quoteSymbol}`);
    console.log(`🏷️  Pair: ${pair.pairAddress || 'N/A'}`);
    console.log(`💰 Price: $${this.formatNumber(parseFloat(price))}`);
    console.log(`📊 Market Cap: ${marketCap} | FDV: ${fdv} | Liquidity: ${liquidity}`);
    console.log(`📈 Volume: 24h: ${volume24h} | 1h: ${volume1h} | 5m: ${volume5m}`);
    console.log(`🔄 Price Change: 24h: ${change24h} | 1h: ${change1h} | 5m: ${change5m}`);
    console.log(`🔢 Transactions: 24h: ${txns24h} | 1h: ${txns1h}`);
    console.log(`🌐 DEX: ${pair.dexId || 'N/A'} | Chain: ${pair.chainId || 'N/A'}`);
    
    if (pair.pairCreatedAt) {
      const createdDate = new Date(pair.pairCreatedAt * 1000).toLocaleString();
      console.log(`📅 Created: ${createdDate}`);
    }
    
    if (pair.url) {
      console.log(`🔗 URL: ${pair.url}`);
    }
  }

  private formatNumber(num: number): string {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(4);
  }

  private onError(error: Error): void {
    console.error('❌ WebSocket error:', error.message);
  }

  private onClose(code: number, reason: Buffer): void {
    console.log(`🔌 WebSocket closed: ${code} - ${reason.toString()}`);
    this.isConnected = false;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay/1000}s...`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    } else {
      console.log('❌ Max reconnection attempts reached. Exiting...');
      process.exit(1);
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Start the client
console.log('🚀 Starting DexScreener WebSocket Client...');
const client = new DexScreenerClient();

export default client;