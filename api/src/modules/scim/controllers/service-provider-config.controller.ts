import { Controller, Get, Header } from '@nestjs/common';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { Public } from '../../auth/public.decorator';

/**
 * Root-level ServiceProviderConfig endpoint — returns global defaults.
 *
 * In a multi-tenant deployment, prefer the endpoint-scoped route
 * `GET /scim/endpoints/{endpointId}/ServiceProviderConfig` which returns
 * tenant-specific capabilities (e.g. `bulk.supported` reflecting per-endpoint
 * `BulkOperationsEnabled` flag).
 *
 * RFC 7644 §4 — SHALL NOT require authentication.
 */
@Public()
@Controller('ServiceProviderConfig')
export class ServiceProviderConfigController {
  constructor(private readonly discoveryService: ScimDiscoveryService) {}

  @Get()
  @Header('Content-Type', 'application/scim+json')
  getConfig() {
    return this.discoveryService.getServiceProviderConfig();
  }
}
