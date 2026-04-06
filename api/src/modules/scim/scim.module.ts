import { Module, type NestModule, type MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';

import { LoggingModule } from '../logging/logging.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EndpointModule } from '../endpoint/endpoint.module';
import { RepositoryModule } from '../../infrastructure/repositories/repository.module';
import { AdminController } from './controllers/admin.controller';
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
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { ScimContentTypeValidationMiddleware } from './middleware/scim-content-type-validation.middleware';

@Module({
  imports: [PrismaModule, LoggingModule, EndpointModule, RepositoryModule.register()],
  controllers: [
    ServiceProviderConfigController,
    ResourceTypesController,
    SchemasController,
    AdminController,
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
    // Exception filters: NestJS applies APP_FILTERs in reverse order (last registered = runs first).
    // GlobalExceptionFilter catches non-HttpException errors (raw Error, TypeError, PrismaError).
    // ScimExceptionFilter catches HttpException and formats as SCIM error.
    // Registration order: Global first, then Scim — so Scim runs first, Global is the fallback.
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter
    },
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
export class ScimModule implements NestModule {
  constructor(private readonly endpointContext: EndpointContextStorage) {}

  /**
   * Register middleware on ALL routes:
   * 1. AsyncLocalStorage middleware — ensures endpoint context is isolated per request
   * 2. Content-Type validation — rejects non-JSON Content-Types on SCIM endpoint routes (RFC 7644 §3.1)
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(this.endpointContext.createMiddleware()).forRoutes('*');
    consumer.apply(ScimContentTypeValidationMiddleware).forRoutes('endpoints/*');
  }
}
