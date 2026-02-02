import { Module } from '@nestjs/common';

import { LoggingModule } from '../logging/logging.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EndpointModule } from '../endpoint/endpoint.module';
import { AdminController } from './controllers/admin.controller';
import { GroupsController } from './controllers/groups.controller';
import { ResourceTypesController } from './controllers/resource-types.controller';
import { SchemasController } from './controllers/schemas.controller';
import { ServiceProviderConfigController } from './controllers/service-provider-config.controller';
import { UsersController } from './controllers/users.controller';
import { EndpointScimController } from './controllers/endpoint-scim.controller';
import { ScimGroupsService } from './services/scim-groups.service';
import { ScimMetadataService } from './services/scim-metadata.service';
import { ScimUsersService } from './services/scim-users.service';
import { EndpointScimUsersService } from './services/endpoint-scim-users.service';
import { EndpointScimGroupsService } from './services/endpoint-scim-groups.service';
import { EndpointContextStorage } from '../endpoint/endpoint-context.storage';

@Module({
  imports: [PrismaModule, LoggingModule, EndpointModule],
  controllers: [
    ServiceProviderConfigController,
    ResourceTypesController,
    SchemasController,
    UsersController,
    GroupsController,
    AdminController,
    EndpointScimController
  ],
  providers: [
    ScimUsersService,
    ScimGroupsService,
    ScimMetadataService,
    EndpointScimUsersService,
    EndpointScimGroupsService,
    EndpointContextStorage
  ]
})
export class ScimModule {}
