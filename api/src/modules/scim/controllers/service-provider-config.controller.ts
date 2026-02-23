import { Controller, Get, Header } from '@nestjs/common';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';

@Controller('ServiceProviderConfig')
export class ServiceProviderConfigController {
  constructor(private readonly discoveryService: ScimDiscoveryService) {}

  @Get()
  @Header('Content-Type', 'application/scim+json')
  getConfig() {
    return this.discoveryService.getServiceProviderConfig();
  }
}
