import {
  ExchangeFactory,
  getTradingConfig,
  TradingMode,
} from '../../services/exchange/exchange-factory.js';
import { PaperExchange } from '../../services/exchange/paper-exchange.js';
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
});
