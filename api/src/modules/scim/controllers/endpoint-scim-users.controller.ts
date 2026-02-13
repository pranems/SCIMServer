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
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, config });

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
    @Req() req: Request
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.usersService.createUserForEndpoint(dto, baseUrl, endpointId);
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
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    const result = await this.usersService.listUsersForEndpoint(
      {
        filter,
        startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
        count: count ? parseInt(count, 10) : undefined
      },
      baseUrl,
      endpointId
    );

    if (attributes || excludedAttributes) {
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          attributes,
          excludedAttributes
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
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    const result = await this.usersService.listUsersForEndpoint(
      {
        filter: dto.filter,
        startIndex: dto.startIndex,
        count: dto.count
      },
      baseUrl,
      endpointId
    );

    if (dto.attributes || dto.excludedAttributes) {
      return {
        ...result,
        Resources: applyAttributeProjectionToList(
          result.Resources,
          dto.attributes,
          dto.excludedAttributes
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
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    const result = await this.usersService.getUserForEndpoint(id, baseUrl, endpointId);
    return applyAttributeProjection(result, attributes, excludedAttributes);
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
    @Req() req: Request
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.usersService.replaceUserForEndpoint(id, dto, baseUrl, endpointId);
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
    @Req() req: Request
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    return this.usersService.patchUserForEndpoint(id, dto, baseUrl, endpointId, config);
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
    await this.validateAndSetContext(endpointId, req);
    return this.usersService.deleteUserForEndpoint(id, endpointId);
  }
}
