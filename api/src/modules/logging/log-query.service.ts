/**
 * LogQueryService - Shared log query, streaming, and download logic.
 *
 * Extracted from LogConfigController and EndpointLogController to eliminate
 * duplication. Both controllers delegate to this service for:
 *   - Ring buffer querying with filters
 *   - SSE stream setup with filters + keepalive
 *   - File download (NDJSON/JSON) with filters
 *
 * @see LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md §24 (Tenant Log Isolation)
 */
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ScimLogger, type StructuredLogEntry } from './scim-logger.service';
import {
  LogLevel,
  LogCategory,
  parseLogLevel,
} from './log-levels';

export interface LogQueryOptions {
  limit?: number;
  level?: string;
  category?: string;
  requestId?: string;
  endpointId?: string;
  method?: string;
}

@Injectable()
export class LogQueryService {
  constructor(private readonly scimLogger: ScimLogger) {}

  /**
   * Query the ring buffer with optional filters.
   * Returns filtered entries + count.
   */
  queryRecentLogs(options: LogQueryOptions): { count: number; entries: StructuredLogEntry[] } {
    const entries = this.scimLogger.getRecentLogs({
      limit: options.limit,
      level: options.level ? parseLogLevel(options.level) : undefined,
      category: options.category as LogCategory | undefined,
      requestId: options.requestId || undefined,
      endpointId: options.endpointId || undefined,
    });

    // Optional HTTP method filter (not supported by ring buffer natively)
    const filtered = options.method
      ? entries.filter(e => e.method?.toUpperCase() === options.method!.toUpperCase())
      : entries;

    return { count: filtered.length, entries: filtered };
  }

  /**
   * Set up an SSE stream with optional filters.
   * Handles headers, subscription, keepalive, and cleanup.
   */
  setupStream(
    res: Response,
    options: {
      level?: string;
      category?: string;
      endpointId?: string;
      connectionMessage?: string;
    },
  ): void {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial connection event
    const connData = {
      message: options.connectionMessage ?? 'Log stream connected',
      filters: {
        level: options.level ?? 'ALL',
        category: options.category ?? 'ALL',
        endpointId: options.endpointId ?? 'ALL',
      },
    };
    res.write(`event: connected\ndata: ${JSON.stringify(connData)}\n\n`);

    // Parse filter options
    const minLevel = options.level ? parseLogLevel(options.level) : undefined;
    const filterCategory = options.category as LogCategory | undefined;
    const filterEndpointId = options.endpointId;

    // Subscribe to live log entries
    const unsubscribe = this.scimLogger.subscribe((entry) => {
      // Endpoint scope filter
      if (filterEndpointId && entry.endpointId !== filterEndpointId) return;

      // Level filter
      if (minLevel !== undefined) {
        const parsed = LogLevel[entry.level as keyof typeof LogLevel];
        const entryLevel = typeof parsed === 'number' ? parsed : Number(LogLevel.INFO);
        if (entryLevel < Number(minLevel)) return;
      }

      // Category filter
      if (filterCategory && entry.category !== (filterCategory as string)) return;

      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      res.write(`: ping ${new Date().toISOString()}\n\n`);
    }, 30_000);

    // Cleanup on client disconnect
    res.on('close', () => {
      unsubscribe();
      clearInterval(keepAlive);
      res.end();
    });
  }

  /**
   * Download ring buffer entries as NDJSON or JSON file.
   */
  downloadLogs(
    res: Response,
    options: LogQueryOptions & { format?: string; filenamePrefix?: string },
  ): void {
    const { count, entries } = this.queryRecentLogs(options);

    const outputFormat = options.format === 'json' ? 'json' : 'ndjson';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefix = options.filenamePrefix ?? 'scimserver';
    const filename = `${prefix}-logs-${timestamp}.${outputFormat}`;

    res.setHeader('Content-Type', outputFormat === 'json' ? 'application/json' : 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (outputFormat === 'json') {
      res.send(JSON.stringify(entries, null, 2));
    } else {
      const ndjson = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      res.send(ndjson);
    }
  }
}
