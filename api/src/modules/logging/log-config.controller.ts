import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
} from '@nestjs/common';
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
}
