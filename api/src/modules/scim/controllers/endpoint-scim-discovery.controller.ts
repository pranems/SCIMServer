import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  ForbiddenException
} from '@nestjs/common';
import type { Request } from 'express';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { buildBaseUrl } from '../common/base-url.util';
import { Public } from '../../auth/public.decorator';

/**
 * Endpoint-specific SCIM Discovery Controller — **PRIMARY** for multi-tenant use.
 *
 * Handles metadata / discovery endpoints scoped to a specific endpoint:
 *   - /scim/endpoints/{endpointId}/Schemas
 *   - /scim/endpoints/{endpointId}/Schemas/{uri}
 *   - /scim/endpoints/{endpointId}/ResourceTypes
 *   - /scim/endpoints/{endpointId}/ResourceTypes/{id}
 *   - /scim/endpoints/{endpointId}/ServiceProviderConfig
 *
 * These are mandated by RFC 7644 §4 and must be present at every SCIM
 * service-provider root.  They are intentionally separated from the
 * resource CRUD controllers (Users / Groups) for clarity.
 *
 * **Multi-tenancy**: Each endpoint can register custom schemas, resource
 * types, and extension URNs. Discovery responses are computed by merging
 * global defaults with per-endpoint overlays from the SchemaRegistry.
 * ServiceProviderConfig adjusts capability flags (e.g. `bulk.supported`)
 * based on per-endpoint configuration.
 *
 * Root-level routes (`/scim/Schemas`, `/scim/ResourceTypes`,
 * `/scim/ServiceProviderConfig`) return global defaults without
 * endpoint context and are primarily for tooling / admin use.
 *
 * RFC 7644 §4 — SHALL NOT require authentication.
 */
@Public()
@Controller('endpoints/:endpointId')
export class EndpointScimDiscoveryController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly discoveryService: ScimDiscoveryService
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

    const profile = endpoint.profile;
    const config = endpoint.config || {};
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, profile, config });
  }

  // ===== Schemas =====

  /**
   * GET /scim/endpoints/{endpointId}/Schemas
   * Returns the SCIM schema definitions supported by this endpoint.
   */
  @Get('Schemas')
  @Header('Content-Type', 'application/scim+json')
  async getSchemas(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    return this.discoveryService.getSchemasFromProfile(endpoint.profile);
  }

  /**
   * GET /scim/endpoints/{endpointId}/Schemas/:uri
   * Returns a single schema definition by URN for this endpoint.
   * @see RFC 7644 §4 — HTTP GET to retrieve individual schema
   */
  @Get('Schemas/:uri')
  @Header('Content-Type', 'application/scim+json')
  async getSchemaByUri(
    @Param('endpointId') endpointId: string,
    @Param('uri') uri: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    return this.discoveryService.getSchemaByUrnFromProfile(uri, endpoint.profile);
  }

  // ===== ResourceTypes =====

  /**
   * GET /scim/endpoints/{endpointId}/ResourceTypes
   * Returns the resource type definitions supported by this endpoint.
   */
  @Get('ResourceTypes')
  @Header('Content-Type', 'application/scim+json')
  async getResourceTypes(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    return this.discoveryService.getResourceTypesFromProfile(endpoint.profile);
  }

  /**
   * GET /scim/endpoints/{endpointId}/ResourceTypes/:id
   * Returns a single resource type definition by id for this endpoint.
   * @see RFC 7644 §4 — HTTP GET to retrieve individual resource type
   */
  @Get('ResourceTypes/:id')
  @Header('Content-Type', 'application/scim+json')
  async getResourceTypeById(
    @Param('endpointId') endpointId: string,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    return this.discoveryService.getResourceTypeByIdFromProfile(id, endpoint.profile);
  }

  // ===== ServiceProviderConfig =====

  /**
   * GET /scim/endpoints/{endpointId}/ServiceProviderConfig
   * Returns the service provider configuration for this endpoint.
   */
  @Get('ServiceProviderConfig')
  @Header('Content-Type', 'application/scim+json')
  async getServiceProviderConfig(
    @Param('endpointId') endpointId: string,
    @Req() req: Request
  ) {
    await this.validateAndSetContext(endpointId, req);
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    return this.discoveryService.getSpcFromProfile(endpoint.profile);
  }
}
