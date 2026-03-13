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
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { PatchUserDto } from '../dto/patch-user.dto';
import { SearchRequestDto } from '../dto/search-request.dto';
import { applyAttributeProjection, applyAttributeProjectionToList } from '../common/scim-attribute-projection';
import { buildBaseUrl } from '../common/base-url.util';

/**
 * Endpoint-specific SCIM Users Controller
 * Handles all user CRUD operations scoped to a specific endpoint.
 * Routes: /scim/endpoints/{endpointId}/Users
 */
@Controller('endpoints/:endpointId')
export class EndpointScimUsersController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly usersService: EndpointScimUsersService
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
    const config: EndpointConfig = endpoint.config || {};
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, profile, config });

    return { baseUrl, config };
  }

  /**
   * POST /scim/endpoints/{endpointId}/Users
   * Create a user in the endpoint
   */
  @Post('Users')
  async createUser(
    @Param('endpointId') endpointId: string,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const result = await this.usersService.createUserForEndpoint(dto, baseUrl, endpointId, config);
    // G8g: Apply attribute projection on write-response (RFC 7644 §3.9)
    const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
    const alwaysReturnedAttrs = this.usersService.getAlwaysReturnedAttributes(endpointId);
    const alwaysReturnedSubs = this.usersService.getAlwaysReturnedSubAttrs(endpointId);
    const projected = applyAttributeProjection(result, attributes, excludedAttributes, requestOnlyAttrs, alwaysReturnedAttrs, alwaysReturnedSubs);
    return this.attachWarnings(projected, config);
  }

  /**
   * GET /scim/endpoints/{endpointId}/Users
   * List users in the endpoint with optional filters
   */
  @Get('Users')
  async listUsers(
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
    const result = await this.usersService.listUsersForEndpoint(
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

    const alwaysReturnedAttrs = this.usersService.getAlwaysReturnedAttributes(endpointId);
    const alwaysReturnedSubs = this.usersService.getAlwaysReturnedSubAttrs(endpointId);
    if (attributes || excludedAttributes) {
      const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          attributes,
          excludedAttributes,
          requestOnlyAttrs,
          alwaysReturnedAttrs,
          alwaysReturnedSubs
        )
      };
    }
    // G8e: Even without projection params, strip returned:'request' attrs
    const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
    if (requestOnlyAttrs.size > 0) {
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          undefined,
          undefined,
          requestOnlyAttrs,
          alwaysReturnedAttrs,
          alwaysReturnedSubs
        )
      };
    }
    return result;
  }

  /**
   * POST /scim/endpoints/{endpointId}/Users/.search
   * Search users using POST body (RFC 7644 §3.4.3)
   */
  @Post('Users/.search')
  @HttpCode(200)
  async searchUsers(
    @Param('endpointId') endpointId: string,
    @Body() dto: SearchRequestDto,
    @Req() req: Request
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const result = await this.usersService.listUsersForEndpoint(
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

    const alwaysReturnedAttrs = this.usersService.getAlwaysReturnedAttributes(endpointId);
    const alwaysReturnedSubs = this.usersService.getAlwaysReturnedSubAttrs(endpointId);
    if (dto.attributes || dto.excludedAttributes) {
      const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          dto.attributes,
          dto.excludedAttributes,
          requestOnlyAttrs,
          alwaysReturnedAttrs,
          alwaysReturnedSubs
        )
      };
    }
    const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
    if (requestOnlyAttrs.size > 0) {
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          undefined,
          undefined,
          requestOnlyAttrs,
          alwaysReturnedAttrs,
          alwaysReturnedSubs
        )
      };
    }
    return result;
  }

  /**
   * GET /scim/endpoints/{endpointId}/Users/{id}
   * Get a specific user in the endpoint
   */
  @Get('Users/:id')
  async getUser(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const result = await this.usersService.getUserForEndpoint(id, baseUrl, endpointId, config);
    const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
    const alwaysReturnedAttrs = this.usersService.getAlwaysReturnedAttributes(endpointId);
    const alwaysReturnedSubs = this.usersService.getAlwaysReturnedSubAttrs(endpointId);
    return applyAttributeProjection(result, attributes, excludedAttributes, requestOnlyAttrs, alwaysReturnedAttrs, alwaysReturnedSubs);
  }

  /**
   * PUT /scim/endpoints/{endpointId}/Users/{id}
   * Replace a user in the endpoint
   */
  @Put('Users/:id')
  async replaceUser(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.usersService.replaceUserForEndpoint(id, dto, baseUrl, endpointId, config, ifMatch);
    // G8g: Apply attribute projection on write-response (RFC 7644 §3.9)
    const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
    const alwaysReturnedAttrs = this.usersService.getAlwaysReturnedAttributes(endpointId);
    const alwaysReturnedSubs = this.usersService.getAlwaysReturnedSubAttrs(endpointId);
    const projected = applyAttributeProjection(result, attributes, excludedAttributes, requestOnlyAttrs, alwaysReturnedAttrs, alwaysReturnedSubs);
    return this.attachWarnings(projected, config);
  }

  /**
   * PATCH /scim/endpoints/{endpointId}/Users/{id}
   * Update a user in the endpoint
   */
  @Patch('Users/:id')
  async updateUser(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Body() dto: PatchUserDto,
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.usersService.patchUserForEndpoint(id, dto, baseUrl, endpointId, config, ifMatch);
    // G8g: Apply attribute projection on write-response (RFC 7644 §3.9)
    const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
    const alwaysReturnedAttrs = this.usersService.getAlwaysReturnedAttributes(endpointId);
    const alwaysReturnedSubs = this.usersService.getAlwaysReturnedSubAttrs(endpointId);
    const projected = applyAttributeProjection(result, attributes, excludedAttributes, requestOnlyAttrs, alwaysReturnedAttrs, alwaysReturnedSubs);
    return this.attachWarnings(projected, config);
  }

  /**
   * DELETE /scim/endpoints/{endpointId}/Users/{id}
   * Delete a user in the endpoint
   */
  @Delete('Users/:id')
  @HttpCode(204)
  async deleteUser(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Req() req: Request
  ): Promise<void> {
    const { config } = await this.validateAndSetContext(endpointId, req);
    const ifMatch = req.headers['if-match'] as string | undefined;
    return this.usersService.deleteUserForEndpoint(id, endpointId, config, ifMatch);
  }
}
