/**
 * Structured logger (Winston).
 *
 * Development  → human-readable coloured output with timestamps
 * Production   → JSON (one object per line, compatible with Application Insights / Datadog)
 *
 * Usage:
 *   import logger from './logger.js';
 *   logger.info('server started', { port: 3000 });
 *   logger.warn('cache miss',    { symbol: 'BTC' });
 *   logger.error('fetch failed', { endpoint: '/api/coins', error: err.message });
 *
 * Log level precedence (lowest → highest): debug < info < warn < error
 * Override at runtime with the LOG_LEVEL env var (e.g. LOG_LEVEL=debug).
 */

import winston from 'winston';

const isDev = process.env.NODE_ENV !== 'production';

const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? '  ' + JSON.stringify(meta)
      : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: isDev ? devFormat : prodFormat,
  transports: [new winston.transports.Console()],
});

export default logger;
