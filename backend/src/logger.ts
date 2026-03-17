/**
 * Structured logger (Winston + Application Insights).
 *
 * Transports:
 *   Console — always active
 *     Dev  → human-readable coloured output with timestamps
 *     Prod → JSON (one object per line)
 *
 *   Application Insights — active when APPLICATIONINSIGHTS_CONNECTION_STRING is set
 *     Sends traces, warnings, and errors to Azure Monitor.
 *     Unhandled exceptions/rejections are automatically captured.
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
import { AppInsightsTransport } from './telemetry/app-insights-transport.js';

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

// ── Transports ────────────────────────────────────────────────────────────────

const transports: winston.transport[] = [
  new winston.transports.Console(),
];

// Add Application Insights transport when connection string is configured.
// The transport self-disables silently if the env var is absent or malformed.
const aiTransport = new AppInsightsTransport({ level: 'debug' });
transports.push(aiTransport);

// ── Logger ────────────────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: isDev ? devFormat : prodFormat,
  transports,
});

// Flush App Insights queue before process exits
process.on('beforeExit', () => { aiTransport.close(); });

export default logger;
