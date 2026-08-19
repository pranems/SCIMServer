import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  Query,
  Headers,
  Res
} from '@nestjs/common';
import type { Response } from 'express';
import {
  EndpointService,
  type EndpointResponse,
  type EndpointListResponse,
  type EndpointStatsResponse,
  type PresetListResponse,
} from '../services/endpoint.service';
import { CreateEndpointDto } from '../dto/create-endpoint.dto';
import { UpdateEndpointDto } from '../dto/update-endpoint.dto';
import { endpointETag, assertEndpointIfMatch } from './endpoint-etag';

/**
 * Endpoint Management API Controller
 * Serves endpoints for creating, reading, updating, and deleting SCIM endpoints.
 * Each endpoint gets an isolated SCIM root path at: /scim/endpoints/{endpointId}
 *
 * Query param `view` controls response verbosity:
 *  - `summary` (default for list) - profileSummary digest, no full profile
 *  - `full`    (default for single-get) - full profile included
 */
@Controller('admin/endpoints')
export class EndpointController {
  constructor(private readonly endpointService: EndpointService) {}

  /**
   * Create a new endpoint
   * POST /admin/endpoints
   * Body: { name, displayName?, description?, profilePreset?, profile? }
   * Returns: EndpointResponse (full view) with scimBasePath
   */
  @Post()
  async createEndpoint(@Body() dto: CreateEndpointDto): Promise<EndpointResponse> {
    return this.endpointService.createEndpoint(dto);
  }

  /**
   * List all endpoints
   * GET /admin/endpoints?active=true&view=summary|full
   * Returns: { totalResults, endpoints[] }
   */
  @Get()
  async listEndpoints(
    @Query('active') active?: string,
    @Query('view') view?: string,
  ): Promise<EndpointListResponse> {
    const isActive = active === 'true' ? true : active === 'false' ? false : undefined;
    const resolvedView = (view === 'full' || view === 'summary') ? view : 'summary';
    return this.endpointService.listEndpoints(isActive, resolvedView);
  }

  /**
   * List available built-in profile presets (summary)
   * GET /admin/endpoints/presets
   * Returns: { totalResults, presets[] } with profile summaries
   */
  @Get('presets')
  listPresets(): PresetListResponse {
    return this.endpointService.listPresets();
  }

  /**
   * Get a single built-in preset by name (full profile)
   * GET /admin/endpoints/presets/{name}
   */
  @Get('presets/:name')
  getPreset(@Param('name') name: string) {
    return this.endpointService.getPreset(name);
  }

  /**
   * Get endpoint by ID
   * GET /admin/endpoints/{endpointId}?view=full|summary
   */
  @Get(':endpointId')
  async getEndpoint(
    @Param('endpointId') endpointId: string,
    @Query('view') view?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<EndpointResponse> {
    const resolvedView = (view === 'full' || view === 'summary') ? view : 'full';
    const endpoint = await this.endpointService.getEndpoint(endpointId, resolvedView);
    // A9 - the token a caller echoes back in If-Match to detect a lost update.
    res?.setHeader('ETag', endpointETag(endpoint));
    return endpoint;
  }

  /**
   * Get endpoint by name
   * GET /admin/endpoints/by-name/{name}?view=full|summary
   */
  @Get('by-name/:name')
  async getEndpointByName(
    @Param('name') name: string,
    @Query('view') view?: string,
  ): Promise<EndpointResponse> {
    const resolvedView = (view === 'full' || view === 'summary') ? view : 'full';
    return this.endpointService.getEndpointByName(name, resolvedView);
  }

  /**
   * Update endpoint configuration
   * PATCH /admin/endpoints/{endpointId}
   * Body: { displayName?, description?, profile?, active? }
   *
   * A9 - send `If-Match` with the ETag from a prior GET to make the write
   * conditional. Omitting it preserves the previous last-write-wins behavior.
   */
  @Patch(':endpointId')
  async updateEndpoint(
    @Param('endpointId') endpointId: string,
    @Body() dto: UpdateEndpointDto,
    @Headers('if-match') ifMatch?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<EndpointResponse> {
    if (ifMatch) {
      // Read-then-compare BEFORE the write, so a stale caller never mutates.
      assertEndpointIfMatch(await this.endpointService.getEndpoint(endpointId, 'full'), ifMatch);
    }
    const updated = await this.endpointService.updateEndpoint(endpointId, dto);
    // Hand back the new token so a client can chain edits without re-reading.
    res?.setHeader('ETag', endpointETag(updated));
    return updated;
  }

  /**
   * Delete endpoint and all associated data
   * DELETE /admin/endpoints/{endpointId}
   * Cascade deletes all users, groups, group members, and logs for this endpoint
   */
  @Delete(':endpointId')
  @HttpCode(204)
  async deleteEndpoint(@Param('endpointId') endpointId: string): Promise<void> {
    return this.endpointService.deleteEndpoint(endpointId);
  }

  /**
   * Get endpoint statistics (nested format)
   * GET /admin/endpoints/{endpointId}/stats
   * Returns: { users: { total, active, inactive }, groups: { ... }, groupMembers, requestLogs }
   */
  @Get(':endpointId/stats')
  async getEndpointStats(
    @Param('endpointId') endpointId: string
  ): Promise<EndpointStatsResponse> {
    return this.endpointService.getEndpointStats(endpointId);
  }
}
