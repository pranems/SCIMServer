import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  ForbiddenException
} from '@nestjs/common';
import type { Request } from 'express';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { EndpointScimGroupsService } from '../services/endpoint-scim-groups.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import type { CreateGroupDto } from '../dto/create-group.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';

/**
 * Endpoint-specific SCIM Groups Controller
 * Handles all group CRUD operations scoped to a specific endpoint.
 * Routes: /scim/endpoints/{endpointId}/Groups
 */
@Controller('endpoints/:endpointId')
export class EndpointScimGroupsController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly groupsService: EndpointScimGroupsService
  ) {}

  /**
   * Validate endpoint exists, is active, and set endpoint context for all sub-routes.
   * Throws ForbiddenException if endpoint is inactive.
   */
  private async validateAndSetContext(
    endpointId: string,
    req: Request
  ): Promise<{ baseUrl: string; config: EndpointConfig }> {
    const endpoint = await this.endpointService.getEndpoint(endpointId);

    if (!endpoint.active) {
      throw new ForbiddenException(`Endpoint "${endpoint.name}" is inactive. SCIM operations are not allowed.`);
    }

    const config: EndpointConfig = endpoint.config || {};
    const baseUrl = `${req.protocol}://${req.get('host')}/scim/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, config });

    return { baseUrl, config };
  }

  // ===== Groups Endpoints =====

  /**
   * POST /scim/endpoints/{endpointId}/Groups
   * Create a group in the endpoint
   */
  @Post('Groups')
  async createGroup(
    @Param('endpointId') endpointId: string,
    @Body() dto: CreateGroupDto,
    @Req() req: Request
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.groupsService.createGroupForEndpoint(dto, baseUrl, endpointId);
  }

  /**
   * GET /scim/endpoints/{endpointId}/Groups
   * List groups in the endpoint with optional filters
   */
  @Get('Groups')
  async listGroups(
    @Param('endpointId') endpointId: string,
    @Req() req: Request,
    @Query('filter') filter?: string,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    const result = await this.groupsService.listGroupsForEndpoint(
      {
        filter,
        startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
        count: count ? parseInt(count, 10) : undefined
      },
      baseUrl,
      endpointId
    );

    if (excludedAttributes) {
      return {
        ...result,
        Resources: result.Resources.map((r: Record<string, unknown>) =>
          this.stripExcludedAttributes(r, excludedAttributes)
        )
      };
    }
    return result;
  }

  /**
   * GET /scim/endpoints/{endpointId}/Groups/{id}
   * Get a specific group in the endpoint
   */
  @Get('Groups/:id')
  async getGroup(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    const result = await this.groupsService.getGroupForEndpoint(id, baseUrl, endpointId);
    return excludedAttributes ? this.stripExcludedAttributes(result, excludedAttributes) : result;
  }

  /**
   * PUT /scim/endpoints/{endpointId}/Groups/{id}
   * Replace a group in the endpoint
   */
  @Put('Groups/:id')
  async replaceGroup(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Body() dto: CreateGroupDto,
    @Req() req: Request
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.groupsService.replaceGroupForEndpoint(id, dto, baseUrl, endpointId);
  }

  /**
   * PATCH /scim/endpoints/{endpointId}/Groups/{id}
   * Update a group in the endpoint
   */
  @Patch('Groups/:id')
  async updateGroup(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Body() dto: PatchGroupDto,
    @Req() req: Request
  ) {
    const { config } = await this.validateAndSetContext(endpointId, req);
    return this.groupsService.patchGroupForEndpoint(id, dto, endpointId, config);
  }

  /**
   * DELETE /scim/endpoints/{endpointId}/Groups/{id}
   * Delete a group in the endpoint
   */
  @Delete('Groups/:id')
  @HttpCode(204)
  async deleteGroup(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Req() req: Request
  ): Promise<void> {
    await this.validateAndSetContext(endpointId, req);
    return this.groupsService.deleteGroupForEndpoint(id, endpointId);
  }

  // ===== Helper Methods =====

  /**
   * Strip excluded attributes from a SCIM resource response.
   * Per RFC 7644 §3.4.2.5: excludedAttributes query parameter.
   */
  private stripExcludedAttributes(
    resource: Record<string, unknown>,
    excludedAttributes: string
  ): Record<string, unknown> {
    const toExclude = new Set(
      excludedAttributes.split(',').map(a => a.trim().toLowerCase())
    );
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resource)) {
      if (!toExclude.has(key.toLowerCase())) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

}
