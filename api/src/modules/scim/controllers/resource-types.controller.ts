import { Controller, Get, Header } from '@nestjs/common';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';

@Controller('ResourceTypes')
export class ResourceTypesController {
  constructor(private readonly discoveryService: ScimDiscoveryService) {}

  @Get()
  @Header('Content-Type', 'application/scim+json')
  getResourceTypes() {
    return this.discoveryService.getResourceTypes();
  }
}
