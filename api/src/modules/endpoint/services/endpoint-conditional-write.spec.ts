import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type Endpoint } from '../../../generated/prisma/client';
import { EndpointService } from './endpoint.service';
import { endpointETag } from '../common/endpoint-etag';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { ENDPOINT_LIFECYCLE_REPOSITORY } from '../../../domain/repositories/repository.tokens';

describe('Persistent conditional endpoint writes', () => {
  const priorBackend = process.env.PERSISTENCE_BACKEND;
  const id = '67da74f1-ddd2-4bd6-a0af-7350e7350ef3';
  let module: TestingModule;
  let service: EndpointService;
  let row: Endpoint;
  const prisma = {
    endpoint: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const logger = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    setEndpointLevel: jest.fn(), clearEndpointLevel: jest.fn(),
    enableEndpointFileLogging: jest.fn(), disableEndpointFileLogging: jest.fn(),
  };

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'prisma';
    jest.resetAllMocks();
    row = {
      id,
      name: 'conditional-endpoint',
      displayName: null,
      description: null,
      active: true,
      profile: {
        schemas: [], resourceTypes: [],
        settings: { StrictSchemaValidation: true, logFileEnabled: false },
      },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    prisma.endpoint.findUnique.mockImplementation(() => structuredClone(row));
    prisma.endpoint.update.mockImplementation(() => ({ ...structuredClone(row), displayName: 'Changed' }));
    module = await Test.createTestingModule({
      providers: [
        EndpointService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: logger },
        { provide: ENDPOINT_LIFECYCLE_REPOSITORY, useValue: { deleteEndpoint: jest.fn() } },
      ],
    }).compile();
    service = module.get(EndpointService);
  });

  afterEach(async () => {
    await module.close();
    if (priorBackend === undefined) delete process.env.PERSISTENCE_BACKEND;
    else process.env.PERSISTENCE_BACKEND = priorBackend;
  });

  it('conditions the write on all editable persisted fields, not a timestamp', async () => {
    const etag = endpointETag(await service.getEndpoint(id));
    await service.updateEndpoint(id, { displayName: 'Changed' }, etag);
    expect(prisma.endpoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id, displayName: null, description: null, active: true,
        profile: { equals: row.profile },
      },
    }));
  });

  it('uses database null rather than JSON null for a missing persisted profile', async () => {
    row.profile = null;
    const etag = endpointETag(await service.getEndpoint(id));
    await service.updateEndpoint(id, { displayName: 'Changed' }, etag);
    expect(prisma.endpoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id, displayName: null, description: null, active: true,
        profile: { equals: Prisma.DbNull },
      },
    }));
  });

  it('rejects a stale token before a repository write', async () => {
    await expect(service.updateEndpoint(id, { displayName: 'Changed' }, 'W/"stale"'))
      .rejects.toMatchObject({ status: 412 });
    expect(prisma.endpoint.update).not.toHaveBeenCalled();
  });

  it('translates a lost database comparison into a precondition failure with the current token', async () => {
    const etag = endpointETag(await service.getEndpoint(id));
    prisma.endpoint.update.mockImplementation(() => {
      row.active = false;
      throw new Prisma.PrismaClientKnownRequestError('Concurrent edit', { code: 'P2025', clientVersion: 'test' });
    });
    await expect(service.updateEndpoint(id, { displayName: 'Changed' }, etag))
      .rejects.toMatchObject({ status: 412 });
    expect((await service.getEndpoint(id)).active).toBe(false);
  });

  it('does not retry or return success when the state changes and returns to its previous content', async () => {
    const etag = endpointETag(await service.getEndpoint(id));
    prisma.endpoint.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Intervening edit', { code: 'P2025', clientVersion: 'test' },
    ));
    await expect(service.updateEndpoint(id, { displayName: 'Changed' }, etag))
      .rejects.toMatchObject({ status: 412 });
    expect(prisma.endpoint.update).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '*'])('keeps %s updates free of a content precondition', async ifMatch => {
    await service.updateEndpoint(id, { displayName: 'Changed' }, ifMatch);
    expect(prisma.endpoint.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id } }));
  });

  it('propagates database read and write failures without relabeling them as conflicts', async () => {
    const etag = endpointETag(await service.getEndpoint(id));
    const outage = new Error('Synthetic database outage');
    prisma.endpoint.findUnique.mockRejectedValueOnce(outage);
    await expect(service.updateEndpoint(id, { displayName: 'Changed' }, etag)).rejects.toBe(outage);
    prisma.endpoint.update.mockRejectedValueOnce(outage);
    await expect(service.updateEndpoint(id, { displayName: 'Changed' }, etag)).rejects.toBe(outage);
  });
});
