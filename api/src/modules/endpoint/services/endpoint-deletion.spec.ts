import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { EndpointService } from './endpoint.service';
import { RepositoryModule } from '../../../infrastructure/repositories/repository.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY, ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { EndpointDeletionStep } from '../../../infrastructure/repositories/inmemory/endpoint-deletion-step';
import { SCIM_EVENTS } from '../../stats/scim-events';
import { deletionCounts, deletionRepositories, seedDeletionRows, SEEDED_COUNTS, EMPTY_COUNTS, type DeletionFixture } from '../../../../test/helpers/endpoint-deletion.fixture';

describe('Endpoint deletion ownership', () => {
  const previousBackend = process.env.PERSISTENCE_BACKEND;
  let module: TestingModule;
  let service: EndpointService;
  let owned: DeletionFixture;
  let other: DeletionFixture;
  const listener = jest.fn();
  const deleted = jest.fn();
  const logger = {
    info: jest.fn(), warn: jest.fn(), debug: jest.fn(),
    setEndpointLevel: jest.fn(), clearEndpointLevel: jest.fn(),
    enableEndpointFileLogging: jest.fn(), disableEndpointFileLogging: jest.fn(),
  };

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'inmemory';
    RepositoryModule.resetCache();
    jest.clearAllMocks();
    const events = new EventEmitter2();
    events.on(SCIM_EVENTS.ENDPOINT_DELETED, deleted);
    module = await Test.createTestingModule({
      imports: [RepositoryModule.register()],
      providers: [
        EndpointService,
        { provide: PrismaService, useValue: {} },
        { provide: ScimLogger, useValue: logger },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(EndpointService);
    service.setProfileChangeListener(listener);
    const endpoint = await service.createEndpoint({ name: `delete-${randomUUID()}` });
    const survivor = await service.createEndpoint({ name: `survivor-${randomUUID()}` });
    owned = await seedDeletionRows(module, endpoint.id);
    other = await seedDeletionRows(module, survivor.id);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module?.close();
    if (previousBackend === undefined) delete process.env.PERSISTENCE_BACKEND;
    else process.env.PERSISTENCE_BACKEND = previousBackend;
    RepositoryModule.resetCache();
    jest.restoreAllMocks();
  });

  it('removes every owned row and nested membership while preserving other endpoints', async () => {
    expect(await deletionCounts(module, owned)).toEqual(SEEDED_COUNTS);
    await service.deleteEndpoint(owned.endpointId);
    expect(await deletionCounts(module, owned)).toEqual(EMPTY_COUNTS);
    expect(await deletionCounts(module, other)).toEqual(SEEDED_COUNTS);
    await expect(service.getEndpoint(owned.endpointId)).rejects.toMatchObject({ status: 404 });
    expect(service.getCachedProfileSettings(owned.endpointId)).toBeUndefined();
    expect(listener).toHaveBeenCalledWith(owned.endpointId, null);
    expect(logger.clearEndpointLevel).toHaveBeenCalledWith(owned.endpointId);
    expect(logger.disableEndpointFileLogging).toHaveBeenCalledWith(owned.endpointId);
    expect(deleted).toHaveBeenCalledTimes(1);
    const credentials = deletionRepositories(module).credentials;
    for (const row of [owned.active, owned.revoked, owned.wif, owned.expired]) {
      expect(await credentials.findById(row.id)).toBeNull();
    }
    expect(await credentials.findActiveByLookupKey(owned.active.lookupKey!)).toBeNull();
  });

  it.each([
    ['User', USER_REPOSITORY], ['Group', GROUP_REPOSITORY],
    ['custom resource', GENERIC_RESOURCE_REPOSITORY], ['credential', ENDPOINT_CREDENTIAL_REPOSITORY],
  ])('rolls back all rows and keeps endpoint/cache when %s commit fails', async (_name, token) => {
    const participant = module.get<{ prepareEndpointDeletion(id: string): EndpointDeletionStep }>(token);
    const prepare = participant.prepareEndpointDeletion.bind(participant);
    const failure = new Error('Injected storage commit failure');
    jest.spyOn(participant, 'prepareEndpointDeletion').mockImplementationOnce(id => {
      const step = prepare(id);
      return { ...step, commit: () => { step.commit(); throw failure; } };
    });
    await expect(service.deleteEndpoint(owned.endpointId)).rejects.toBe(failure);
    expect(await deletionCounts(module, owned)).toEqual(SEEDED_COUNTS);
    expect(await deletionCounts(module, other)).toEqual(SEEDED_COUNTS);
    expect((await service.getEndpoint(owned.endpointId)).id).toBe(owned.endpointId);
    expect(listener).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
    expect(logger.clearEndpointLevel).not.toHaveBeenCalled();
    const { users } = deletionRepositories(module);
    await expect(users.create({ ...owned.userInput, scimId: randomUUID(), userName: 'after-rollback' })).resolves.toBeDefined();
    await service.deleteEndpoint(owned.endpointId);
    expect(await deletionCounts(module, owned)).toEqual(EMPTY_COUNTS);
  });

  it('does not mutate any store when preparation fails', async () => {
    const participant = module.get<{ prepareEndpointDeletion(id: string): EndpointDeletionStep }>(ENDPOINT_CREDENTIAL_REPOSITORY);
    jest.spyOn(participant, 'prepareEndpointDeletion').mockImplementationOnce(() => { throw new Error('prepare failed'); });
    await expect(service.deleteEndpoint(owned.endpointId)).rejects.toThrow('prepare failed');
    expect(await deletionCounts(module, owned)).toEqual(SEEDED_COUNTS);
    expect(deleted).not.toHaveBeenCalled();
  });

  it('fails assembly instead of silently skipping a missing lifecycle provider', async () => {
    await expect(Test.createTestingModule({
      providers: [
        EndpointService,
        { provide: PrismaService, useValue: {} },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile()).rejects.toThrow('ENDPOINT_LIFECYCLE_REPOSITORY');
  });

  it('blocks every late insert and credential rotation without resurrecting rows', async () => {
    // These inputs were computed while the endpoint existed.
    const { users, groups, resources, credentials } = deletionRepositories(module);
    await service.deleteEndpoint(owned.endpointId);
    for (const write of [
      () => users.create({ ...owned.userInput, scimId: randomUUID() }),
      () => groups.create({ ...owned.groupInput, scimId: randomUUID() }),
      () => resources.create({ ...owned.customInput, scimId: randomUUID() }),
      () => credentials.create({ ...owned.credentialInput, lookupKey: randomUUID() }),
      () => groups.addMembers(owned.parent.id, [{ userId: null, value: 'late', type: null, display: null }]),
      () => credentials.rotate(other.active.id, owned.credentialInput),
      () => users.update(owned.user.id, { active: false }),
      () => groups.update(owned.child.id, { displayName: 'late' }),
      () => resources.update(owned.custom.id, { active: false }),
    ]) {
      await expect(write()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await credentials.reactivate(owned.revoked.id)).toBeNull();
    expect(await credentials.updateMetadata(owned.wif.id, {})).toBeNull();
    expect(await credentials.findById(other.active.id)).toMatchObject({ active: true });
    expect(await deletionCounts(module, owned)).toEqual(EMPTY_COUNTS);
    expect(await deletionCounts(module, other)).toEqual(SEEDED_COUNTS);
  });

  it('cannot add members when endpoint deletion interrupts an in-flight Group update', async () => {
    const { groups } = deletionRepositories(module);
    const update = groups.update.bind(groups);
    let resume!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    jest.spyOn(groups, 'update').mockImplementationOnce(async (id, data) => {
      const row = await update(id, data);
      entered();
      await paused;
      return row;
    });
    const pending = groups.updateGroupWithMembers(owned.parent.id, { displayName: 'in-flight' }, [
      { userId: null, value: 'late-member', type: null, display: null },
    ]);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await reached;
    await service.deleteEndpoint(owned.endpointId);
    resume();
    await rejection;
    expect(await deletionCounts(module, owned)).toEqual(EMPTY_COUNTS);
    expect(await deletionCounts(module, other)).toEqual(SEEDED_COUNTS);
  });
});
