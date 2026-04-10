import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  Query
} from '@nestjs/common';
import {
  EndpointService,
  type EndpointResponse,
  type EndpointListResponse,
  type EndpointStatsResponse,
  type PresetListResponse,
} from '../services/endpoint.service';
import { CreateEndpointDto } from '../dto/create-endpoint.dto';
import { UpdateEndpointDto } from '../dto/update-endpoint.dto';

/**
 * Endpoint Management API Controller
 * Serves endpoints for creating, reading, updating, and deleting SCIM endpoints.
 * Each endpoint gets an isolated SCIM root path at: /scim/endpoints/{endpointId}
 *
 * Query param `view` controls response verbosity:
 *  - `summary` (default for list) — profileSummary digest, no full profile
 *  - `full`    (default for single-get) — full profile included
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
  ): Promise<EndpointResponse> {
    const resolvedView = (view === 'full' || view === 'summary') ? view : 'full';
    return this.endpointService.getEndpoint(endpointId, resolvedView);
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
   */
  @Patch(':endpointId')
  async updateEndpoint(
    @Param('endpointId') endpointId: string,
    @Body() dto: UpdateEndpointDto
  ): Promise<EndpointResponse> {
    return this.endpointService.updateEndpoint(endpointId, dto);
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
