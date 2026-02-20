import { Test } from '@nestjs/testing';
import { RepositoryModule } from './repository.module';
import { USER_REPOSITORY, GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../domain/repositories/group.repository.interface';
import { InMemoryUserRepository } from './inmemory/inmemory-user.repository';
import { InMemoryGroupRepository } from './inmemory/inmemory-group.repository';
import { PrismaUserRepository } from './prisma/prisma-user.repository';
import { PrismaGroupRepository } from './prisma/prisma-group.repository';

/**
 * RepositoryModule.register() wiring tests.
 *
 * Validates that the dynamic module provides the correct implementation
 * based on the PERSISTENCE_BACKEND environment variable.
 */
describe('RepositoryModule', () => {
  const originalEnv = process.env.PERSISTENCE_BACKEND;

  afterEach(() => {
    // Restore original env after each test
    if (originalEnv === undefined) {
      delete process.env.PERSISTENCE_BACKEND;
    } else {
      process.env.PERSISTENCE_BACKEND = originalEnv;
    }
  });

  describe('when PERSISTENCE_BACKEND is "inmemory"', () => {
    beforeEach(() => {
      process.env.PERSISTENCE_BACKEND = 'inmemory';
    });

    it('should provide InMemoryUserRepository for USER_REPOSITORY', async () => {
      const module = await Test.createTestingModule({
        imports: [RepositoryModule.register()],
      }).compile();

      const userRepo = module.get<IUserRepository>(USER_REPOSITORY);
      expect(userRepo).toBeInstanceOf(InMemoryUserRepository);
      await module.close();
    });

    it('should provide InMemoryGroupRepository for GROUP_REPOSITORY', async () => {
      const module = await Test.createTestingModule({
        imports: [RepositoryModule.register()],
      }).compile();

      const groupRepo = module.get<IGroupRepository>(GROUP_REPOSITORY);
      expect(groupRepo).toBeInstanceOf(InMemoryGroupRepository);
      await module.close();
    });
  });

  describe('when PERSISTENCE_BACKEND is "INMEMORY" (case-insensitive)', () => {
    beforeEach(() => {
      process.env.PERSISTENCE_BACKEND = 'INMEMORY';
    });

    it('should still provide in-memory implementations', async () => {
      const module = await Test.createTestingModule({
        imports: [RepositoryModule.register()],
      }).compile();

      const userRepo = module.get<IUserRepository>(USER_REPOSITORY);
      expect(userRepo).toBeInstanceOf(InMemoryUserRepository);
      await module.close();
    });
  });

  describe('when PERSISTENCE_BACKEND is "prisma"', () => {
    beforeEach(() => {
      process.env.PERSISTENCE_BACKEND = 'prisma';
    });

    it('should provide PrismaUserRepository for USER_REPOSITORY', async () => {
      const module = await Test.createTestingModule({
        imports: [RepositoryModule.register()],
      }).compile();

      const userRepo = module.get<IUserRepository>(USER_REPOSITORY);
      expect(userRepo).toBeInstanceOf(PrismaUserRepository);
      await module.close();
    });

    it('should provide PrismaGroupRepository for GROUP_REPOSITORY', async () => {
      const module = await Test.createTestingModule({
        imports: [RepositoryModule.register()],
      }).compile();

      const groupRepo = module.get<IGroupRepository>(GROUP_REPOSITORY);
      expect(groupRepo).toBeInstanceOf(PrismaGroupRepository);
      await module.close();
    });
  });

  describe('when PERSISTENCE_BACKEND is unset (default)', () => {
    beforeEach(() => {
      delete process.env.PERSISTENCE_BACKEND;
    });

    it('should default to Prisma implementations', async () => {
      const module = await Test.createTestingModule({
        imports: [RepositoryModule.register()],
      }).compile();

      const userRepo = module.get<IUserRepository>(USER_REPOSITORY);
      const groupRepo = module.get<IGroupRepository>(GROUP_REPOSITORY);
      expect(userRepo).toBeInstanceOf(PrismaUserRepository);
      expect(groupRepo).toBeInstanceOf(PrismaGroupRepository);
      await module.close();
    });
  });

  describe('register() produces a valid DynamicModule shape', () => {
    it('should set global: true on inmemory module', () => {
      process.env.PERSISTENCE_BACKEND = 'inmemory';
      const dynModule = RepositoryModule.register();

      expect(dynModule.global).toBe(true);
      expect(dynModule.module).toBe(RepositoryModule);
      expect(dynModule.exports).toContain(USER_REPOSITORY);
      expect(dynModule.exports).toContain(GROUP_REPOSITORY);
    });

    it('should set global: true on prisma module', () => {
      process.env.PERSISTENCE_BACKEND = 'prisma';
      const dynModule = RepositoryModule.register();

      expect(dynModule.global).toBe(true);
      expect(dynModule.module).toBe(RepositoryModule);
      expect(dynModule.exports).toContain(USER_REPOSITORY);
      expect(dynModule.exports).toContain(GROUP_REPOSITORY);
    });

    it('should not include PrismaModule import for inmemory backend', () => {
      process.env.PERSISTENCE_BACKEND = 'inmemory';
      const dynModule = RepositoryModule.register();
      expect(dynModule.imports ?? []).toHaveLength(0);
    });

    it('should include PrismaModule import for prisma backend', () => {
      process.env.PERSISTENCE_BACKEND = 'prisma';
      const dynModule = RepositoryModule.register();
      expect(dynModule.imports).toBeDefined();
      expect(dynModule.imports!.length).toBeGreaterThan(0);
    });
  });
});
