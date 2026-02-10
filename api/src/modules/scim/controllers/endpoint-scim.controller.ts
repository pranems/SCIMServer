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
  Res,
  HttpCode,
  ForbiddenException
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';
import { EndpointScimGroupsService } from '../services/endpoint-scim-groups.service';
import { ScimMetadataService } from '../services/scim-metadata.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';
import type { CreateGroupDto } from '../dto/create-group.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';
import { SCIM_SP_CONFIG_SCHEMA } from '../common/scim-constants';

/**
 * Endpoint-specific SCIM API Controller
 * Serves all SCIM endpoints under the endpoint's root path: /scim/endpoints/{endpointId}
 * All operations are scoped to the specified endpoint
 */
@Controller('endpoints/:endpointId')
export class EndpointScimController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly usersService: EndpointScimUsersService,
    private readonly groupsService: EndpointScimGroupsService,
    private readonly metadataService: ScimMetadataService
  ) {}

  /**
   * Validate endpoint exists, is active, and set endpoint context for all sub-routes
   * Throws ForbiddenException if endpoint is inactive
   */
  private async validateAndSetContext(
    endpointId: string,
    req: Request
  ): Promise<{ baseUrl: string; config: EndpointConfig }> {
    // Validate endpoint exists and get config
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    
    // Block SCIM operations on inactive endpoints
    if (!endpoint.active) {
      throw new ForbiddenException(`Endpoint "${endpoint.name}" is inactive. SCIM operations are not allowed.`);
    }
    
    const config: EndpointConfig = endpoint.config || {};

    // Set endpoint context for this request (including config)
    const baseUrl = `${req.protocol}://${req.get('host')}/scim/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, config });

    return { baseUrl, config };
  }

  // ===== Users Endpoints =====

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
    @Query('count') count?: string
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.usersService.listUsersForEndpoint(
      {
        filter,
        startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
        count: count ? parseInt(count, 10) : undefined
      },
      baseUrl,
      endpointId
    );
  }

  /**
   * GET /scim/endpoints/{endpointId}/Users/{id}
   * Get a specific user in the endpoint
   */
  @Get('Users/:id')
  async getUser(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.usersService.getUserForEndpoint(id, baseUrl, endpointId);
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
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.usersService.patchUserForEndpoint(id, dto, baseUrl, endpointId);
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
    @Query('count') count?: string
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.groupsService.listGroupsForEndpoint(
      {
        filter,
        startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
        count: count ? parseInt(count, 10) : undefined
      },
      baseUrl,
      endpointId
    );
  }

  /**
   * GET /scim/endpoints/{endpointId}/Groups/{id}
   * Get a specific group in the endpoint
   */
  @Get('Groups/:id')
  async getGroup(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    const { baseUrl } = await this.validateAndSetContext(endpointId, req);
    return this.groupsService.getGroupForEndpoint(id, baseUrl, endpointId);
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

  // ===== Metadata Endpoints =====

  /**
   * GET /scim/endpoints/{endpointId}/Schemas
   * Get SCIM schemas for the endpoint
   */
  @Get('Schemas')
  async getSchemas(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    // TODO: return this.metadataService.getSchemas();
    // return this.metadataService.getSchemas();
    return this.getSchemasJSON();
  }
  
  // REMOVE later: Temp Schemas JSON generator
  private getSchemasJSON() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ListResponse'],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [this.userSchema(), this.groupSchema()]
    };
  }
  private userSchema() {
      return {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      name: 'User',
      description: 'User Account',
      attributes: [
        {
          name: 'userName',
          type: 'string',
          multiValued: false,
          required: true,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'always',
          uniqueness: 'server'
        },
        {
          name: 'displayName',
          type: 'string',
          multiValued: false,
          required: false,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default'
        },
        {
          name: 'active',
          type: 'boolean',
          multiValued: false,
          required: false,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default'
        },
        {
          name: 'emails',
          type: 'complex',
          multiValued: true,
          required: false,
          subAttributes: [
            {
              name: 'value',
              type: 'string',
              multiValued: false,
              required: true,
              caseExact: false,
              mutability: 'readWrite',
              returned: 'always'
            },
            {
              name: 'type',
              type: 'string',
              multiValued: false,
              required: false,
              caseExact: false,
              mutability: 'readWrite',
              returned: 'default'
            },
            {
              name: 'primary',
              type: 'boolean',
              multiValued: false,
              required: false,
              caseExact: false,
              mutability: 'readWrite',
              returned: 'default'
            }
          ],
          mutability: 'readWrite',
          returned: 'default'
        }
      ]
      };
  }
  private groupSchema() {
      return {
      id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      name: 'Group',
      description: 'Group',
      attributes: [
        {
          name: 'displayName',
          type: 'string',
          multiValued: false,
          required: true,
          mutability: 'readWrite',
          returned: 'always'
        },
        {
          name: 'members',
          type: 'complex',
          multiValued: true,
          required: false,
          mutability: 'readWrite',
          returned: 'default',
          subAttributes: [
            {
              name: 'value',
              type: 'string',
              multiValued: false,
              required: true,
              mutability: 'immutable',
              returned: 'always'
            },
            {
              name: 'display',
              type: 'string',
              multiValued: false,
              required: false,
              mutability: 'immutable',
              returned: 'default'
            },
            {
              name: 'type',
              type: 'string',
              multiValued: false,
              required: false,
              mutability: 'immutable',
              returned: 'default'
            }
          ]
        }
      ]
      };
  }


  /**
   * GET /scim/endpoints/{endpointId}/ResourceTypes
   * Get resource types for the endpoint
   */
  @Get('ResourceTypes')
  async getResourceTypes(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    // return this.metadataService.getResourceTypes();
    return this.getResourceTypesJSON();
  }

  // REMOVE later: Temp ResourceTypes JSON generator
  private getResourceTypesJSON() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ListResponse'],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        {
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'User Account',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
          schemaExtensions: []
        },
        {
          id: 'Group',
          name: 'Group',
          endpoint: '/Groups',
          description: 'Group',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
          schemaExtensions: []
        }
      ]
    };
  }

  
  /**
   * GET /scim/endpoints/{endpointId}/ServiceProviderConfig
   * Get service provider configuration for the endpoint
   */
  @Get('ServiceProviderConfig')
  async getServiceProviderConfig(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    // TODO: return this.metadataService.getServiceProviderConfig();
    return this.getServiceProviderConfigJSON();
  }

  // REMOVE later: Temp ServiceProviderConfig JSON generator
  private getServiceProviderConfigJSON() {
    return {
        schemas: [SCIM_SP_CONFIG_SCHEMA],
        patch: { supported: true },
        bulk: { supported: false },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: true },
        authenticationSchemes: [
          {
            type: 'oauthbearertoken',
            name: 'OAuth Bearer Token',
            description: 'Authentication scheme using the OAuth Bearer Token Standard',
            specificationUrl: 'https://www.rfc-editor.org/info/rfc6750'
          }
        ]
    };
  }
}