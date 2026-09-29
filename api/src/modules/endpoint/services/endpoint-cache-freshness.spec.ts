import { Test, type TestingModule } from '@nestjs/testing';
import { EndpointService } from './endpoint.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import type { Endpoint } from '../../../generated/prisma/client';

describe('Persistent endpoint cache freshness', () => {
  let module: TestingModule;
  let service: EndpointService;
  const priorBackend = process.env.PERSISTENCE_BACKEND;
  const id = '76e3c596-22aa-4527-bd6d-234367d798e6';
  const endpoint = (): Endpoint => ({
    id,
    name: 'fresh-endpoint',
    displayName: 'Fresh endpoint',
    description: null,
    active: true,
    profile: {
      schemas: [],
      resourceTypes: [],
      settings: { StrictSchemaValidation: true, logFileEnabled: false },
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  const prisma = {
    endpoint: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    scimResource: { count: jest.fn() },
    resourceMember: { count: jest.fn() },
    requestLog: { count: jest.fn() },
  };
  const listener = jest.fn();
  const logger = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    setEndpointLevel: jest.fn(), clearEndpointLevel: jest.fn(),
    enableEndpointFileLogging: jest.fn(), disableEndpointFileLogging: jest.fn(),
  };

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'prisma';
    jest.resetAllMocks();
    prisma.endpoint.findMany.mockResolvedValue([endpoint()]);
    prisma.endpoint.findUnique.mockResolvedValue(endpoint());
    prisma.endpoint.findFirst.mockResolvedValue(endpoint());
    prisma.scimResource.count.mockResolvedValue(0);
    prisma.resourceMember.count.mockResolvedValue(0);
    prisma.requestLog.count.mockResolvedValue(0);
    module = await Test.createTestingModule({
      providers: [
        EndpointService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile();
    service = module.get(EndpointService);
    service.setProfileChangeListener(listener);
    await service.onModuleInit();
    listener.mockClear();
  });

  afterEach(async () => {
    await module.close();
    if (priorBackend === undefined) delete process.env.PERSISTENCE_BACKEND;
    else process.env.PERSISTENCE_BACKEND = priorBackend;
  });

  it('refreshes a warmed profile even when two changes have the same timestamp', async () => {
    prisma.endpoint.findUnique.mockResolvedValue({
      ...endpoint(),
      profile: {
        schemas: [], resourceTypes: [],
        settings: { StrictSchemaValidation: false, logFileEnabled: false },
      },
    });
    const result = await service.getEndpoint(id);
    expect(result.profile?.settings?.StrictSchemaValidation).toBe(false);
    expect(listener).toHaveBeenCalledWith(id, expect.objectContaining({
      settings: expect.objectContaining({ StrictSchemaValidation: false }),
    }));
  });

  it('does not serve a warmed endpoint after another writer deletes it', async () => {
    prisma.endpoint.findUnique.mockResolvedValue(null);
    prisma.endpoint.findFirst.mockResolvedValue(null);
    await expect(service.getEndpoint(id)).rejects.toMatchObject({ status: 404 });
    expect(service.getCachedProfileSettings(id)).toBeUndefined();
    expect(listener).toHaveBeenCalledWith(id, null);
  });

  it('does not serve an old name after another writer renames the endpoint', async () => {
    prisma.endpoint.findFirst.mockResolvedValue(null);
    await expect(service.getEndpointByName('fresh-endpoint')).rejects.toMatchObject({ status: 404 });
    expect(prisma.endpoint.findFirst).toHaveBeenCalled();
  });

  it('reads current database results for a warmed endpoint list', async () => {
    prisma.endpoint.findMany.mockResolvedValue([]);
    const result = await service.listEndpoints();
    expect(result).toEqual({ totalResults: 0, endpoints: [] });
    expect(service.getCachedProfileSettings(id)).toBeUndefined();
  });

  it('propagates database failure instead of returning a cached authorization profile', async () => {
    const failure = new Error('Synthetic database outage');
    prisma.endpoint.findUnique.mockRejectedValue(failure);
    await expect(service.getEndpoint(id)).rejects.toBe(failure);
  });

  it('keeps an unchanged profile cache and avoids redundant hydration', async () => {
    await service.getEndpoint(id);
    await service.getEndpoint(id);
    expect(prisma.endpoint.findUnique).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not use cached existence to serve statistics for a deleted endpoint', async () => {
    prisma.endpoint.findUnique.mockResolvedValue(null);
    prisma.endpoint.findFirst.mockResolvedValue(null);
    await expect(service.getEndpointStats(id)).rejects.toMatchObject({ status: 404 });
  });
});
