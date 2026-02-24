/**
 * RepositoryModule — dynamic module that provides IUserRepository, IGroupRepository,
 * and IEndpointSchemaRepository.
 *
 * Selects the persistence backend via the PERSISTENCE_BACKEND environment variable:
 *   - "prisma"   (default) → Prisma-backed repositories (PostgreSQL)
 *   - "inmemory"           → In-memory Map-backed repositories
 *
 * Usage:
 *   imports: [RepositoryModule.register()]
 */
import { Module, type DynamicModule } from '@nestjs/common';
import {
  USER_REPOSITORY,
  GROUP_REPOSITORY,
  ENDPOINT_SCHEMA_REPOSITORY,
} from '../../domain/repositories/repository.tokens';
import { PrismaUserRepository } from './prisma/prisma-user.repository';
import { PrismaGroupRepository } from './prisma/prisma-group.repository';
import { PrismaEndpointSchemaRepository } from './prisma/prisma-endpoint-schema.repository';
import { InMemoryUserRepository } from './inmemory/inmemory-user.repository';
import { InMemoryGroupRepository } from './inmemory/inmemory-group.repository';
import { InMemoryEndpointSchemaRepository } from './inmemory/inmemory-endpoint-schema.repository';
import { PrismaModule } from '../../modules/prisma/prisma.module';

@Module({})
export class RepositoryModule {
  static register(): DynamicModule {
    const backend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase();

    if (backend === 'inmemory') {
      return {
        module: RepositoryModule,
        global: true,
        providers: [
          { provide: USER_REPOSITORY, useClass: InMemoryUserRepository },
          { provide: GROUP_REPOSITORY, useClass: InMemoryGroupRepository },
          { provide: ENDPOINT_SCHEMA_REPOSITORY, useClass: InMemoryEndpointSchemaRepository },
        ],
        exports: [USER_REPOSITORY, GROUP_REPOSITORY, ENDPOINT_SCHEMA_REPOSITORY],
      };
    }

    // Default: Prisma (PostgreSQL — Phase 3)
    return {
      module: RepositoryModule,
      global: true,
      imports: [PrismaModule],
      providers: [
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: GROUP_REPOSITORY, useClass: PrismaGroupRepository },
        { provide: ENDPOINT_SCHEMA_REPOSITORY, useClass: PrismaEndpointSchemaRepository },
      ],
      exports: [USER_REPOSITORY, GROUP_REPOSITORY, ENDPOINT_SCHEMA_REPOSITORY],
    };
  }
}
