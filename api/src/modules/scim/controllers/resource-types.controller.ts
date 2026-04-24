import { Controller, Get, Header, Param } from '@nestjs/common';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { Public } from '../../auth/public.decorator';

/**
 * Root-level ResourceTypes endpoint - returns global defaults.
 *
 * In a multi-tenant deployment, prefer the endpoint-scoped route
 * `GET /scim/endpoints/{endpointId}/ResourceTypes` which returns
 * tenant-specific resource types (global + per-endpoint custom types/extensions).
 *
 * RFC 7644 §4 - SHALL NOT require authentication.
 */
@Public()
@Controller('ResourceTypes')
export class ResourceTypesController {
  constructor(private readonly discoveryService: ScimDiscoveryService) {}

  @Get()
  @Header('Content-Type', 'application/scim+json')
  getResourceTypes() {
    return this.discoveryService.getResourceTypes();
  }

  /**
   * GET /ResourceTypes/:id
   * Returns a single resource type definition by its id.
   * @see RFC 7644 §4 - HTTP GET to retrieve individual resource type
   */
  @Get(':id')
  @Header('Content-Type', 'application/scim+json')
  getResourceTypeById(@Param('id') id: string) {
    return this.discoveryService.getResourceTypeById(id);
  }
}
