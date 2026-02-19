import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ScimLogger } from './scim-logger.service';
import {
  LogLevel,
  LogCategory,
  logLevelName,
  parseLogLevel,
  type LogConfig,
} from './log-levels';

/**
 * Admin Log Configuration Controller
 *
 * Provides runtime log management without server restart:
 * - GET/PUT global log configuration
 * - Override log levels per-category and per-endpoint
 * - View recent in-memory logs (ring buffer)
 * - Filter logs by level, category, request ID, endpoint
 *
 * Routes: /scim/admin/log-config/*
 */
@Controller('admin/log-config')
export class LogConfigController {
  constructor(private readonly scimLogger: ScimLogger) {}

  /**
   * GET /scim/admin/log-config
   * Returns the current runtime log configuration.
   */
  @Get()
  getConfig() {
    const config = this.scimLogger.getConfig();
    return {
      globalLevel: logLevelName(config.globalLevel),
      categoryLevels: Object.fromEntries(
        Object.entries(config.categoryLevels).map(([k, v]) => [k, logLevelName(v!)])
      ),
      endpointLevels: Object.fromEntries(
        Object.entries(config.endpointLevels).map(([k, v]) => [k, logLevelName(v)])
      ),
      includePayloads: config.includePayloads,
      includeStackTraces: config.includeStackTraces,
      maxPayloadSizeBytes: config.maxPayloadSizeBytes,
      format: config.format,
      availableLevels: Object.keys(LogLevel).filter(k => isNaN(Number(k))),
      availableCategories: Object.values(LogCategory),
    };
  }

  /**
   * PUT /scim/admin/log-config
   * Update the runtime log configuration. Partial updates supported.
   */
  @Put()
  updateConfig(@Body() body: Record<string, unknown>) {
    const updates: Partial<LogConfig> = {};

    if (typeof body.globalLevel === 'string') {
      updates.globalLevel = parseLogLevel(body.globalLevel);
    }
    if (typeof body.includePayloads === 'boolean') {
      updates.includePayloads = body.includePayloads;
    }
    if (typeof body.includeStackTraces === 'boolean') {
      updates.includeStackTraces = body.includeStackTraces;
    }
    if (typeof body.maxPayloadSizeBytes === 'number') {
      updates.maxPayloadSizeBytes = body.maxPayloadSizeBytes;
    }
    if (body.format === 'json' || body.format === 'pretty') {
      updates.format = body.format;
    }
    if (typeof body.categoryLevels === 'object' && body.categoryLevels !== null) {
      const catLevels: Partial<Record<LogCategory, LogLevel>> = {};
      for (const [cat, level] of Object.entries(body.categoryLevels as Record<string, string>)) {
        if (Object.values(LogCategory).includes(cat as LogCategory)) {
          catLevels[cat as LogCategory] = parseLogLevel(level);
        }
      }
      updates.categoryLevels = catLevels;
    }

    this.scimLogger.updateConfig(updates);

    return {
      message: 'Log configuration updated',
      config: this.getConfig(),
    };
  }

  /**
   * PUT /scim/admin/log-config/level/:level
   * Quick shortcut to set the global log level.
   */
  @Put('level/:level')
  setGlobalLevel(@Param('level') level: string) {
    this.scimLogger.setGlobalLevel(level);
    return {
      message: `Global log level set to ${level.toUpperCase()}`,
      globalLevel: logLevelName(this.scimLogger.getConfig().globalLevel),
    };
  }

  /**
   * PUT /scim/admin/log-config/category/:category/:level
   * Set log level for a specific category.
   */
  @Put('category/:category/:level')
  setCategoryLevel(
    @Param('category') category: string,
    @Param('level') level: string,
  ) {
    if (!Object.values(LogCategory).includes(category as LogCategory)) {
      return {
        error: `Unknown category '${category}'`,
        availableCategories: Object.values(LogCategory),
      };
    }
    this.scimLogger.setCategoryLevel(category as LogCategory, level);
    return {
      message: `Category '${category}' log level set to ${level.toUpperCase()}`,
    };
  }

  /**
   * PUT /scim/admin/log-config/endpoint/:endpointId/:level
   * Set log level override for a specific endpoint.
   */
  @Put('endpoint/:endpointId/:level')
  setEndpointLevel(
    @Param('endpointId') endpointId: string,
    @Param('level') level: string,
  ) {
    this.scimLogger.setEndpointLevel(endpointId, level);
    return {
      message: `Endpoint '${endpointId}' log level set to ${level.toUpperCase()}`,
    };
  }

  /**
   * DELETE /scim/admin/log-config/endpoint/:endpointId
   * Remove endpoint-specific log level override.
   */
  @Delete('endpoint/:endpointId')
  @HttpCode(204)
  clearEndpointLevel(@Param('endpointId') endpointId: string) {
    this.scimLogger.clearEndpointLevel(endpointId);
  }

  /**
   * GET /scim/admin/log-config/recent
   * Retrieve recent log entries from the in-memory ring buffer.
   * Useful for real-time debugging without external log infrastructure.
   */
  @Get('recent')
  getRecentLogs(
    @Query('limit') limit?: string,
    @Query('level') level?: string,
    @Query('category') category?: string,
    @Query('requestId') requestId?: string,
    @Query('endpointId') endpointId?: string,
  ) {
    const entries = this.scimLogger.getRecentLogs({
      limit: limit ? parseInt(limit, 10) : undefined,
      level: level ? parseLogLevel(level) : undefined,
      category: category as LogCategory | undefined,
      requestId: requestId || undefined,
      endpointId: endpointId || undefined,
    });
    return {
      count: entries.length,
      entries,
    };
  }

  /**
   * DELETE /scim/admin/log-config/recent
   * Clear the in-memory ring buffer.
   */
  @Delete('recent')
  @HttpCode(204)
  clearRecentLogs() {
    this.scimLogger.clearRecentLogs();
  }

  /**
   * GET /scim/admin/log-config/stream
   * Server-Sent Events (SSE) endpoint for real-time log tailing.
   *
   * Streams log entries as they occur. Supports optional query filters:
   *   ?level=WARN      — only entries ≥ WARN
   *   ?category=http   — only entries matching category
   *   ?endpointId=xxx  — only entries for a specific endpoint
   *
   * Usage:
   *   curl -N https://host/scim/admin/log-config/stream?level=INFO
   *   EventSource: new EventSource('/scim/admin/log-config/stream')
   */
  @Get('stream')
  streamLogs(
    @Query('level') level: string | undefined,
    @Query('category') category: string | undefined,
    @Query('endpointId') endpointId: string | undefined,
    @Res() res: Response,
  ) {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable NGINX buffering
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Log stream connected', filters: { level: level ?? 'ALL', category: category ?? 'ALL', endpointId: endpointId ?? 'ALL' } })}\n\n`);

    // Parse filter options
    const minLevel = level ? parseLogLevel(level) : undefined;
    const filterCategory = category as LogCategory | undefined;

    // Subscribe to live log entries
    const unsubscribe = this.scimLogger.subscribe((entry) => {
      // Apply filters
      if (minLevel !== undefined) {
        const parsed = LogLevel[entry.level as keyof typeof LogLevel];
        const entryLevel = typeof parsed === 'number' ? parsed : Number(LogLevel.INFO);
        if (entryLevel < Number(minLevel)) return;
      }
      if (filterCategory && entry.category !== (filterCategory as string)) return;
      if (endpointId && entry.endpointId !== endpointId) return;

      // Send SSE event
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    // Keep-alive ping every 30s to prevent proxy timeouts
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
   * GET /scim/admin/log-config/download
   * Download recent log entries as a JSON or NDJSON file.
   *
   * Query params:
   *   ?format=ndjson  — Newline-delimited JSON (default)
   *   ?format=json    — JSON array
   *   ?limit=500      — Max entries (default: all in ring buffer, max 500)
   *   ?level=WARN     — Minimum level filter
   *   ?category=http  — Category filter
   *
   * The response is a downloadable file with Content-Disposition header.
   */
  @Get('download')
  downloadLogs(
    @Query('format') format: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('level') level: string | undefined,
    @Query('category') category: string | undefined,
    @Query('requestId') requestId: string | undefined,
    @Query('endpointId') endpointId: string | undefined,
    @Res() res: Response,
  ) {
    const entries = this.scimLogger.getRecentLogs({
      limit: limit ? parseInt(limit, 10) : undefined,
      level: level ? parseLogLevel(level) : undefined,
      category: category as LogCategory | undefined,
      requestId: requestId || undefined,
      endpointId: endpointId || undefined,
    });

    const outputFormat = format === 'json' ? 'json' : 'ndjson';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `scimserver-logs-${timestamp}.${outputFormat}`;

    res.setHeader('Content-Type', outputFormat === 'json' ? 'application/json' : 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (outputFormat === 'json') {
      res.send(JSON.stringify(entries, null, 2));
    } else {
      // NDJSON — one JSON object per line
      const ndjson = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      res.send(ndjson);
    }
  }
}
