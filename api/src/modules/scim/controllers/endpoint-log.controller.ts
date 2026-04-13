/**
 * Endpoint-Scoped Log Controller — Phase D Step 11
 *
 * Provides per-endpoint log access under /scim/endpoints/:endpointId/logs/*.
 * Auto-filtered by endpointId from the URL path — per-endpoint credential
 * holders can only see their own endpoint's logs.
 *
 * Delegates to LogQueryService for shared query/stream/download logic.
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
  Optional,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import { LogQueryService } from '../../logging/log-query.service';
import { LoggingService } from '../../logging/logging.service';

@Controller('endpoints/:endpointId/logs')
export class EndpointLogController {
  constructor(
    private readonly logQuery: LogQueryService,
    @Optional() @Inject(LoggingService) private readonly loggingService?: LoggingService,
  ) {}

  /**
   * GET /scim/endpoints/:endpointId/logs/recent
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
    const { count, entries } = this.logQuery.queryRecentLogs({
      limit: limit ? parseInt(limit, 10) : undefined,
      level, category, requestId, endpointId, method,
    });
    return { endpointId, count, entries };
  }

  /**
   * GET /scim/endpoints/:endpointId/logs/stream
   */
  @Get('stream')
  streamLogs(
    @Param('endpointId') endpointId: string,
    @Query('level') level: string | undefined,
    @Query('category') category: string | undefined,
    @Res() res: Response,
  ) {
    this.logQuery.setupStream(res, {
      level, category, endpointId,
      connectionMessage: 'Endpoint log stream connected',
    });
  }

  /**
   * GET /scim/endpoints/:endpointId/logs/download
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
    this.logQuery.downloadLogs(res, {
      limit: limit ? parseInt(limit, 10) : undefined,
      level, category, requestId, endpointId, format,
      filenamePrefix: `endpoint-${endpointId.slice(0, 8)}`,
    });
  }

  /**
   * GET /scim/endpoints/:endpointId/logs/history
   * Query persistent DB logs filtered by this endpoint's URL pattern.
   * Returns paginated request history with full payloads.
   */
  @Get('history')
  async getHistory(
    @Param('endpointId') endpointId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('minDurationMs') minDurationMs?: string,
  ) {
    if (!this.loggingService) {
      return { endpointId, total: 0, items: [], message: 'Persistent logging not available (InMemory backend)' };
    }

    return this.loggingService.listLogs({
      urlContains: `/endpoints/${endpointId}/`,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      method: method || undefined,
      status: status ? Number(status) : undefined,
      search: search || undefined,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      minDurationMs: minDurationMs ? Number(minDurationMs) : undefined,
      includeAdmin: false,
    });
  }
}
