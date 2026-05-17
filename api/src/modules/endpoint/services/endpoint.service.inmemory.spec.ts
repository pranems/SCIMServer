import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EndpointService } from './endpoint.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';

// Inmemory-backend parity tests for EndpointService.createEndpoint().
//
// Background: the main endpoint.service.spec.ts forces PERSISTENCE_BACKEND=prisma
// at the file level because every test in that file mocks PrismaService. The
// inmemory branch of EndpointService.createEndpoint() takes a completely
// different code path (no Prisma calls, write straight to in-process cacheById /
// cacheByName Maps). That branch was missing the duplicate-name guard that the
// Prisma branch has, which surfaced as live-test failure 9z-AA.5 on the local
// inmemory server while dev (Prisma) + Docker (Prisma) both passed 984/984.
//
// These tests lock the inmemory branch behavior so the next reintroduction of
// the bug fails at the unit layer instead of waiting for the cross-backend live
// suite.

const originalBackend = process.env.PERSISTENCE_BACKEND;

describe('EndpointService - inmemory backend createEndpoint() parity', () => {
  let service: EndpointService;

  beforeEach(async () => {
    // MUST be set before Test.createTestingModule().compile() because
    // EndpointService captures `isInMemoryBackend` in its constructor.
    process.env.PERSISTENCE_BACKEND = 'inmemory';

    // Plain stub for PrismaService - the inmemory branch does not call
    // these methods, but the service constructor / onModuleInit / fallback
    // code paths reference them. Returning undefined silently is the right
    // shape (matches the logging-list-logs-inmemory.spec.ts pattern).
    const prisma = {
      endpoint: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      scimResource: { count: jest.fn() },
      resourceMember: { count: jest.fn() },
      requestLog: { count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndpointService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: ScimLogger,
          useValue: {
            trace: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            fatal: jest.fn(),
            isEnabled: jest.fn().mockReturnValue(true),
            getConfig: jest.fn().mockReturnValue({ endpointLevels: {} }),
            runWithContext: jest.fn((_ctx, fn) => fn()),
            getContext: jest.fn(),
            enrichContext: jest.fn(),
            setEndpointLevel: jest.fn(),
            clearEndpointLevel: jest.fn(),
            enableEndpointFileLogging: jest.fn(),
            disableEndpointFileLogging: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EndpointService>(EndpointService);
  });

  afterAll(() => {
    process.env.PERSISTENCE_BACKEND = originalBackend;
  });

  it('creates a new endpoint successfully on the inmemory backend', async () => {
    const created = await service.createEndpoint({
      name: 'inmemory-unique-name',
      profilePreset: 'rfc-standard',
    });
    expect(created.name).toBe('inmemory-unique-name');
    expect(created.id).toBeDefined();
  });

  it('rejects a duplicate endpoint name with BadRequestException (parity with Prisma branch)', async () => {
    await service.createEndpoint({
      name: 'inmemory-dup-name',
      profilePreset: 'rfc-standard',
    });

    await expect(
      service.createEndpoint({
        name: 'inmemory-dup-name',
        profilePreset: 'rfc-standard',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate name with the same "already exists" error message as Prisma branch', async () => {
    await service.createEndpoint({
      name: 'inmemory-msg-check',
      profilePreset: 'rfc-standard',
    });

    await expect(
      service.createEndpoint({
        name: 'inmemory-msg-check',
        profilePreset: 'rfc-standard',
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('allows different names within the same inmemory backend (no cross-name false positive)', async () => {
    const a = await service.createEndpoint({
      name: 'inmemory-name-a',
      profilePreset: 'rfc-standard',
    });
    const b = await service.createEndpoint({
      name: 'inmemory-name-b',
      profilePreset: 'rfc-standard',
    });
    expect(a.name).toBe('inmemory-name-a');
    expect(b.name).toBe('inmemory-name-b');
    expect(a.id).not.toBe(b.id);
  });
});
