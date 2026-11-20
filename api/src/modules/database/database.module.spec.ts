import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database.module';
import { DatabaseService } from './database.service';
import { PrismaService } from '../prisma/prisma.service';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { RepositoryModule } from '../../infrastructure/repositories/repository.module';
import { USER_REPOSITORY, GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';

describe('DatabaseModule in-memory inventory wiring', () => {
  let module: TestingModule;
  let originalBackend: string | undefined;

  beforeAll(() => {
    originalBackend = process.env.PERSISTENCE_BACKEND;
    process.env.PERSISTENCE_BACKEND = 'inmemory';
  });

  afterAll(() => {
    if (originalBackend === undefined) delete process.env.PERSISTENCE_BACKEND;
    else process.env.PERSISTENCE_BACKEND = originalBackend;
    RepositoryModule.resetCache();
  });

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), RepositoryModule.register(), DatabaseModule],
    })
      .overrideProvider(PrismaService).useValue({})
      .overrideProvider(EndpointService).useValue({
        listEndpoints: jest.fn().mockResolvedValue({ endpoints: [{ id: 'owned-endpoint' }] }),
      })
      .overrideProvider(USER_REPOSITORY).useValue({
        findAll: jest.fn().mockResolvedValue([{ userName: 'runtime@example.com', rawPayload: '{}' }]),
      })
      .overrideProvider(GROUP_REPOSITORY).useValue({
        findAllWithMembers: jest.fn().mockResolvedValue([{ displayName: 'Runtime group', rawPayload: '{}' }]),
      })
      .compile();
  });

  afterEach(async () => module.close());

  it('enumerates real module endpoints when collecting users', async () => {
    const result = await module.get(DatabaseService).getUsers({ page: 1, limit: 10 });
    expect(result.pagination.total).toBe(1);
    expect(result.users).toEqual([
      expect.objectContaining({ userName: 'runtime@example.com', endpointId: 'owned-endpoint' }),
    ]);
  });

  it('enumerates real module endpoints when collecting groups', async () => {
    const result = await module.get(DatabaseService).getGroups({ page: 1, limit: 10 });
    expect(result.pagination.total).toBe(1);
    expect(result.groups).toEqual([
      expect.objectContaining({ displayName: 'Runtime group', endpointId: 'owned-endpoint' }),
    ]);
  });
});
