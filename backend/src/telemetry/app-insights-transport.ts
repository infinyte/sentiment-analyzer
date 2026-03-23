/**
 * Application Insights Winston Transport
 *
 * Sends Winston log entries to Azure Application Insights via the
 * REST Track ingestion API — no `applicationinsights` npm package required.
 *
 * Endpoint: {IngestionEndpoint}/v2/track
 * Docs: https://learn.microsoft.com/en-us/azure/azure-monitor/app/api-custom-events-metrics
 *
 * Required env var:
 *   APPLICATIONINSIGHTS_CONNECTION_STRING
 *   Format: InstrumentationKey=<key>;IngestionEndpoint=https://<region>.in.applicationinsights.azure.com/
 *
 * Features:
 *   - Async, non-blocking — failures are swallowed so logging never throws
 *   - Batched fire-and-forget queue (flushes every 5 s or at 50 events)
 *   - Winston log levels → App Insights severity levels
 *   - Structured meta properties forwarded as custom dimensions
 *   - Unhandled exceptions/rejections captured as ExceptionTelemetry
 */

import Transport from 'winston-transport';
import type { TransportStreamOptions } from 'winston-transport';
import { appConfigService } from '../services/app-config-service.js';

// ── App Insights severity levels ──────────────────────────────────────────────

const SEVERITY: Record<string, number> = {
  silly:   0, // Verbose
  debug:   0, // Verbose
  verbose: 0, // Verbose
  http:    1, // Information
  info:    1, // Information
  warn:    2, // Warning
  error:   3, // Error
  crit:    4, // Critical
};

// ── Connection string parser ───────────────────────────────────────────────────

interface ParsedConnectionString {
  instrumentationKey: string;
  ingestionEndpoint: string;
}

function parseConnectionString(cs: string): ParsedConnectionString | null {
  const parts = Object.fromEntries(
    cs.split(';').map(part => {
      const eq = part.indexOf('=');
      return eq > 0
        ? [part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim()]
        : ['', ''];
    })
  );

  const key      = parts['instrumentationkey'];
  const endpoint = parts['ingestionendpoint'];

  if (!key) return null;

  return {
    instrumentationKey: key,
    ingestionEndpoint:  (endpoint ?? 'https://dc.services.visualstudio.com').replace(/\/$/, ''),
  };
}

// ── Telemetry envelope builders ───────────────────────────────────────────────

type Properties = Record<string, string>;

function toProperties(meta: Record<string, unknown>): Properties {
  const props: Properties = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'level' || k === 'message') continue;
    props[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return props;
}

function traceEnvelope(
  iKey: string,
  message: string,
  severityLevel: number,
  properties: Properties
): object {
  return {
    name: `Microsoft.ApplicationInsights.${iKey}.Message`,
    time: new Date().toISOString(),
    iKey,
    tags: { 'ai.cloud.roleInstance': process.env.HOSTNAME ?? 'backend' },
    data: {
      baseType: 'MessageData',
      baseData: { ver: 2, message, severityLevel, properties },
    },
  };
}

function exceptionEnvelope(
  iKey: string,
  message: string,
  stack: string,
  properties: Properties
): object {
  return {
    name: `Microsoft.ApplicationInsights.${iKey}.Exception`,
    time: new Date().toISOString(),
    iKey,
    tags: { 'ai.cloud.roleInstance': process.env.HOSTNAME ?? 'backend' },
    data: {
      baseType: 'ExceptionData',
      baseData: {
        ver: 2,
        exceptions: [{
          typeName: 'Error',
          message,
          hasFullStack: true,
          stack,
        }],
        properties,
      },
    },
  };
}

// ── Transport ─────────────────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE  = 50;

export class AppInsightsTransport extends Transport {
  private readonly iKey: string;
  private readonly endpoint: string;
  private readonly queue: object[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: TransportStreamOptions) {
    super(opts);

    const cs = appConfigService.get('APPLICATIONINSIGHTS_CONNECTION_STRING') ?? '';
    const parsed = parseConnectionString(cs);

    if (!parsed) {
      // Silently disable — transport still exists but does nothing
      this.iKey     = '';
      this.endpoint = '';
      return;
    }

    this.iKey     = parsed.instrumentationKey;
    this.endpoint = `${parsed.ingestionEndpoint}/v2/track`;

    // Start background flush timer
    this.flushTimer = setInterval(() => { this.flush(); }, FLUSH_INTERVAL_MS);
    if (this.flushTimer.unref) this.flushTimer.unref(); // don't block process exit

    // Capture unhandled exceptions as ExceptionTelemetry
    process.on('uncaughtException',       err => this.captureException(err));
    process.on('unhandledRejection', reason => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      this.captureException(err);
    });
  }

  // ── Winston Transport interface ───────────────────────────────────────────

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));

    if (!this.iKey) { callback(); return; }

    const level   = String(info.level ?? 'info');
    const message = String(info.message ?? '');
    const props   = toProperties(info);
    const severity = SEVERITY[level] ?? 1;

    let envelope: object;
    if (level === 'error' && info['stack']) {
      envelope = exceptionEnvelope(this.iKey, message, String(info['stack']), props);
    } else {
      envelope = traceEnvelope(this.iKey, message, severity, props);
    }

    this.queue.push(envelope);

    if (this.queue.length >= FLUSH_BATCH_SIZE) {
      this.flush();
    }

    callback();
  }

  // ── Flush ─────────────────────────────────────────────────────────────────

  private flush(): void {
    if (this.queue.length === 0 || !this.iKey) return;

    const batch = this.queue.splice(0, FLUSH_BATCH_SIZE);
    this.send(batch).catch(() => { /* swallow — logging must never throw */ });
  }

  private async send(envelopes: object[]): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelopes),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      // Silently discard — App Insights being down must not affect the app
    }
  }

  private captureException(err: Error): void {
    if (!this.iKey) return;
    const envelope = exceptionEnvelope(
      this.iKey,
      err.message,
      err.stack ?? err.message,
      { source: 'uncaughtException' }
    );
    this.queue.push(envelope);
    this.flush();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Flush remaining queue synchronously-ish on process exit. */
  close(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
    super.emit('finish');
  }
}
