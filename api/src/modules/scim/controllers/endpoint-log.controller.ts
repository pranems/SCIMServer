/**
 * Endpoint-Scoped Log Controller — Phase D Step 11
 *
 * Provides per-endpoint log access under /scim/endpoints/:endpointId/logs/*.
 * Auto-filtered by endpointId from the URL path — per-endpoint credential
 * holders can only see their own endpoint's logs.
 *
 * Routes:
 *   GET  /scim/endpoints/:endpointId/logs/recent    — Ring buffer filtered by endpointId
 *   GET  /scim/endpoints/:endpointId/logs/stream     — SSE stream filtered by endpointId
 *   GET  /scim/endpoints/:endpointId/logs/download   — File download filtered by endpointId
 *
 * @see LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md §24 (Tenant Log Isolation)
 */
import {
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ScimLogger } from '../../logging/scim-logger.service';
import {
  LogLevel,
  LogCategory,
  logLevelName,
  parseLogLevel,
} from '../../logging/log-levels';

@Controller('endpoints/:endpointId/logs')
export class EndpointLogController {
  constructor(private readonly scimLogger: ScimLogger) {}

  /**
   * GET /scim/endpoints/:endpointId/logs/recent
   * Ring buffer entries filtered to this endpoint only.
   */
  @Get('recent')
  getRecentLogs(
    @Param('endpointId') endpointId: string,
    @Query('limit') limit?: string,
    @Query('level') level?: string,
    @Query('category') category?: string,
    @Query('requestId') requestId?: string,
    @Query('method') method?: string,
  ) {
    const entries = this.scimLogger.getRecentLogs({
      limit: limit ? parseInt(limit, 10) : undefined,
      level: level ? parseLogLevel(level) : undefined,
      category: category as LogCategory | undefined,
      requestId: requestId || undefined,
      endpointId, // Always scoped to this endpoint
    });

    // Optional: filter by HTTP method if provided
    const filtered = method
      ? entries.filter(e => e.method?.toUpperCase() === method.toUpperCase())
      : entries;

    return {
      endpointId,
      count: filtered.length,
      entries: filtered,
    };
  }

  /**
   * GET /scim/endpoints/:endpointId/logs/stream
   * SSE stream filtered to this endpoint only.
   */
  @Get('stream')
  streamLogs(
    @Param('endpointId') endpointId: string,
    @Query('level') level: string | undefined,
    @Query('category') category: string | undefined,
    @Res() res: Response,
  ) {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({
      message: 'Endpoint log stream connected',
      endpointId,
      filters: {
        level: level ?? 'ALL',
        category: category ?? 'ALL',
      },
    })}\n\n`);

    // Parse filter options
    const minLevel = level ? parseLogLevel(level) : undefined;
    const filterCategory = category as LogCategory | undefined;

    // Subscribe to live log entries — auto-filtered by endpointId
    const unsubscribe = this.scimLogger.subscribe((entry) => {
      // Enforce endpoint scope
      if (entry.endpointId !== endpointId) return;

      // Apply level filter
      if (minLevel !== undefined) {
        const parsed = LogLevel[entry.level as keyof typeof LogLevel];
        const entryLevel = typeof parsed === 'number' ? parsed : Number(LogLevel.INFO);
        if (entryLevel < Number(minLevel)) return;
      }

      // Apply category filter
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
   * GET /scim/endpoints/:endpointId/logs/download
   * Download ring buffer entries as NDJSON or JSON file, filtered to this endpoint.
   */
  @Get('download')
  downloadLogs(
    @Param('endpointId') endpointId: string,
    @Query('format') format: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('level') level: string | undefined,
    @Query('category') category: string | undefined,
    @Query('requestId') requestId: string | undefined,
    @Res() res: Response,
  ) {
    const entries = this.scimLogger.getRecentLogs({
      limit: limit ? parseInt(limit, 10) : undefined,
      level: level ? parseLogLevel(level) : undefined,
      category: category as LogCategory | undefined,
      requestId: requestId || undefined,
      endpointId, // Always scoped to this endpoint
    });

    const outputFormat = format === 'json' ? 'json' : 'ndjson';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `endpoint-${endpointId.slice(0, 8)}-logs-${timestamp}.${outputFormat}`;

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
