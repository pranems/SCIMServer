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
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { buildBaseUrl } from '../common/base-url.util';

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

    const config = endpoint.config || {};
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
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
    return this.discoveryService.getSchemas(endpointId);
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
    return this.discoveryService.getResourceTypes(endpointId);
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
    return this.discoveryService.getServiceProviderConfig();
  }
}
