import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { EventEmitter } from 'node:events';
import {
  LogLevel,
  LogCategory,
  LogConfig,
  buildDefaultLogConfig,
  logLevelName,
  parseLogLevel,
} from './log-levels';

/**
 * Correlation context attached to every log entry within a single request.
 */
export interface CorrelationContext {
  /** Unique request ID (UUID). Propagated from X-Request-Id header or auto-generated. */
  requestId: string;
  /** HTTP method */
  method?: string;
  /** Request URL path */
  path?: string;
  /** SCIM endpoint ID (if applicable) */
  endpointId?: string;
  /** Auth type used for the request */
  authType?: 'oauth' | 'legacy' | 'public';
  /** OAuth client_id if authenticated via OAuth */
  clientId?: string;
  /** Start timestamp for duration tracking */
  startTime?: number;
}

/**
 * A single structured log entry.
 * In JSON format mode these are emitted as one JSON line per entry.
 */
export interface StructuredLogEntry {
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Log severity */
  level: string;
  /** Functional category */
  category: string;
  /** Human-readable message */
  message: string;
  /** Correlation ID linking all logs for a single request */
  requestId?: string;
  /** SCIM endpoint ID */
  endpointId?: string;
  /** HTTP method */
  method?: string;
  /** Request path */
  path?: string;
  /** Duration in ms (for timing entries) */
  durationMs?: number;
  /** Error information */
  error?: {
    message: string;
    name?: string;
    stack?: string;
  };
  /** Additional structured data (request body excerpts, filter expressions, etc.) */
  data?: Record<string, unknown>;
}

// Singleton storage for request-scoped correlation context
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * ScimLogger — Structured, leveled, correlation-aware logger for SCIMServer.
 *
 * Features:
 * - RFC 5424-inspired log levels: TRACE → DEBUG → INFO → WARN → ERROR → FATAL
 * - Per-category, per-endpoint, and global level configuration
 * - Request correlation IDs propagated across async boundaries
 * - JSON structured output for production; pretty human-readable for dev
 * - Runtime-configurable via admin API (no restart required)
 * - Payload truncation for large SCIM bodies
 *
 * Usage:
 *   this.scimLogger.info(LogCategory.SCIM_USER, 'User created', { userId: 'abc' });
 *   this.scimLogger.debug(LogCategory.SCIM_PATCH, 'Applying op', { op: 'replace', path: 'name.givenName' });
 *   this.scimLogger.trace(LogCategory.HTTP, 'Request body', { body: dto });
 */
@Injectable()
export class ScimLogger {
  private config: LogConfig;

  /** In-memory ring buffer of recent log entries for admin API access */
  private readonly ringBuffer: StructuredLogEntry[] = [];
  private readonly maxRingBufferSize = 500;

  /** EventEmitter for real-time log streaming (SSE subscribers) */
  private readonly emitter = new EventEmitter();

  constructor() {
    this.config = buildDefaultLogConfig();
    // Allow many SSE subscribers without warning
    this.emitter.setMaxListeners(50);
  }

  // ─── Live Stream (SSE) ────────────────────────────────────────────

  /**
   * Subscribe to live log entries. Returns an unsubscribe function.
   * Used by the SSE /admin/log-config/stream endpoint.
   */
  subscribe(listener: (entry: StructuredLogEntry) => void): () => void {
    this.emitter.on('log', listener);
    return () => this.emitter.off('log', listener);
  }

  // ─── Correlation Context ──────────────────────────────────────────

  /** Run a function within a correlation context (typically per-request). */
  runWithContext<T>(ctx: CorrelationContext, fn: () => T): T {
    return correlationStorage.run(ctx, fn);
  }

  /** Get the current correlation context (if inside a request scope). */
  getContext(): CorrelationContext | undefined {
    return correlationStorage.getStore();
  }

  /** Update fields on the current correlation context. */
  enrichContext(partial: Partial<CorrelationContext>): void {
    const current = correlationStorage.getStore();
    if (current) {
      Object.assign(current, partial);
    }
  }

  // ─── Configuration ────────────────────────────────────────────────

  /** Get current log configuration (for admin API). */
  getConfig(): LogConfig {
    return { ...this.config };
  }

  /** Replace the entire log configuration at runtime. */
  setConfig(config: LogConfig): void {
    this.config = config;
  }

  /** Update specific configuration fields at runtime. */
  updateConfig(partial: Partial<LogConfig>): void {
    Object.assign(this.config, partial);
  }

  /** Set global log level at runtime. */
  setGlobalLevel(level: LogLevel | string): void {
    this.config.globalLevel = typeof level === 'string' ? parseLogLevel(level) : level;
  }

  /** Set log level for a specific category at runtime. */
  setCategoryLevel(category: LogCategory, level: LogLevel | string): void {
    this.config.categoryLevels[category] = typeof level === 'string' ? parseLogLevel(level) : level;
  }

  /** Set log level override for a specific endpoint at runtime. */
  setEndpointLevel(endpointId: string, level: LogLevel | string): void {
    this.config.endpointLevels[endpointId] = typeof level === 'string' ? parseLogLevel(level) : level;
  }

  /** Remove endpoint-specific log level override. */
  clearEndpointLevel(endpointId: string): void {
    delete this.config.endpointLevels[endpointId];
  }

  // ─── Level-specific methods ───────────────────────────────────────

  trace(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.TRACE, category, message, data);
  }

  debug(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  info(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  warn(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, category, message, data);
  }

  error(category: LogCategory, message: string, error?: unknown, data?: Record<string, unknown>): void {
    const errorData = this.formatError(error);
    this.log(LogLevel.ERROR, category, message, data, errorData);
  }

  fatal(category: LogCategory, message: string, error?: unknown, data?: Record<string, unknown>): void {
    const errorData = this.formatError(error);
    this.log(LogLevel.FATAL, category, message, data, errorData);
  }

  // ─── Ring buffer access (admin API) ───────────────────────────────

  /** Get recent log entries from the in-memory ring buffer. */
  getRecentLogs(options?: {
    limit?: number;
    level?: LogLevel;
    category?: LogCategory;
    requestId?: string;
    endpointId?: string;
  }): StructuredLogEntry[] {
    let entries = [...this.ringBuffer];

    if (options?.level !== undefined) {
      const minLevel = options.level;
      entries = entries.filter(e => {
        const entryLevel = LogLevel[e.level as keyof typeof LogLevel] ?? LogLevel.INFO;
        return (entryLevel as number) >= (minLevel as number);
      });
    }
    if (options?.category) {
      entries = entries.filter(e => e.category === (options.category as string));
    }
    if (options?.requestId) {
      entries = entries.filter(e => e.requestId === options.requestId);
    }
    if (options?.endpointId) {
      entries = entries.filter(e => e.endpointId === options.endpointId);
    }

    const limit = options?.limit ?? 100;
    return entries.slice(-limit);
  }

  /** Clear the in-memory ring buffer. */
  clearRecentLogs(): void {
    this.ringBuffer.length = 0;
  }

  // ─── Core logging logic ───────────────────────────────────────────

  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    errorInfo?: StructuredLogEntry['error'],
  ): void {
    if (!this.isEnabled(level, category)) return;

    const ctx = correlationStorage.getStore();
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: logLevelName(level),
      category,
      message,
      requestId: ctx?.requestId,
      endpointId: ctx?.endpointId,
      method: ctx?.method,
      path: ctx?.path,
    };

    if (ctx?.startTime) {
      entry.durationMs = Date.now() - ctx.startTime;
    }

    if (errorInfo) {
      entry.error = errorInfo;
      if (!this.config.includeStackTraces) {
        delete entry.error.stack;
      }
    }

    if (data) {
      entry.data = this.sanitizeData(data);
    }

    // Push to ring buffer
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxRingBufferSize) {
      this.ringBuffer.shift();
    }

    // Notify live stream subscribers (SSE)
    this.emitter.emit('log', entry);

    // Emit to console
    this.emit(level, entry);
  }

  /** Check if a log at the given level + category should be emitted. */
  isEnabled(level: LogLevel, category?: LogCategory): boolean {
    // Check endpoint-level override first
    const ctx = correlationStorage.getStore();
    if (ctx?.endpointId && this.config.endpointLevels[ctx.endpointId] !== undefined) {
      return level >= this.config.endpointLevels[ctx.endpointId];
    }

    // Check category-level override
    if (category && this.config.categoryLevels[category] !== undefined) {
      return level >= this.config.categoryLevels[category]!;
    }

    // Fall back to global level
    return level >= this.config.globalLevel;
  }

  /** Format an error object for structured output. */
  private formatError(error: unknown): StructuredLogEntry['error'] | undefined {
    if (!error) return undefined;
    if (error instanceof Error) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }
    return { message: String(error) };
  }

  /** Sanitize data: truncate large payloads, redact secrets. */
  private sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact sensitive fields
      if (/secret|password|token|authorization|bearer|jwt/i.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }

      if (typeof value === 'string' && value.length > this.config.maxPayloadSizeBytes) {
        result[key] = value.slice(0, this.config.maxPayloadSizeBytes) + `...[truncated ${value.length - this.config.maxPayloadSizeBytes}B]`;
      } else if (typeof value === 'object' && value !== null) {
        const serialized = JSON.stringify(value);
        if (serialized.length > this.config.maxPayloadSizeBytes) {
          result[key] = serialized.slice(0, this.config.maxPayloadSizeBytes) + `...[truncated]`;
        } else {
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /** Emit a structured log entry to the console. */
  private emit(level: LogLevel, entry: StructuredLogEntry): void {
    if (this.config.format === 'json') {
      this.emitJson(level, entry);
    } else {
      this.emitPretty(level, entry);
    }
  }

  /** JSON structured output — one line per entry, ideal for log aggregation (ELK, Azure Monitor). */
  private emitJson(level: LogLevel, entry: StructuredLogEntry): void {
    const line = JSON.stringify(entry);
    switch (level) {
      case LogLevel.TRACE:
      case LogLevel.DEBUG:
        process.stdout.write(line + '\n');
        break;
      case LogLevel.INFO:
        process.stdout.write(line + '\n');
        break;
      case LogLevel.WARN:
        process.stderr.write(line + '\n');
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        process.stderr.write(line + '\n');
        break;
    }
  }

  /** Pretty human-readable output for development. */
  private emitPretty(level: LogLevel, entry: StructuredLogEntry): void {
    const ts = entry.timestamp.slice(11, 23); // HH:mm:ss.SSS
    const lvl = entry.level.padEnd(5);
    const cat = entry.category.padEnd(14);
    const reqId = entry.requestId ? ` [${entry.requestId.slice(0, 8)}]` : '';
    const ep = entry.endpointId ? ` ep:${entry.endpointId.slice(0, 8)}` : '';
    const dur = entry.durationMs !== undefined ? ` +${entry.durationMs}ms` : '';
    const method = entry.method ? ` ${entry.method}` : '';
    const path = entry.path ? ` ${entry.path}` : '';

    const prefix = `${ts} ${this.colorize(level, lvl)} ${cat}${reqId}${ep}${method}${path}${dur}`;
    let line = `${prefix} ${entry.message}`;

    if (entry.error) {
      line += ` | ERROR: ${entry.error.message}`;
      if (entry.error.stack && this.config.includeStackTraces) {
        line += `\n${entry.error.stack}`;
      }
    }

    if (entry.data && Object.keys(entry.data).length > 0) {
      // For TRACE level show full data, for higher levels show compact
      if (level <= LogLevel.DEBUG) {
        line += `\n  ${JSON.stringify(entry.data, null, 2).replace(/\n/g, '\n  ')}`;
      } else {
        const compact = JSON.stringify(entry.data);
        if (compact.length <= 200) {
          line += ` | ${compact}`;
        }
      }
    }

    switch (level) {
      case LogLevel.TRACE:
        // eslint-disable-next-line no-console
        console.debug(line);
        break;
      case LogLevel.DEBUG:
        // eslint-disable-next-line no-console
        console.debug(line);
        break;
      case LogLevel.INFO:
        // eslint-disable-next-line no-console
        console.log(line);
        break;
      case LogLevel.WARN:
        // eslint-disable-next-line no-console
        console.warn(line);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        // eslint-disable-next-line no-console
        console.error(line);
        break;
    }
  }

  /** ANSI colorize for terminal output. */
  private colorize(level: LogLevel, text: string): string {
    // Skip colors if not a TTY
    if (!process.stdout.isTTY) return text;
    switch (level) {
      case LogLevel.TRACE: return `\x1b[90m${text}\x1b[0m`;  // gray
      case LogLevel.DEBUG: return `\x1b[36m${text}\x1b[0m`;  // cyan
      case LogLevel.INFO:  return `\x1b[32m${text}\x1b[0m`;  // green
      case LogLevel.WARN:  return `\x1b[33m${text}\x1b[0m`;  // yellow
      case LogLevel.ERROR: return `\x1b[31m${text}\x1b[0m`;  // red
      case LogLevel.FATAL: return `\x1b[35m${text}\x1b[0m`;  // magenta
      default: return text;
    }
  }
}
