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
import { EndpointService, type EndpointResponse } from '../services/endpoint.service';
import { CreateEndpointDto } from '../dto/create-endpoint.dto';
import { UpdateEndpointDto } from '../dto/update-endpoint.dto';

/**
 * Endpoint Management API Controller
 * Serves endpoints for creating, reading, updating, and deleting SCIM endpoints
 * Each endpoint gets an isolated SCIM root path at: /scim/endpoints/{endpointId}
 */
@Controller('admin/endpoints')
export class EndpointController {
  constructor(private readonly endpointService: EndpointService) {}

  /**
   * Create a new endpoint
   * POST /admin/endpoints
   * Body: { name, displayName?, description?, config? }
   * Returns: EndpointResponse with scimEndpoint path
   */
  @Post()
  async createEndpoint(@Body() dto: CreateEndpointDto): Promise<EndpointResponse> {
    return this.endpointService.createEndpoint(dto);
  }

  /**
   * List all endpoints
   * GET /admin/endpoints?active=true
   * Query params: active? (boolean - filter active/inactive endpoints)
   */
  @Get()
  async listEndpoints(@Query('active') active?: string): Promise<EndpointResponse[]> {
    const isActive = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.endpointService.listEndpoints(isActive);
  }

  /**
   * Get endpoint by ID
   * GET /admin/endpoints/{endpointId}
   */
  @Get(':endpointId')
  async getEndpoint(@Param('endpointId') endpointId: string): Promise<EndpointResponse> {
    return this.endpointService.getEndpoint(endpointId);
  }

  /**
   * Get endpoint by name
   * GET /admin/endpoints/by-name/{name}
   */
  @Get('by-name/:name')
  async getEndpointByName(@Param('name') name: string): Promise<EndpointResponse> {
    return this.endpointService.getEndpointByName(name);
  }

  /**
   * Update endpoint configuration
   * PATCH /admin/endpoints/{endpointId}
   * Body: { displayName?, description?, config?, active? }
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
   * Get endpoint statistics
   * GET /admin/endpoints/{endpointId}/stats
   * Returns: counts of users, groups, group members, and request logs
   */
  @Get(':endpointId/stats')
  async getEndpointStats(
    @Param('endpointId') endpointId: string
  ): Promise<{
    totalUsers: number;
    totalGroups: number;
    totalGroupMembers: number;
    requestLogCount: number;
  }> {
    return this.endpointService.getEndpointStats(endpointId);
  }
}
