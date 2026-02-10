import {
  Controller,
  Get,
  Param,
  Req,
  ForbiddenException
} from '@nestjs/common';
import type { Request } from 'express';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { SCIM_SP_CONFIG_SCHEMA } from '../common/scim-constants';

/**
 * Endpoint-specific SCIM Discovery Controller
 * Handles metadata / discovery endpoints scoped to a specific endpoint:
 *   - /scim/endpoints/{endpointId}/Schemas
 *   - /scim/endpoints/{endpointId}/ResourceTypes
 *   - /scim/endpoints/{endpointId}/ServiceProviderConfig
 *
 * These are mandated by RFC 7644 §4 and must be present at every SCIM
 * service-provider root.  They are intentionally separated from the
 * resource CRUD controllers (Users / Groups) for clarity.
 */
@Controller('endpoints/:endpointId')
export class EndpointScimDiscoveryController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage
  ) {}

  /**
   * Validate endpoint exists, is active, and set endpoint context.
   * Throws ForbiddenException if endpoint is inactive.
   */
  private async validateAndSetContext(
    endpointId: string,
    req: Request
  ): Promise<void> {
    const endpoint = await this.endpointService.getEndpoint(endpointId);

    if (!endpoint.active) {
      throw new ForbiddenException(
        `Endpoint "${endpoint.name}" is inactive. SCIM operations are not allowed.`
      );
    }

    const config = endpoint.config || {};
    const baseUrl = `${req.protocol}://${req.get('host')}/scim/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, config });
  }

  // ===== Schemas =====

  /**
   * GET /scim/endpoints/{endpointId}/Schemas
   * Returns the SCIM schema definitions supported by this endpoint.
   */
  @Get('Schemas')
  async getSchemas(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    return this.getSchemasJSON();
  }

  // ===== ResourceTypes =====

  /**
   * GET /scim/endpoints/{endpointId}/ResourceTypes
   * Returns the resource type definitions supported by this endpoint.
   */
  @Get('ResourceTypes')
  async getResourceTypes(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    return this.getResourceTypesJSON();
  }

  // ===== ServiceProviderConfig =====

  /**
   * GET /scim/endpoints/{endpointId}/ServiceProviderConfig
   * Returns the service provider configuration for this endpoint.
   */
  @Get('ServiceProviderConfig')
  async getServiceProviderConfig(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    return this.getServiceProviderConfigJSON();
  }

  // ===== Private helpers (static JSON – TODO: migrate to ScimMetadataService) =====

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
