import { Controller, Get, Header } from '@nestjs/common';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';

@Controller('Schemas')
export class SchemasController {
  constructor(private readonly discoveryService: ScimDiscoveryService) {}

  @Get()
  @Header('Content-Type', 'application/scim+json')
  getSchemas() {
    return this.discoveryService.getSchemas();
  }
}
