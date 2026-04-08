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
} from '@nestjs/common';
import type { Response } from 'express';
import { LogQueryService } from '../../logging/log-query.service';

@Controller('endpoints/:endpointId/logs')
export class EndpointLogController {
  constructor(private readonly logQuery: LogQueryService) {}

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
}
