import logger from '../logger.js';
import type { OnChainMetrics } from '../types.js';
import { Cache } from './cache.js';
import { appConfigService } from './app-config-service.js';

const DEFAULT_API_URL = 'https://api.glassnode.com/v1/metrics';
const CACHE_TTL_MS = 15 * 60 * 1000;

const COIN_TO_ASSET: Record<string, string> = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
  ripple: 'XRP',
  xrp: 'XRP',
  cardano: 'ADA',
  ada: 'ADA',
  dogecoin: 'DOGE',
  doge: 'DOGE',
  litecoin: 'LTC',
  ltc: 'LTC',
  chainlink: 'LINK',
  link: 'LINK',
};

export class OnChainService {
  private readonly overrideApiKey: string;
  private readonly overrideApiUrl: string;

  constructor(
    apiKey = '',
    apiUrl = '',
    private readonly cache = new Cache()
  ) {
    this.overrideApiKey = apiKey.trim();
    this.overrideApiUrl = apiUrl.replace(/\/$/, '');
  }

  private get apiKey(): string {
    return this.overrideApiKey || (appConfigService.get('ONCHAIN_API_KEY') ?? '').trim();
  }

  private get apiUrl(): string {
    return this.overrideApiUrl || (appConfigService.get('ONCHAIN_API_URL') ?? DEFAULT_API_URL).replace(/\/$/, '');
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async getMetrics(coinId: string): Promise<OnChainMetrics | null> {
    if (!this.isAvailable()) return null;

    const normalizedCoinId = coinId.trim().toLowerCase();
    const cacheKey = `onchain:${normalizedCoinId}`;
    const cached = this.cache.get<OnChainMetrics>(cacheKey);
    if (cached) return cached;

    const asset = this.toProviderAsset(coinId);

    try {
      const [exchange_inflow, exchange_outflow, active_addresses_24h, large_tx_count_24h] = await Promise.all([
        this.fetchLatestMetric('transactions/transfers_volume_to_exchanges_sum', asset, { i: '24h' }),
        this.fetchLatestMetric('transactions/transfers_volume_from_exchanges_sum', asset, { i: '24h' }),
        this.fetchLatestMetric('addresses/active_count', asset, { i: '24h' }),
        this.fetchLatestMetric('transactions/count', asset, { i: '24h', min_transfer_value_usd: '100000' }),
      ]);

      const metrics: OnChainMetrics = {
        exchange_inflow,
        exchange_outflow,
        active_addresses_24h,
        large_tx_count_24h,
      };

      this.cache.set(cacheKey, metrics, CACHE_TTL_MS);
      return metrics;
    } catch (error) {
      logger.warn('onchain fetch failed', { coinId, error: String(error) });
      return null;
    }
  }

  private toProviderAsset(coinId: string): string {
    const normalized = coinId.trim().toLowerCase();
    return COIN_TO_ASSET[normalized] ?? normalized.replace(/[^a-z0-9]/g, '').toUpperCase();
  }

  private async fetchLatestMetric(
    path: string,
    asset: string,
    extraParams: Record<string, string>
  ): Promise<number> {
    const params = new URLSearchParams({ ...extraParams, a: asset, api_key: this.apiKey });
    const res = await fetch(`${this.apiUrl}/${path}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`On-chain provider error (${path}): ${res.status}`);
    }

    const data = await res.json() as unknown;
    const value = this.extractLatestNumericValue(data);

    if (value === null) {
      throw new Error(`On-chain provider returned no numeric value for ${path}`);
    }

    return value;
  }

  private extractLatestNumericValue(data: unknown): number | null {
    if (typeof data === 'number' && Number.isFinite(data)) {
      return data;
    }

    if (Array.isArray(data)) {
      for (let index = data.length - 1; index >= 0; index -= 1) {
        const value = this.extractLatestNumericValue(data[index]);
        if (value !== null) return value;
      }
      return null;
    }

    if (!data || typeof data !== 'object') {
      return null;
    }

    const record = data as Record<string, unknown>;

    if (Array.isArray(record.data)) {
      return this.extractLatestNumericValue(record.data);
    }

    for (const key of ['v', 'value', 'result', 'count']) {
      const candidate = record[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}

export const onChainService = new OnChainService();