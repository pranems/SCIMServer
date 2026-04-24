import { Controller, Get, Header, Param } from '@nestjs/common';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { Public } from '../../auth/public.decorator';

/**
 * Root-level Schemas endpoint - returns global defaults.
 *
 * In a multi-tenant deployment, prefer the endpoint-scoped route
 * `GET /scim/endpoints/{endpointId}/Schemas` which returns tenant-specific
 * schemas (global + per-endpoint extensions/overlays).
 *
 * RFC 7644 §4 - SHALL NOT require authentication.
 */
@Public()
@Controller('Schemas')
export class SchemasController {
  constructor(private readonly discoveryService: ScimDiscoveryService) {}

  @Get()
  @Header('Content-Type', 'application/scim+json')
  getSchemas() {
    return this.discoveryService.getSchemas();
  }

  /**
   * GET /Schemas/:uri
   * Returns a single schema definition by its URN.
   * @see RFC 7644 §4 - HTTP GET to retrieve individual schema
   */
  @Get(':uri')
  @Header('Content-Type', 'application/scim+json')
  getSchemaByUri(@Param('uri') uri: string) {
    return this.discoveryService.getSchemaByUrn(uri);
  }
}
