/**
 * CoinMentionExtractor
 *
 * Detects cryptocurrency mentions in arbitrary text.
 * Recognises: $BTC, #bitcoin, bare symbol (BTC), full name (Bitcoin).
 */

// ── Coin dictionary ────────────────────────────────────────────────────────────

interface CoinEntry {
  symbol: string;
  names: string[];
}

const COIN_DICT: CoinEntry[] = [
  { symbol: 'BTC',   names: ['bitcoin'] },
  { symbol: 'ETH',   names: ['ethereum', 'ether'] },
  { symbol: 'BNB',   names: ['binance coin', 'bnb'] },
  { symbol: 'XRP',   names: ['ripple', 'xrp'] },
  { symbol: 'ADA',   names: ['cardano', 'ada'] },
  { symbol: 'SOL',   names: ['solana'] },
  { symbol: 'DOT',   names: ['polkadot'] },
  { symbol: 'DOGE',  names: ['dogecoin', 'doge'] },
  { symbol: 'AVAX',  names: ['avalanche'] },
  { symbol: 'SHIB',  names: ['shiba inu', 'shib'] },
  { symbol: 'MATIC', names: ['polygon', 'matic'] },
  { symbol: 'LTC',   names: ['litecoin'] },
  { symbol: 'UNI',   names: ['uniswap'] },
  { symbol: 'LINK',  names: ['chainlink'] },
  { symbol: 'TRX',   names: ['tron'] },
  { symbol: 'ATOM',  names: ['cosmos'] },
  { symbol: 'XLM',   names: ['stellar', 'lumens'] },
  { symbol: 'ETC',   names: ['ethereum classic'] },
  { symbol: 'FIL',   names: ['filecoin'] },
  { symbol: 'NEAR',  names: ['near protocol', 'near'] },
  { symbol: 'ALGO',  names: ['algorand'] },
  { symbol: 'VET',   names: ['vechain'] },
  { symbol: 'ICP',   names: ['internet computer', 'icp'] },
  { symbol: 'FTM',   names: ['fantom'] },
  { symbol: 'SAND',  names: ['the sandbox', 'sandbox'] },
  { symbol: 'MANA',  names: ['decentraland', 'mana'] },
  { symbol: 'AXS',   names: ['axie infinity'] },
  { symbol: 'THETA', names: ['theta network', 'theta'] },
  { symbol: 'XMR',   names: ['monero'] },
  { symbol: 'ZEC',   names: ['zcash'] },
  { symbol: 'AAVE',  names: ['aave'] },
  { symbol: 'COMP',  names: ['compound'] },
  { symbol: 'SNX',   names: ['synthetix'] },
  { symbol: 'YFI',   names: ['yearn finance', 'yearn'] },
  { symbol: 'CRV',   names: ['curve', 'curve dao'] },
  { symbol: 'SUSHI', names: ['sushiswap'] },
  { symbol: 'GRT',   names: ['the graph'] },
  { symbol: 'INJ',   names: ['injective'] },
  { symbol: 'OP',    names: ['optimism'] },
  { symbol: 'ARB',   names: ['arbitrum'] },
  { symbol: 'APT',   names: ['aptos'] },
  { symbol: 'SUI',   names: ['sui'] },
  { symbol: 'TON',   names: ['toncoin', 'the open network'] },
  { symbol: 'PEPE',  names: ['pepe'] },
  { symbol: 'WIF',   names: ['dogwifhat', 'wif'] },
  { symbol: 'BONK',  names: ['bonk'] },
  { symbol: 'FLOKI', names: ['floki'] },
  { symbol: 'NOT',   names: ['notcoin'] },
  { symbol: 'TIA',   names: ['celestia'] },
  { symbol: 'JUP',   names: ['jupiter'] },
  { symbol: 'HBAR',  names: ['hedera', 'hbar'] },
  { symbol: 'EGLD',  names: ['elrond', 'multiversx'] },
  { symbol: 'STX',   names: ['stacks'] },
  { symbol: 'KSM',   names: ['kusama'] },
  { symbol: 'DASH',  names: ['dash'] },
  { symbol: 'NEO',   names: ['neo'] },
  { symbol: 'BAL',   names: ['balancer'] },
  { symbol: 'CAKE',  names: ['pancakeswap', 'cake'] },
];

// Pre-build lookup maps
const SYMBOL_SET = new Set(COIN_DICT.map(e => e.symbol));
const NAME_TO_SYMBOL = new Map<string, string>();
for (const entry of COIN_DICT) {
  for (const name of entry.names) {
    NAME_TO_SYMBOL.set(name, entry.symbol);
  }
}

// Known crypto-related keywords (not coin-specific)
const CRYPTO_KEYWORDS = new Set([
  'defi', 'nft', 'web3', 'dao', 'dex', 'cex', 'yield', 'staking',
  'blockchain', 'layer2', 'l2', 'layer1', 'l1', 'metaverse', 'memecoin',
  'altcoin', 'hodl', 'fomo', 'fud', 'bull run', 'bear market', 'halving',
  'mining', 'validator', 'smart contract', 'liquidity', 'gas fees',
]);

// ── Extractor ─────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  coins: string[];
  hashtags: string[];
  keywords: string[];
}

export function extractCoins(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  const words = text.split(/[\s,.:;!?()[\]"']+/);

  // 1. Explicit $TICKER and #TICKER patterns
  for (const word of words) {
    if (/^[$#][A-Z]{2,6}$/i.test(word)) {
      const sym = word.slice(1).toUpperCase();
      if (SYMBOL_SET.has(sym)) found.add(sym);
    }
  }

  // 2. Bare uppercase symbols (only if they look like tickers — surrounded by non-alpha)
  const tickerRegex = /(?<![A-Za-z])([A-Z]{2,6})(?![A-Za-z])/g;
  let match: RegExpExecArray | null;
  while ((match = tickerRegex.exec(text)) !== null) {
    if (SYMBOL_SET.has(match[1])) found.add(match[1]);
  }

  // 3. Full coin names (case-insensitive)
  for (const [name, symbol] of NAME_TO_SYMBOL.entries()) {
    if (lower.includes(name)) found.add(symbol);
  }

  return Array.from(found);
}

export function extractHashtags(text: string): string[] {
  const tags: string[] = [];
  const regex = /#([A-Za-z][A-Za-z0-9_]{1,29})/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    tags.push(m[1].toLowerCase());
  }
  return Array.from(new Set(tags));
}

export function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return Array.from(CRYPTO_KEYWORDS).filter(kw => lower.includes(kw));
}

export function extractAll(text: string): ExtractionResult {
  return {
    coins: extractCoins(text),
    hashtags: extractHashtags(text),
    keywords: extractKeywords(text),
  };
}
