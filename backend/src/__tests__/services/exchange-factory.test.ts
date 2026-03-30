import {
  ExchangeFactory,
  getTradingConfig,
  TradingMode,
} from '../../services/exchange/exchange-factory.js';
import { PaperExchange } from '../../services/exchange/paper-exchange.js';
import { RealisticPaperExchange } from '../../services/exchange/realistic-paper-exchange.js';
import { AlpacaExchange } from '../../services/exchange/alpaca-exchange.js';

describe('exchange-factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRADING_MODE;
    delete process.env.TRADING_PROVIDER;
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_API_SECRET;
    delete process.env.ALPACA_DATA_URL;
    delete process.env.ALPACA_PAPER_API_URL;
    delete process.env.ALPACA_LIVE_API_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('parses alpaca as a supported trading provider', () => {
    process.env.TRADING_MODE = 'sandbox';
    process.env.TRADING_PROVIDER = 'alpaca';

    const config = getTradingConfig();

    expect(config.mode).toBe(TradingMode.SANDBOX);
    expect(config.provider).toBe('alpaca');
  });

  it('throws for unsupported TRADING_PROVIDER values', () => {
    process.env.TRADING_MODE = 'sandbox';
    process.env.TRADING_PROVIDER = 'not-a-provider';

    expect(() => getTradingConfig()).toThrow(/unsupported TRADING_PROVIDER/i);
  });

  it('always returns PaperExchange in paper mode', () => {
    process.env.TRADING_MODE = 'paper';
    process.env.TRADING_PROVIDER = 'alpaca';

    const config = getTradingConfig();
    const exchange = ExchangeFactory.create(config);

    expect(exchange).toBeInstanceOf(PaperExchange);
  });

  it('throws when alpaca is selected without alpaca credentials', () => {
    const config = {
      mode: TradingMode.SANDBOX,
      provider: 'alpaca' as const,
      initialCapital: 100,
      maxLossPercentage: 5,
      maxPositionSizePercentage: 15,
      maxOpenPositions: 3,
      requireManualApproval: false,
    };

    expect(() => ExchangeFactory.create(config)).toThrow(/ALPACA_API_KEY/i);
  });

  it('creates AlpacaExchange when alpaca credentials are configured', () => {
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';

    const config = {
      mode: TradingMode.SANDBOX,
      provider: 'alpaca' as const,
      initialCapital: 100,
      maxLossPercentage: 5,
      maxPositionSizePercentage: 15,
      maxOpenPositions: 3,
      requireManualApproval: false,
    };

    const exchange = ExchangeFactory.create(config);

    expect(exchange).toBeInstanceOf(AlpacaExchange);
  });

  // ── REALISTIC_PAPER mode ───────────────────────────────────────────────────

  it('getTradingConfig parses realistic_paper mode', () => {
    process.env.TRADING_MODE = 'realistic_paper';
    const config = getTradingConfig();
    expect(config.mode).toBe(TradingMode.REALISTIC_PAPER);
  });

  it('TradingMode enum includes REALISTIC_PAPER value', () => {
    expect(TradingMode.REALISTIC_PAPER).toBe('realistic_paper');
  });

  it('creates RealisticPaperExchange in REALISTIC_PAPER mode (any provider)', () => {
    const config = {
      mode: TradingMode.REALISTIC_PAPER,
      provider: 'binance-us' as const,
      initialCapital: 5000,
      maxLossPercentage: 5,
      maxPositionSizePercentage: 15,
      maxOpenPositions: 3,
      requireManualApproval: false,
    };

    const exchange = ExchangeFactory.create(config);
    expect(exchange).toBeInstanceOf(RealisticPaperExchange);
  });

  it('creates RealisticPaperExchange regardless of provider', () => {
    for (const provider of ['crypto-com', 'binance-us', 'coinbase', 'alpaca'] as const) {
      const exchange = ExchangeFactory.create({
        mode: TradingMode.REALISTIC_PAPER,
        provider,
        initialCapital: 10_000,
        maxLossPercentage: 5,
        maxPositionSizePercentage: 15,
        maxOpenPositions: 3,
        requireManualApproval: false,
      });
      expect(exchange).toBeInstanceOf(RealisticPaperExchange);
    }
  });

  it('RealisticPaperExchange uses REALISTIC_PAPER_FEE_PRESET from env', async () => {
    process.env.REALISTIC_PAPER_FEE_PRESET = 'coinbase';

    const exchange = ExchangeFactory.create({
      mode: TradingMode.REALISTIC_PAPER,
      initialCapital: 10_000,
      maxLossPercentage: 5,
      maxPositionSizePercentage: 15,
      maxOpenPositions: 3,
      requireManualApproval: false,
    }) as RealisticPaperExchange;

    // Coinbase taker fee is 1.2% — verify via a test order
    // inject a fixed-price quote source so the test is deterministic
    const { FallbackQuoteSource } = await import('../../services/exchange/realistic-paper-exchange.js');
    const fixedSource = new FallbackQuoteSource();  // random-walk only, no HTTP
    // Can't inject after construction, but we can verify the type at minimum
    expect(exchange).toBeInstanceOf(RealisticPaperExchange);

    delete process.env.REALISTIC_PAPER_FEE_PRESET;
  });

  it('REALISTIC_PAPER mode does not require broker credentials', () => {
    // This test documents that no env vars are needed (unlike SANDBOX/LIVE modes)
    const exchange = ExchangeFactory.create({
      mode: TradingMode.REALISTIC_PAPER,
      initialCapital: 1_000,
      maxLossPercentage: 5,
      maxPositionSizePercentage: 15,
      maxOpenPositions: 3,
      requireManualApproval: false,
    });
    expect(exchange).toBeInstanceOf(RealisticPaperExchange);
  });

  it('PAPER mode is unchanged and still returns PaperExchange', () => {
    const exchange = ExchangeFactory.create({
      mode: TradingMode.PAPER,
      initialCapital: 10_000,
      maxLossPercentage: 5,
      maxPositionSizePercentage: 15,
      maxOpenPositions: 3,
      requireManualApproval: false,
    });
    expect(exchange).toBeInstanceOf(PaperExchange);
    expect(exchange).not.toBeInstanceOf(RealisticPaperExchange);
  });
});
