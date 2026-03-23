// Ensure deterministic trading config defaults for tests that import app at module-load time.
process.env.TRADING_MODE = process.env.TRADING_MODE ?? 'paper';
process.env.TRADING_PROVIDER = process.env.TRADING_PROVIDER ?? 'crypto-com';
