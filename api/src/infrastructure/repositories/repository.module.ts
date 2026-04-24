/**
 * RepositoryModule - dynamic module that provides IUserRepository, IGroupRepository,
 * and other persistence repositories.
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
  GENERIC_RESOURCE_REPOSITORY,
  ENDPOINT_CREDENTIAL_REPOSITORY,
} from '../../domain/repositories/repository.tokens';
import { PrismaUserRepository } from './prisma/prisma-user.repository';
import { PrismaGroupRepository } from './prisma/prisma-group.repository';
import { PrismaGenericResourceRepository } from './prisma/prisma-generic-resource.repository';
import { PrismaEndpointCredentialRepository } from './prisma/prisma-endpoint-credential.repository';
import { InMemoryUserRepository } from './inmemory/inmemory-user.repository';
import { InMemoryGroupRepository } from './inmemory/inmemory-group.repository';
import { InMemoryGenericResourceRepository } from './inmemory/inmemory-generic-resource.repository';
import { InMemoryEndpointCredentialRepository } from './inmemory/inmemory-endpoint-credential.repository';
import { PrismaModule } from '../../modules/prisma/prisma.module';

@Module({})
export class RepositoryModule {
  /** Cached module definition ensures a single set of provider instances. */
  private static cachedModule: DynamicModule | null = null;
  private static cachedBackend: string | null = null;

  /** @internal - reset cache between tests */
  static resetCache(): void {
    this.cachedModule = null;
    this.cachedBackend = null;
  }

  static register(): DynamicModule {
    const backend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase();

    // Return cached definition when the backend hasn't changed.
    // Critical for InMemory repositories whose state lives in a Map
    // that must be shared across all consumers (AuthModule + ScimModule).
    if (this.cachedModule && this.cachedBackend === backend) return this.cachedModule;
    this.cachedBackend = backend;

    if (backend === 'inmemory') {
      this.cachedModule = {
        module: RepositoryModule,
        global: true,
        providers: [
          { provide: USER_REPOSITORY, useClass: InMemoryUserRepository },
          { provide: GROUP_REPOSITORY, useClass: InMemoryGroupRepository },
          { provide: GENERIC_RESOURCE_REPOSITORY, useClass: InMemoryGenericResourceRepository },
          { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useClass: InMemoryEndpointCredentialRepository },
        ],
        exports: [USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY, ENDPOINT_CREDENTIAL_REPOSITORY],
      };
      return this.cachedModule;
    }

    // Default: Prisma (PostgreSQL - Phase 3)
    this.cachedModule = {
      module: RepositoryModule,
      global: true,
      imports: [PrismaModule],
      providers: [
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: GROUP_REPOSITORY, useClass: PrismaGroupRepository },
        { provide: GENERIC_RESOURCE_REPOSITORY, useClass: PrismaGenericResourceRepository },
        { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useClass: PrismaEndpointCredentialRepository },
      ],
      exports: [USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY, ENDPOINT_CREDENTIAL_REPOSITORY],
    };
    return this.cachedModule;
  }
}
