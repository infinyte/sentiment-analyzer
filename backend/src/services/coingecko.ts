import type { Coin } from '../types.js';
import logger from '../logger.js';

interface CoinGeckoMarketCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap?: number;
  total_volume?: number;
  price_change_percentage_24h?: number;
  price_change_percentage_7d?: number;
  high_24h?: number;
  low_24h?: number;
  market_cap_rank?: number;
}

type CoinGeckoOhlcPoint = [number, number, number, number, number];

export class CoinGeckoService {
  private apiUrl = 'https://api.coingecko.com/api/v3';

  async getTopCoins(limit: number = 50): Promise<Coin[]> {
    try {
      const response = await fetch(
        `${this.apiUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&sparkline=false`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);

      const data = (await response.json()) as CoinGeckoMarketCoin[];

      return data.map((coin) => {
        // Calculate volatility_24h from high/low range
        const high24h = coin.high_24h || coin.current_price;
        const low24h = coin.low_24h || coin.current_price;
        const volatility24h = coin.current_price
          ? ((high24h - low24h) / coin.current_price) * 100
          : 0;

        return {
          id: coin.id,
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          price_usd: coin.current_price,
          market_cap_usd: coin.market_cap || 0,
          volume_24h_usd: coin.total_volume || 0,
          price_change_24h_percent: coin.price_change_percentage_24h || 0,
          price_change_7d_percent: coin.price_change_percentage_7d || 0,
          volatility_24h: volatility24h,
          volatility_7d: 0,
          sentiment_score: 'NEUTRAL' as const,
          sentiment_confidence: 0,
          sentiment_summary: '',
          trending_score: 0,
          timestamp: new Date(),
          market_rank: coin.market_cap_rank || 999,
        };
      });
    } catch (error) {
      logger.error('coingecko fetch error', { error: String(error) });
      throw error;
    }
  }

  async getCoinHistory(coinId: string, days: number = 7) {
    try {
      const response = await fetch(
        `${this.apiUrl}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) throw new Error(`Failed to fetch history for ${coinId}`);

      const data = (await response.json()) as CoinGeckoOhlcPoint[];

      return data.map((point) => ({
        timestamp: new Date(point[0]),
        open: point[1],
        high: point[2],
        low: point[3],
        close: point[4],
      }));
    } catch (error) {
      logger.error('coingecko history error', { coinId, error: String(error) });
      return [];
    }
  }
}
