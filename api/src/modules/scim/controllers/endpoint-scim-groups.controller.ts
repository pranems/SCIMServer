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
import { getConfigBoolean, ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { SCIM_WARNING_URN } from '../common/scim-service-helpers';
import { EndpointScimGroupsService } from '../services/endpoint-scim-groups.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { CreateGroupDto } from '../dto/create-group.dto';
import { PatchGroupDto } from '../dto/patch-group.dto';
import { SearchRequestDto } from '../dto/search-request.dto';
import { applyAttributeProjection, applyAttributeProjectionToList } from '../common/scim-attribute-projection';
import { buildBaseUrl } from '../common/base-url.util';

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
   * Attach readOnly-stripping warnings to a write response when
   * IncludeWarningAboutIgnoredReadOnlyAttribute is enabled.
   */
  private attachWarnings(result: Record<string, unknown>, config?: EndpointConfig): Record<string, unknown> {
    const warnings = this.endpointContext.getWarnings();
    if (warnings.length === 0) return result;
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE)) return result;

    const schemas = [...((result.schemas as string[]) ?? [])];
    if (!schemas.includes(SCIM_WARNING_URN)) {
      schemas.push(SCIM_WARNING_URN);
    }

    return {
      ...result,
      schemas,
      [SCIM_WARNING_URN]: { warnings },
    };
  }

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

    const profile = endpoint.profile;
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, profile, config });

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
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const result = await this.groupsService.createGroupForEndpoint(dto, baseUrl, endpointId, config);
    // G8g: Apply attribute projection on write-response (RFC 7644 §3.9)
    const alwaysByParent = this.groupsService.getAlwaysReturnedByParent(endpointId);
    const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
    const projected = applyAttributeProjection(result, attributes, excludedAttributes, alwaysByParent, requestByParent);
    return this.attachWarnings(projected, config);
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
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ascending' | 'descending',
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const result = await this.groupsService.listGroupsForEndpoint(
      {
        filter,
        startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
        count: count ? parseInt(count, 10) : undefined,
        sortBy,
        sortOrder
      },
      baseUrl,
      endpointId,
      config,
    );

    const alwaysByParent = this.groupsService.getAlwaysReturnedByParent(endpointId);
    if (attributes || excludedAttributes) {
      const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          attributes,
          excludedAttributes,
          alwaysByParent,
          requestByParent
        )
      };
    }
    const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
    if (requestByParent.size > 0) {
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          undefined,
          undefined,
          alwaysByParent,
          requestByParent
        )
      };
    }
    return result;
  }

  /**
   * POST /scim/endpoints/{endpointId}/Groups/.search
   * Search groups using POST body (RFC 7644 §3.4.3)
   */
  @Post('Groups/.search')
  @HttpCode(200)
  async searchGroups(
    @Param('endpointId') endpointId: string,
    @Body() dto: SearchRequestDto,
    @Req() req: Request
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const result = await this.groupsService.listGroupsForEndpoint(
      {
        filter: dto.filter,
        startIndex: dto.startIndex,
        count: dto.count,
        sortBy: dto.sortBy,
        sortOrder: dto.sortOrder
      },
      baseUrl,
      endpointId,
      config,
    );

    const alwaysByParent = this.groupsService.getAlwaysReturnedByParent(endpointId);
    if (dto.attributes || dto.excludedAttributes) {
      const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          dto.attributes,
          dto.excludedAttributes,
          alwaysByParent,
          requestByParent
        )
      };
    }
    const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
    if (requestByParent.size > 0) {
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          undefined,
          undefined,
          alwaysByParent,
          requestByParent
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
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const result = await this.groupsService.getGroupForEndpoint(id, baseUrl, endpointId, config);
    const alwaysByParent = this.groupsService.getAlwaysReturnedByParent(endpointId);
    const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
    return applyAttributeProjection(result, attributes, excludedAttributes, alwaysByParent, requestByParent);
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
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.groupsService.replaceGroupForEndpoint(id, dto, baseUrl, endpointId, config, ifMatch);
    // G8g: Apply attribute projection on write-response (RFC 7644 §3.9)
    const alwaysByParent = this.groupsService.getAlwaysReturnedByParent(endpointId);
    const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
    const projected = applyAttributeProjection(result, attributes, excludedAttributes, alwaysByParent, requestByParent);
    return this.attachWarnings(projected, config);
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
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.groupsService.patchGroupForEndpoint(id, dto, baseUrl, endpointId, config, ifMatch);
    // G8g: Apply attribute projection on write-response (RFC 7644 §3.9)
    const alwaysByParent = this.groupsService.getAlwaysReturnedByParent(endpointId);
    const requestByParent = this.groupsService.getRequestReturnedByParent(endpointId);
    const projected = applyAttributeProjection(result, attributes, excludedAttributes, alwaysByParent, requestByParent);
    return this.attachWarnings(projected, config);
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
    const { config } = await this.validateAndSetContext(endpointId, req);
    const ifMatch = req.headers['if-match'] as string | undefined;
    return this.groupsService.deleteGroupForEndpoint(id, endpointId, config, ifMatch);
  }

}
