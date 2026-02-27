import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';

import { LoggingModule } from '../logging/logging.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EndpointModule } from '../endpoint/endpoint.module';
import { RepositoryModule } from '../../infrastructure/repositories/repository.module';
import { AdminController } from './controllers/admin.controller';
import { AdminSchemaController } from './controllers/admin-schema.controller';
import { AdminResourceTypeController } from './controllers/admin-resource-type.controller';
import { AdminCredentialController } from './controllers/admin-credential.controller';
import { ResourceTypesController } from './controllers/resource-types.controller';
import { SchemasController } from './controllers/schemas.controller';
import { ServiceProviderConfigController } from './controllers/service-provider-config.controller';
import { EndpointScimUsersController } from './controllers/endpoint-scim-users.controller';
import { EndpointScimGroupsController } from './controllers/endpoint-scim-groups.controller';
import { EndpointScimDiscoveryController } from './controllers/endpoint-scim-discovery.controller';
import { EndpointScimBulkController } from './controllers/endpoint-scim-bulk.controller';
import { EndpointScimGenericController } from './controllers/endpoint-scim-generic.controller';
import { ScimMeController } from './controllers/scim-me.controller';
import { ScimMetadataService } from './services/scim-metadata.service';
import { ScimSchemaRegistry } from './discovery/scim-schema-registry';
import { ScimDiscoveryService } from './discovery/scim-discovery.service';
import { EndpointScimUsersService } from './services/endpoint-scim-users.service';
import { EndpointScimGroupsService } from './services/endpoint-scim-groups.service';
import { EndpointScimGenericService } from './services/endpoint-scim-generic.service';
import { BulkProcessorService } from './services/bulk-processor.service';
import { EndpointContextStorage } from '../endpoint/endpoint-context.storage';
import { ScimContentTypeInterceptor } from './interceptors/scim-content-type.interceptor';
import { ScimEtagInterceptor } from './interceptors/scim-etag.interceptor';
import { ScimExceptionFilter } from './filters/scim-exception.filter';

@Module({
  imports: [PrismaModule, LoggingModule, EndpointModule, RepositoryModule.register()],
  controllers: [
    ServiceProviderConfigController,
    ResourceTypesController,
    SchemasController,
    AdminController,
    AdminSchemaController,
    AdminResourceTypeController,
    AdminCredentialController,
    EndpointScimUsersController,
    EndpointScimGroupsController,
    EndpointScimBulkController,
    EndpointScimDiscoveryController,
    ScimMeController,
    // Generic controller MUST be registered LAST — its wildcard :resourceType
    // param would otherwise shadow built-in routes like /Users, /Groups, etc.
    EndpointScimGenericController,
  ],
  providers: [
    ScimMetadataService,
    ScimSchemaRegistry,
    ScimDiscoveryService,
    EndpointScimUsersService,
    EndpointScimGroupsService,
    EndpointScimGenericService,
    BulkProcessorService,
    EndpointContextStorage,
    {
      provide: APP_FILTER,
      useClass: ScimExceptionFilter
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ScimContentTypeInterceptor
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ScimEtagInterceptor
    }
  ]
})
export class ScimModule {}
