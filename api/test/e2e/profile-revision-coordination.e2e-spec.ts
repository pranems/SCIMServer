import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getLegacyToken } from './helpers/auth.helper';
import type { IUserRepository } from '../../src/domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../src/domain/repositories/group.repository.interface';
import type { IGenericResourceRepository } from '../../src/domain/repositories/generic-resource.repository.interface';
import { SCIM_DIAGNOSTICS_URN, SCIM_ERROR_SCHEMA } from '../../src/modules/scim/common/scim-constants';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { endpointProfileRevision } from '../../src/domain/repositories/profile-revision';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const DEVICE = 'urn:example:profile-revision:Device';
const routes = ['Users', 'Groups', 'Devices'] as const;
type Route = typeof routes[number];
const operations = ['create', 'replace', 'delete'] as const;
type Operation = typeof operations[number];
type Body = Record<string, unknown> & {
  id: string;
  Resources: Body[];
  [SCIM_DIAGNOSTICS_URN]: { errorCode: string; triggeredBy: string };
};
type Response = Omit<request.Response, 'body'> & { body: Body };

describe('endpoint profile revision coordinates resource writes', () => {
  let app!: INestApplication;
  let endpointId: string;
  let strict = true;
  let users: IUserRepository;
  let groups: IGroupRepository;
  let generic: IGenericResourceRepository;

  const http = (
    verb: 'post' | 'get' | 'put' | 'patch' | 'delete',
    url: string,
    body?: Record<string, unknown>,
  ): Promise<Response> => request(app.getHttpServer() as Server)[verb](url)
    .set('Authorization', `Bearer ${getLegacyToken()}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get('USER_REPOSITORY');
    groups = app.get('GROUP_REPOSITORY');
    generic = app.get('GENERIC_RESOURCE_REPOSITORY');
    const created = await http('post', '/scim/admin/endpoints', {
      name: `profile-revision-${randomUUID()}`,
      profile: {
        schemas: [
          { id: USER, name: 'User', attributes: 'all' },
          { id: GROUP, name: 'Group', attributes: 'all' },
          { id: DEVICE, name: 'Device', attributes: [{ name: 'displayName', type: 'string' }] },
        ],
        resourceTypes: [
          { id: 'User', name: 'User', endpoint: '/Users', schema: USER, schemaExtensions: [] },
          { id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP, schemaExtensions: [] },
          { id: 'Device', name: 'Device', endpoint: '/Devices', schema: DEVICE, schemaExtensions: [] },
        ],
        settings: { StrictSchemaValidation: strict },
        serviceProviderConfig: { patch: { supported: true } },
      },
    });
    expect(created.status).toBe(201);
    endpointId = created.body.id;
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (endpointId) {
      await request(app.getHttpServer() as Server)
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${getLegacyToken()}`);
    }
    await app?.close();
  });

  function pauseWrite(
    repository: IUserRepository | IGroupRepository | IGenericResourceRepository,
    method: 'create' | 'update' | 'updateGroupWithMembers' | 'delete',
  ) {
    const target = repository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const original = target[method].bind(repository);
    let entered!: () => void;
    let resume!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const release = new Promise<void>(resolve => { resume = resolve; });
    jest.spyOn(target, method).mockImplementationOnce(async (...args: unknown[]) => {
      entered();
      await release;
      return original(...args);
    });
    return { reached, resume };
  }

  const rows = (route: Route) => route === 'Users'
    ? users.findAll(endpointId)
    : route === 'Groups'
      ? groups.findAllWithMembers(endpointId)
      : generic.findAll(endpointId, 'Device');

  const payload = (route: Route): Record<string, unknown> => ({
    schemas: [route === 'Users' ? USER : route === 'Groups' ? GROUP : DEVICE],
    ...(route === 'Users'
      ? { userName: `stale-${randomUUID()}` }
      : { displayName: `stale-${randomUUID()}` }),
  });

  const cases = routes.flatMap(route => operations.map(operation => [route, operation] as const));

  const profileSource = process.env.PERSISTENCE_BACKEND?.toLowerCase() === 'inmemory'
    ? 'the normalized in-memory profile'
    : 'the persisted legacy profile';
  it.each(routes)(`allows %s CRUD using ${profileSource} without changing storage`, async route => {
    const prisma = app.get(PrismaService);
    const isPrisma = process.env.PERSISTENCE_BACKEND?.toLowerCase() !== 'inmemory';
    let persistedRevision: string | undefined;
    if (isPrisma) {
      const stored = await prisma.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
      if (!stored.profile || typeof stored.profile !== 'object' || Array.isArray(stored.profile)) {
        throw new Error('The owned endpoint must have an object profile');
      }
      const legacyProfile = {
        ...stored.profile,
        settings: { StrictSchemaValidation: strict, PerEndpointCredentialsEnabled: 'True' },
      };
      await prisma.endpoint.update({ where: { id: endpointId }, data: { profile: legacyProfile } });
      persistedRevision = endpointProfileRevision(legacyProfile);
    }
    const endpoint = await http('get', `/scim/admin/endpoints/${endpointId}`);
    expect(endpoint.status).toBe(200);
    expect(endpoint.body.profile).not.toHaveProperty('settings.PerEndpointCredentialsEnabled');
    if (isPrisma) expect(endpointProfileRevision(endpoint.body.profile)).not.toBe(persistedRevision);

    const base = `/scim/v2/endpoints/${endpointId}/${route}`;
    const created = await http('post', base, payload(route));
    expect(created.status).toBe(201);
    const item = `${base}/${created.body.id}`;
    const field = route === 'Users' ? 'userName' : 'displayName';
    const replacement = payload(route);
    const replaced = await http('put', item, replacement);
    expect(replaced.status).toBe(200);
    expect(replaced.body[field]).toBe(replacement[field]);
    const value = `legacy-patched-${randomUUID()}`;
    const patched = await http('patch', item, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: field, value }],
    });
    expect(patched.status).toBe(200);
    const read = await http('get', item);
    expect(read.status).toBe(200);
    expect(read.body[field]).toBe(value);
    const deleted = await http('delete', item);
    expect(deleted.status).toBe(204);
    expect((await http('get', item)).status).toBe(404);
    if (isPrisma) {
      const stored = await prisma.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
      expect(endpointProfileRevision(stored.profile)).toBe(persistedRevision);
    }
  });

  it.each(cases)('rejects a stale %s %s without publishing a mutation', async (route, operation) => {
    const repository = route === 'Users' ? users : route === 'Groups' ? groups : generic;
    let itemUrl: string | undefined;
    if (operation !== 'create') {
      const seeded = await http('post', `/scim/v2/endpoints/${endpointId}/${route}`, payload(route));
      expect(seeded.status).toBe(201);
      itemUrl = `/scim/v2/endpoints/${endpointId}/${route}/${seeded.body.id}`;
    }
    const before = await rows(route);
    const method = operation === 'create'
      ? 'create'
      : operation === 'delete'
        ? 'delete'
        : route === 'Groups' ? 'updateGroupWithMembers' : 'update';
    const pause = pauseWrite(repository, method);
    const pending = (operation === 'create'
      ? http('post', `/scim/v2/endpoints/${endpointId}/${route}`, payload(route))
      : operation === 'replace'
        ? http('put', itemUrl!, payload(route))
        : http('delete', itemUrl!))
      .then(response => response);
    await pause.reached;

    strict = !strict;
    const profileChanged = await http('patch', `/scim/admin/endpoints/${endpointId}`, {
      profile: { settings: { StrictSchemaValidation: strict } },
    });
    expect(profileChanged.status).toBe(200);
    pause.resume();

    const rejected = await pending;
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      schemas: [SCIM_ERROR_SCHEMA],
      status: '409',
      detail: 'Endpoint profile changed while the resource write was in progress. Read the current endpoint schema and retry.',
      [SCIM_DIAGNOSTICS_URN]: {
        errorCode: 'PROFILE_REVISION_CHANGED',
        triggeredBy: 'configuration',
      },
    });
    expect(Object.keys(rejected.body).sort()).toEqual(
      ['schemas', 'status', 'detail', SCIM_DIAGNOSTICS_URN].sort(),
    );
    expect(await rows(route)).toEqual(before);
  });
});
