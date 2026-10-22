import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getLegacyToken } from './helpers/auth.helper';
import type { IUserRepository } from '../../src/domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../src/domain/repositories/group.repository.interface';
import type { IGenericResourceRepository } from '../../src/domain/repositories/generic-resource.repository.interface';
import type { ExpectedVersion } from '../../src/domain/repositories/write-precondition';
import { observeWriteVersion } from '../../src/domain/repositories/write-precondition';
import { endpointProfileRevision, type ProfileRevision } from '../../src/domain/repositories/profile-revision';
import { compileUniquenessPolicy, type UniquenessPolicy } from '../../src/domain/repositories/uniqueness-policy';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { getCorrelationContext } from '../../src/modules/logging/scim-logger.service';
import { EndpointService } from '../../src/modules/endpoint/services/endpoint.service';
import type { Prisma } from '../../src/generated/prisma/client';
import { lockEndpointProfile } from '../../src/infrastructure/repositories/prisma/prisma-profile-revision';
import { SCIM_DIAGNOSTICS_URN } from '../../src/modules/scim/common/scim-constants';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const DEVICE = 'urn:example:conditional:Device';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const routes = ['Users', 'Groups', 'Devices'] as const;
type Route = typeof routes[number];
type Verb = 'put' | 'patch' | 'delete';
type ScimResponse = Omit<request.Response, 'body'> & {
  body: { id: string; userName?: string; [key: string]: unknown };
};

/** Pause two real calls before mutation, never replace the storage implementation. */
async function barrier<T extends object, K extends keyof T>(
  repo: T, method: K, work: () => Promise<request.Response[]>,
) {
  const original = repo[method];
  let count = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const timeout = setTimeout(release, 10_000);
  const spy = jest.spyOn(repo, method as never).mockImplementation((async (...args: unknown[]) => {
    count++;
    if (count === 2) release();
    await ready;
    return Reflect.apply(original as (...args: unknown[]) => unknown, repo, args);
  }) as never);
  try {
    const result = await work();
    expect(count).toBe(2);
    return result;
  } finally {
    clearTimeout(timeout);
    spy.mockRestore();
  }
}

describe('conditional writes with real repositories', () => {
  let app: INestApplication;
  let users: IUserRepository;
  let groups: IGroupRepository;
  let generic: IGenericResourceRepository;
  const observations: object[] = [];
  const http = async (method: 'post' | 'get' | Verb, url: string, body?: object, etag?: string): Promise<ScimResponse> => {
    const req = request(app.getHttpServer() as Server)[method](url)
      .set('Authorization', `Bearer ${getLegacyToken()}`)
      .set('Content-Type', 'application/scim+json');
    if (etag) req.set('If-Match', etag);
    return body ? req.send(body) : req;
  };
  const body = (route: Route, name: string, members: object[] = []) => ({
    schemas: [{ Users: USER, Groups: GROUP, Devices: DEVICE }[route]],
    ...(route === 'Users' ? { userName: name } : { displayName: name }),
    ...(route === 'Groups' ? { members } : {}),
  });
  const stored = (ep: string, route: Route, id: string) =>
    route === 'Users' ? users.findByScimId(ep, id)
      : route === 'Groups' ? groups.findWithMembers(ep, id)
        : generic.findByScimId(ep, 'Device', id);
  async function endpoint(etag = true) {
    const res = await http('post', '/scim/admin/endpoints', {
      name: `conditional-${randomUUID()}`,
      profile: {
        schemas: [
          { id: USER, name: 'User', attributes: 'all' },
          { id: GROUP, name: 'Group', attributes: 'all' },
          { id: DEVICE, name: 'Device', attributes: [
            { name: 'displayName', type: 'string', multiValued: false },
          ] },
        ],
        resourceTypes: routes.map((route) => ({
          id: { Users: 'User', Groups: 'Group', Devices: 'Device' }[route],
          name: { Users: 'User', Groups: 'Group', Devices: 'Device' }[route],
          endpoint: `/${route}`,
          schema: { Users: USER, Groups: GROUP, Devices: DEVICE }[route],
          schemaExtensions: [],
        })),
        settings: { StrictSchemaValidation: true, logFileEnabled: false },
        serviceProviderConfig: { patch: { supported: true }, etag: { supported: etag } },
      },
    });
    expect(res.status).toBe(201);
    return String(res.body.id);
  }
  const base = (ep: string, route: Route) => `/scim/v2/endpoints/${ep}/${route}`;
  async function create(ep: string, route: Route, name = `before-${randomUUID()}`) {
    const res = await http('post', base(ep, route), body(route, name));
    expect(res.status).toBe(201);
    return res;
  }
  const write = (ep: string, route: Route, id: string, verb: Verb, name: string, etag?: string, members: object[] = []) => {
    const data = verb === 'delete' ? undefined : verb === 'put' ? body(route, name, members) : {
      schemas: [PATCH],
      Operations: [
        { op: 'replace', path: route === 'Users' ? 'userName' : 'displayName', value: name },
        ...(route === 'Groups' ? [{ op: 'replace', path: 'members', value: members }] : []),
      ],
    };
    return http(verb, `${base(ep, route)}/${id}`, data, etag);
  };
  function errorContract(response: request.Response, status: number) {
    const payload = response.body as Record<string, unknown>;
    expect(response.status).toBe(status);
    expect(payload.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(String(payload.status)).toBe(String(status));
    expect(typeof payload.detail).toBe('string');
    for (const key of Object.keys(payload)) {
      expect(['schemas', 'status', 'scimType', 'detail', 'urn:scimserver:api:messages:2.0:Diagnostics']).toContain(key);
    }
    expect(JSON.stringify(response.body)).not.toMatch(/PrismaClient|P2025|P2002|stack/);
  }
  beforeAll(async () => {
    app = await createTestApp();
    const server = app.getHttpServer() as Server;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    users = app.get('USER_REPOSITORY');
    groups = app.get('GROUP_REPOSITORY');
    generic = app.get('GENERIC_RESOURCE_REPOSITORY');
    expect(users.constructor.name).toBe(process.env.PERSISTENCE_BACKEND === 'inmemory'
      ? 'InMemoryUserRepository' : 'PrismaUserRepository');
    expect((await http('get', '/scim/health')).status).toBe(200);
  });
  afterAll(async () => {
    if (process.env.PG_ANALYSIS_OUTPUT) {
      writeFileSync(join(process.env.PG_ANALYSIS_OUTPUT, `${process.env.PERSISTENCE_BACKEND}-stored.json`),
        JSON.stringify(observations, null, 2));
    }
    await app?.close();
  });

  it('live PowerShell conditional contract on an owned loopback runtime', async () => {
    const ep = await endpoint();
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') throw new Error('Expected owned loopback listener');
    const { stdout } = await promisify(execFile)('pwsh', [
      '-NoProfile', '-File', join(__dirname, '..', '..', '..', 'scripts', 'live-conditional-writes.ps1'),
      '-EndpointUrl', `http://127.0.0.1:${address.port}/scim/v2/endpoints/${ep}`,
    ], { env: { ...process.env, E2E_TOKEN: getLegacyToken() } });
    expect(stdout).toContain('conditional live contract: 87 assertions passed');
    expect(stdout).toContain('conditional caller If-Match unchanged');
  });

  for (const route of routes) {
    it(`${route}: a real update after DELETE reads its snapshot makes DELETE fail 412`, async () => {
      const ep = await endpoint();
      const initial = await create(ep, route);
      const id = String(initial.body.id);
      const repo = route === 'Users' ? users : route === 'Groups' ? groups : generic;
      const originalDelete = repo.delete.bind(repo);
      const originalUpdate = repo.update.bind(repo);
      const spy = jest.spyOn(repo, 'delete').mockImplementationOnce(async (
        storageId: string,
        expected?: ExpectedVersion,
        profileRevision?: ProfileRevision,
      ) => {
        await originalUpdate(storageId, { displayName: 'intervening-write' });
        return originalDelete(storageId, expected, profileRevision);
      });
      try {
        errorContract(await write(ep, route, id, 'delete', 'ignored', initial.headers.etag), 412);
        expect(await stored(ep, route, id)).toMatchObject({ version: 2, displayName: 'intervening-write' });
      } finally {
        spy.mockRestore();
      }
    });
    for (const verb of ['put', 'patch', 'delete'] as const) {
      it(`${route} ${verb}: one same-version writer wins and the loser changes nothing`, async () => {
        const ep = await endpoint();
        const initial = await create(ep, route);
        const id = String(initial.body.id);
        const repo = route === 'Users' ? users : route === 'Groups' ? groups : generic;
        const method = verb === 'delete' ? 'delete' : route === 'Groups' ? 'updateGroupWithMembers' : 'update';
        const member = route === 'Groups' ? await create(ep, 'Users') : undefined;
        const names = [`winner-a-${randomUUID()}`, `winner-b-${randomUUID()}`];
        const responses = await barrier(repo, method as keyof typeof repo, () => Promise.all(names.map((name, i) =>
          write(ep, route, id, verb, name, initial.headers.etag,
            member && i === 0 ? [{ value: member.body.id }] : []))));
        const row = await stored(ep, route, id);
        observations.push({ route, verb, statuses: responses.map((r) => r.status), stored: row });
        expect(responses.map((r) => r.status).sort()).toEqual(verb === 'delete' ? [204, 412] : [200, 412]);
        errorContract(responses.find((r) => r.status === 412)!, 412);
        if (verb === 'delete') {
          expect(row).toBeNull();
        } else {
          const winner = responses.findIndex((r) => r.status === 200);
          expect(row?.version).toBe(2);
          expect(route === 'Users' ? (await users.findByScimId(ep, id))?.userName : row?.displayName).toBe(names[winner]);
          if (route === 'Groups') {
            expect((await groups.findWithMembers(ep, id))?.members.map((m) => m.value))
              .toEqual(winner === 0 ? [member!.body.id] : []);
          }
        }
      });
    }
    it(`${route}: stale PUT/PATCH/DELETE leave stored version and payload unchanged`, async () => {
      const ep = await endpoint();
      const initial = await create(ep, route);
      const id = String(initial.body.id);
      expect((await write(ep, route, id, 'patch', 'current', initial.headers.etag)).status).toBe(200);
      const before = await stored(ep, route, id);
      for (const verb of ['put', 'patch', 'delete'] as const) {
        errorContract(await write(ep, route, id, verb, 'rejected', initial.headers.etag), 412);
        expect(await stored(ep, route, id)).toEqual(before);
      }
    });
    it(`${route}: wildcard and absent conditions reject stale computed writes without losing the winner`, async () => {
      const ep = await endpoint();
      const initial = await create(ep, route);
      const id = String(initial.body.id);
      for (const etag of [undefined, '*']) {
        const repo = route === 'Users' ? users : route === 'Groups' ? groups : generic;
        const method = route === 'Groups' ? 'updateGroupWithMembers' : 'update';
        const responses = await barrier(repo, method as keyof typeof repo, () => Promise.all(['a', 'b'].map((name) =>
          write(ep, route, id, 'patch', name, etag))));
        expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
        errorContract(responses.find((r) => r.status === 409)!, 409);
        const winner = responses.findIndex((r) => r.status === 200);
        const row = await stored(ep, route, id);
        expect(route === 'Users' ? (await users.findByScimId(ep, id))?.userName : row?.displayName)
          .toBe(['a', 'b'][winner]);
      }
      expect((await stored(ep, route, id))?.version).toBe(3);
      errorContract(await write(ep, route, id, 'patch', 'no-list', 'W/"v2", W/"v3"'), 412);
      expect((await stored(ep, route, id))?.version).toBe(3);
    });
    for (const verb of ['put', 'patch'] as const) {
      for (const mode of ['absent', 'wildcard', 'disabled'] as const) {
        it(`${route}: internal version protects ${verb} when ETag mode is ${mode}`, async () => {
          const ep = await endpoint(mode !== 'disabled');
          const initial = await create(ep, route);
          const id = String(initial.body.id);
          const repo = route === 'Users' ? users : route === 'Groups' ? groups : generic;
          const method = route === 'Groups' ? 'updateGroupWithMembers' : 'update';
          const condition = mode === 'wildcard' ? '*' : mode === 'disabled' ? 'W/"v99"' : undefined;
          const names = ['winner-a', 'winner-b'];
          const responses = await barrier(repo, method as keyof typeof repo, () =>
            Promise.all(names.map((name) => write(ep, route, id, verb, name, condition))));
          expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
          const loser = responses.find((r) => r.status === 409)!;
          errorContract(loser, 409);
          expect((loser.body as Record<string, unknown>).scimType).toBeUndefined();
          expect(loser.body).toMatchObject({
            'urn:scimserver:api:messages:2.0:Diagnostics': { errorCode: 'RESOURCE_VERSION_CHANGED' },
          });
          const row = await stored(ep, route, id);
          expect(row?.version).toBe(2);
          const winner = responses.findIndex((r) => r.status === 200);
          expect(route === 'Users' ? (await users.findByScimId(ep, id))?.userName : row?.displayName)
            .toBe(names[winner]);
          for (const key of Object.keys(responses[winner].body as Record<string, unknown>)) {
            expect(['schemas', 'id', 'externalId', 'userName', 'displayName', 'active', 'members', 'meta'])
              .toContain(key);
          }
        });
      }
    }
    it(`${route}: ETag-disabled endpoint ignores a supplied stale condition`, async () => {
      const ep = await endpoint(false);
      const initial = await create(ep, route);
      expect((await write(ep, route, String(initial.body.id), 'patch', 'accepted', 'W/"v99"')).status).toBe(200);
      expect((await stored(ep, route, String(initial.body.id)))?.version).toBe(2);
    });
    it(`${route}: scoped lookup cannot mutate another endpoint`, async () => {
      const a = await endpoint();
      const b = await endpoint();
      const initial = await create(a, route);
      const before = await stored(a, route, String(initial.body.id));
      for (const verb of ['put', 'patch', 'delete'] as const) {
        errorContract(await write(b, route, String(initial.body.id), verb, 'wrong', initial.headers.etag), 404);
      }
      expect(await stored(a, route, String(initial.body.id))).toEqual(before);
    });
  }
  it('a rejected membership PATCH can be retried as original intent without losing the winning addition', async () => {
    const ep = await endpoint();
    const initial = await create(ep, 'Groups');
    const members = await Promise.all([create(ep, 'Users'), create(ep, 'Users')]);
    const add = (index: number) => http('patch', `${base(ep, 'Groups')}/${initial.body.id}`, {
      schemas: [PATCH],
      Operations: [{ op: 'add', path: 'members', value: [{ value: members[index].body.id }] }],
    });
    const responses = await barrier(groups, 'updateGroupWithMembers', () => Promise.all([add(0), add(1)]));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex((r) => r.status === 200);
    const loser = 1 - winner;
    expect((await groups.findWithMembers(ep, String(initial.body.id)))?.members.map((m) => m.value))
      .toEqual([members[winner].body.id]);
    expect((await add(loser)).status).toBe(200);
    const storedGroup = await groups.findWithMembers(ep, String(initial.body.id));
    expect(storedGroup?.version).toBe(3);
    expect(storedGroup?.members.map((m) => m.value).sort())
      .toEqual(members.map((member) => member.body.id).sort());
  });
  const pgOnly = process.env.PERSISTENCE_BACKEND === 'prisma' ? it : it.skip;
  for (const mode of ['absent', 'wildcard', 'disabled'] as const) {
    pgOnly(`independent application pools reject a stale Group aggregate in ${mode} mode`, async () => {
        const ep = await endpoint(mode !== 'disabled');
        const initial = await create(ep, 'Groups');
        const members = await Promise.all([create(ep, 'Users'), create(ep, 'Users')]);
        const other = await createTestApp();
        const original = groups.updateGroupWithMembers.bind(groups);
        const addBody = (index: number) => ({
          schemas: [PATCH],
          Operations: [{ op: 'add', path: 'members', value: [{ value: members[index].body.id }] }],
        });
        let committedPeer = false;
        const spy = jest.spyOn(groups, 'updateGroupWithMembers').mockImplementationOnce(async (...args) => {
          const peer = await request(other.getHttpServer() as Server)
            .patch(`${base(ep, 'Groups')}/${initial.body.id}`)
            .set('Authorization', `Bearer ${getLegacyToken()}`)
            .set('Content-Type', 'application/scim+json').send(addBody(1));
          expect(peer.status).toBe(200);
          committedPeer = true;
          return original(...args);
        });
        try {
          const response = await http('patch', `${base(ep, 'Groups')}/${initial.body.id}`, addBody(0),
            mode === 'wildcard' ? '*' : mode === 'disabled' ? 'W/"v99"' : undefined);
          expect(committedPeer).toBe(true);
          errorContract(response, 409);
          const row = await groups.findWithMembers(ep, String(initial.body.id));
          expect(row?.version).toBe(2);
          expect(row?.members.map((member) => member.value)).toEqual([members[1].body.id]);
        } finally {
          spy.mockRestore();
          await other.close();
        }
    });
  }
  for (const [verb, peerVerb] of [
    ['put', 'patch'], ['put', 'delete'], ['patch', 'patch'], ['patch', 'delete'],
  ] as const) {
    it(`Group ${verb} returns its own committed scalar, membership and ETag after peer ${peerVerb}`, async () => {
      const ep = await endpoint();
      const initial = await create(ep, 'Groups');
      const members = await Promise.all([create(ep, 'Users'), create(ep, 'Users')]);
      const original = groups.updateGroupWithMembers.bind(groups);
      const spy = jest.spyOn(groups, 'updateGroupWithMembers').mockImplementationOnce(async (...args) => {
        const committed = await original(...args);
        const peer = await write(ep, 'Groups', String(initial.body.id), peerVerb, 'peer-state', undefined,
          [{ value: members[1].body.id }]);
        expect(peer.status).toBe(peerVerb === 'patch' ? 200 : 204);
        if (peerVerb === 'patch') expect(peer.body.meta).toMatchObject({ version: 'W/"v3"' });
        return committed;
      });
      const reads = jest.spyOn(groups, 'findWithMembers');
      try {
        const own = await write(ep, 'Groups', String(initial.body.id), verb, 'own-state', undefined,
          [{ value: members[0].body.id }]);
        expect(own.status).toBe(200);
        expect(own.body.meta).toMatchObject({ version: 'W/"v2"' });
        expect(own.headers.etag).toBe('W/"v2"');
        expect(own.body.displayName).toBe('own-state');
        expect(own.body.members).toEqual([expect.objectContaining({ value: members[0].body.id })]);
        expect(reads).toHaveBeenCalledTimes(peerVerb === 'patch' ? 2 : 1);
        const current = await groups.findWithMembers(ep, String(initial.body.id));
        if (peerVerb === 'patch') {
          expect(current).toMatchObject({ version: 3, displayName: 'peer-state' });
          expect(current?.members.map((member) => member.value)).toEqual([members[1].body.id]);
        } else {
          expect(current).toBeNull();
        }
        for (const key of Object.keys(own.body)) {
          expect(['schemas', 'id', 'displayName', 'externalId', 'members', 'meta']).toContain(key);
        }
      } finally {
        reads.mockRestore();
        spy.mockRestore();
      }
    });
  }

  it('membership-only append advances the aggregate version and failed append rolls it back', async () => {
    const ep = await endpoint();
    const initial = await create(ep, 'Groups');
    const group = await groups.findWithMembers(ep, String(initial.body.id));
    if (!group) throw new Error('Expected created Group');
    const member = { value: randomUUID(), userId: null, type: null, display: null };
    await groups.addMembers(group.id, [member], []);
    const before = await groups.findWithMembers(ep, group.scimId);
    expect(before).toMatchObject({ version: 2, members: [{ value: member.value }] });
    await expect(groups.addMembers(group.id, [member], [])).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await groups.findWithMembers(ep, group.scimId)).toEqual(before);
  });

  for (const condition of [undefined, '*'] as const) {
    pgOnly(`final PostgreSQL CAS arbitrates independent pools without namespace/profile probes (${condition})`, async () => {
      const ep = await endpoint();
      const initial = await create(ep, 'Groups');
      const group = await groups.findWithMembers(ep, String(initial.body.id));
      if (!group) throw new Error('Expected created Group');
      const other = await createTestApp();
      const peer = other.get<IGroupRepository>('GROUP_REPOSITORY');
      try {
        const results = await Promise.allSettled([groups, peer].map((repo, index) =>
          repo.updateGroupWithMembers(group.id, { displayName: `direct-${index}` }, [{
            value: `direct-member-${index}`, userId: null, type: null, display: null,
          }], observeWriteVersion(group.version, condition), [])));
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected');
        expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'WRITE_CONFLICT' } });
        const winner = results.findIndex((result) => result.status === 'fulfilled');
        const row = await groups.findWithMembers(ep, group.scimId);
        expect(row).toMatchObject({
          version: 2, displayName: `direct-${winner}`, members: [{ value: `direct-member-${winner}` }],
        });
        expect(row?.members).toHaveLength(1);
      } finally {
        await other.close();
      }
    });
  }

  it.each(['put', 'patch'] as const)('retains atomic unchanged-name uniqueness without a preliminary Group %s probe', async verb => {
    const configured = await http('post', '/scim/admin/endpoints', {
      name: `unchanged-name-${randomUUID()}`, profilePreset: 'rfc-standard',
    });
    expect(configured.status).toBe(201);
    const ep = configured.body.id;
    try {
      const user = await create(ep, 'Users');
      const group = await create(ep, 'Groups');
      const name = String(group.body.displayName);
      const probe = jest.spyOn(groups, 'findByDisplayName');
      try {
        const updated = await write(ep, 'Groups', group.body.id, verb, name, undefined, [{ value: user.body.id }]);
        expect(updated.status).toBe(200);
        expect(updated.body).toMatchObject({
          displayName: name, members: [{ value: user.body.id }], meta: { version: 'W/"v2"' },
        });
        expect(probe).not.toHaveBeenCalled();
        await groups.create({
          endpointId: ep, scimId: randomUUID(), externalId: null, displayName: name, rawPayload: '{}', meta: '{}',
        });
        const rejected = await write(ep, 'Groups', group.body.id, verb, name, undefined, [{ value: user.body.id }]);
        errorContract(rejected, 409);
        expect(rejected.body.scimType).toBe('uniqueness');
        expect(probe).not.toHaveBeenCalled();
        expect(await groups.findWithMembers(ep, group.body.id)).toMatchObject({
          displayName: name, version: 2, members: [{ value: user.body.id }],
        });
      } finally {
        probe.mockRestore();
      }
    } finally {
      expect((await http('delete', `/scim/admin/endpoints/${ep}`)).status).toBe(204);
    }
  });

  it.each(routes.flatMap(route => (['endpoint', 'resource'] as const).map(dimension => [route, dimension] as const)))(
    'binds the final %s write to its observed %s scope without earlier policy probes',
    async (route, dimension) => {
      const ep = await endpoint();
      const initial = await create(ep, route);
      const original = await stored(ep, route, initial.body.id);
      if (!original) throw new Error('Expected created scoped resource');
      const expected = {
        observedVersion: original.version,
        scope: {
          endpointId: dimension === 'endpoint' ? randomUUID() : ep,
          resourceType: dimension === 'resource' ? 'Other' : { Users: 'User', Groups: 'Group', Devices: 'Device' }[route],
        },
      };
      try {
        const change = route === 'Users'
          ? users.update(original.id, { userName: 'must-not-change' }, expected, [])
          : route === 'Groups'
            ? groups.updateGroupWithMembers(original.id, { displayName: 'must-not-change' }, [], expected, [])
            : generic.update(original.id, { displayName: 'must-not-change' }, expected, []);
        await expect(change).rejects.toMatchObject({ code: 'WRITE_CONFLICT' });
        const after = await stored(ep, route, initial.body.id);
        expect(after).toMatchObject({ version: 1 });
        expect(after).toEqual(original);
      } finally {
        expect((await http('delete', `/scim/admin/endpoints/${ep}`)).status).toBe(204);
      }
    },
  );

  pgOnly.each(routes.flatMap(route => (['put', 'patch'] as const).map(verb => [route, verb] as const)))(
    'reuses observed %s %s scope without a transactional identity lookup',
    async (route, verb) => {
      const ep = await endpoint();
      const initial = await create(ep, route);
      const original = await stored(ep, route, initial.body.id);
      if (!original) throw new Error('Expected created resource');
      const prisma = app.get(PrismaService);
      const originalTransaction = prisma.$transaction.bind(prisma);
      let identityReads = 0;
      let transactions = 0;
      const predicates: unknown[] = [];
      const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((work, options) =>
        originalTransaction(async tx => {
          transactions++;
          const identity = jest.spyOn(tx.scimResource, 'findUnique');
          const update = jest.spyOn(tx.scimResource, 'update');
          try {
            return await work(tx);
          } finally {
            identityReads += identity.mock.calls.filter(([args]) => args.select?.endpointId).length;
            predicates.push(...update.mock.calls.map(([args]) => args.where));
            identity.mockRestore();
            update.mockRestore();
          }
        }, options));
      try {
        const result = await write(ep, route, initial.body.id, verb, `scope-${randomUUID()}`);
        expect(result.status).toBe(200);
        expect(transactions).toBeGreaterThan(0);
        expect(identityReads).toBe(0);
        expect(predicates).toEqual([{
          id: original.id, endpointId: ep,
          resourceType: { Users: 'User', Groups: 'Group', Devices: 'Device' }[route], version: 1,
        }]);
        expect(await stored(ep, route, initial.body.id)).toMatchObject({ version: 2 });
      } finally {
        transaction.mockRestore();
        expect((await http('delete', `/scim/admin/endpoints/${ep}`)).status).toBe(204);
      }
    },
  );

  pgOnly.each(['put', 'patch'] as const)('coordinates Group %s locks in one statement while holding both exact namespaces', async verb => {
    const configured = await http('post', '/scim/admin/endpoints', {
      name: `coordinated-locks-${randomUUID()}`, profilePreset: 'rfc-standard',
    });
    expect(configured.status).toBe(201);
    const ep = configured.body.id;
    const initial = await create(ep, 'Groups');
    const prisma = app.get(PrismaService);
    const profileNamespace = JSON.stringify(['scim-endpoint-profile', ep]);
    const uniquenessNamespace = JSON.stringify(['scim-uniqueness', ep, 'Group']);
    const originalTransaction = prisma.$transaction.bind(prisma);
    let lockStatements = 0;
    let protectedDataStatements = 0;
    let transactions = 0;
    let held: { namespace: string; held: boolean }[] = [];
    const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((work, options) =>
      originalTransaction(async tx => {
        const locks = jest.spyOn(tx, '$executeRaw');
        const profiles = jest.spyOn(tx.endpoint, 'findUnique');
        const resources = jest.spyOn(tx.scimResource, 'findMany');
        const snapshots = jest.spyOn(tx, '$queryRaw');
        try {
          const result = await work(tx);
          transactions++;
          lockStatements += locks.mock.calls.length;
          protectedDataStatements += profiles.mock.calls.length +
            resources.mock.calls.length + snapshots.mock.calls.length;
          held = await tx.$queryRaw<{ namespace: string; held: boolean }[]>`
            SELECT expected.namespace, EXISTS (
              SELECT 1 FROM pg_locks l
              WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
                AND l.objsubid = 1
                AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(expected.namespace, 0)
            ) AS held
            FROM unnest(ARRAY[${profileNamespace}, ${uniquenessNamespace}]::text[])
              WITH ORDINALITY AS expected(namespace, ordinal)
            ORDER BY expected.ordinal`;
          return result;
        } finally {
          locks.mockRestore();
          profiles.mockRestore();
          resources.mockRestore();
          snapshots.mockRestore();
        }
      }, options));
    try {
      const name = `coordinated-${randomUUID()}`;
      const result = await write(ep, 'Groups', initial.body.id, verb, name);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ displayName: name, meta: { version: 'W/"v2"' } });
      expect(transactions).toBe(1);
      expect(held).toEqual([
        { namespace: profileNamespace, held: true },
        { namespace: uniquenessNamespace, held: true },
      ]);
      expect(lockStatements).toBe(1);
      expect(protectedDataStatements).toBe(1);
    } finally {
      transaction.mockRestore();
      expect((await http('delete', `/scim/admin/endpoints/${ep}`)).status).toBe(204);
    }
  });

  pgOnly.each(['value', 'type', 'display'] as const)(
    'projects protected member %s uniqueness without changing committed members',
    async attribute => {
      const ep = await endpoint();
      const prisma = app.get(PrismaService);
      const configured = await prisma.endpoint.findUniqueOrThrow({ where: { id: ep }, select: { profile: true } });
      const revision = endpointProfileRevision(configured.profile);
      const policy = compileUniquenessPolicy([{
        id: GROUP, isCoreSchema: true, attributes: [{
          name: 'members', type: 'complex', multiValued: true, required: false, subAttributes: [{
            name: attribute, type: 'string', uniqueness: 'server', caseExact: attribute === 'value',
            multiValued: false, required: false,
          }],
        }],
      }]);
      const input = () => ({
        endpointId: ep, scimId: randomUUID(), displayName: randomUUID(),
        externalId: null, rawPayload: '{}', meta: '{}',
      });
      const member = { userId: null, value: randomUUID(), type: 'User', display: 'OWNER' };
      const competing = {
        userId: null, value: randomUUID(), type: 'Group', display: 'OTHER',
        [attribute]: attribute === 'value' ? member.value : member[attribute].toLowerCase(),
      };
      try {
        const owner = await groups.create(input(), [member], policy, revision);
        await expect(groups.create(input(), [competing], policy, revision))
          .rejects.toMatchObject({ code: 'CONFLICT' });
        const second = await groups.create(input(), [], policy, revision);
        const original = await groups.findWithMembers(ep, second.scimId);
        const observed = observeWriteVersion(1, undefined, { endpointId: ep, resourceType: 'Group' });
        await expect(groups.updateGroupWithMembers(second.id, { displayName: 'must-not-commit' },
          [competing], observed, policy, revision)).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await groups.findWithMembers(ep, second.scimId)).toEqual(original);
        const committed = await groups.updateGroupWithMembers(owner.id, { displayName: 'self-kept' },
          [member], observed, policy, revision);
        expect(committed).toMatchObject({
          version: 2, displayName: 'self-kept',
          members: [{ value: member.value, type: 'User', display: 'OWNER' }],
        });
      } finally {
        expect((await http('delete', `/scim/admin/endpoints/${ep}`)).status).toBe(204);
      }
    },
  );

  pgOnly('retains a fresh post-lock profile read after a real blocked writer', async () => {
    const configured = await http('post', '/scim/admin/endpoints', {
      name: `post-lock-profile-${randomUUID()}`, profilePreset: 'rfc-standard',
    });
    expect(configured.status).toBe(201);
    const ep = configured.body.id;
    const initial = await create(ep, 'Groups');
    const original = await groups.findWithMembers(ep, initial.body.id);
    if (!original) throw new Error('Expected original Group');
    const prisma = app.get(PrismaService);
    const persisted = await prisma.endpoint.findUniqueOrThrow({ where: { id: ep } });
    const profile = persisted.profile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Expected object profile');
    const settings = profile.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Expected object settings');
    const changed = { ...profile, settings: { ...settings, StrictSchemaValidation: settings.StrictSchemaValidation !== true } };
    const namespace = JSON.stringify(['scim-uniqueness', ep, 'Group']);
    let pending: Promise<ScimResponse> | undefined;
    try {
      await prisma.$transaction(async tx => {
        await lockEndpointProfile(tx, ep);
        pending = write(ep, 'Groups', initial.body.id, 'patch', `must-not-commit-${randomUUID()}`);
        let blocked = false;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const waiting = await tx.$queryRaw<{ blocked: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND wait_event_type = 'Lock' AND wait_event = 'advisory'
            ) AS blocked`;
          if (waiting[0]?.blocked) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        const available = await tx.$queryRaw<{ available: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${namespace}, 0)) AS available`;
        expect(available).toEqual([{ available: true }]);
        await tx.endpoint.update({ where: { id: ep }, data: { profile: changed } });
      }, { maxWait: 10000, timeout: 15000 });
      if (!pending) throw new Error('Expected blocked write');
      const rejected = await pending;
      errorContract(rejected, 409);
      expect(rejected.body).toMatchObject({ [SCIM_DIAGNOSTICS_URN]: { errorCode: 'PROFILE_REVISION_CHANGED' } });
      expect(await groups.findWithMembers(ep, initial.body.id)).toEqual(original);
    } finally {
      try {
        if (pending) await pending;
      } finally {
        expect((await http('delete', `/scim/admin/endpoints/${ep}`)).status).toBe(204);
      }
    }
  });

  it('does not open a shared snapshot scope for admin, endpoint OAuth or Bulk operations', async () => {
    const ep = await endpoint();
    const scope = jest.spyOn(app.get(EndpointService), 'runWithRequestSnapshot');
    try {
      const configured = await http('patch', `/scim/admin/endpoints/${ep}`, {
        profile: {
          settings: { BulkOperationsEnabled: true, OAuthClientCredentialsAuthEnabled: true },
          serviceProviderConfig: { bulk: { supported: true } },
        },
      });
      expect(configured.status).toBe(200);
      const credentials = await http('post', `/scim/admin/endpoints/${ep}/credentials`, {
        credentialType: 'oauth_client', label: 'request-snapshot-exclusion',
      });
      expect(credentials.status).toBe(201);
      const minted = await http('post', `/scim/endpoints/${ep}/oauth/token`, {
        grant_type: 'client_credentials', client_id: credentials.body.clientId, client_secret: credentials.body.clientSecret,
      });
      expect(minted.status).toBe(200);
      expect(typeof minted.body.access_token).toBe('string');
      expect(minted.body.token_type).toBe('Bearer');
      const names = [0, 1].map(index => `scope-bulk-${index}-${randomUUID()}`);
      const bulk = await http('post', `/scim/endpoints/${ep}/Bulk`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        Operations: names.map((name, index) => ({
          method: 'POST', path: '/Groups', bulkId: `group-${index}`, data: body('Groups', name),
        })),
      });
      expect(bulk.status).toBe(200);
      expect(bulk.body).toMatchObject({ Operations: [{ status: '201' }, { status: '201' }] });
      expect(scope).not.toHaveBeenCalled();
      const list = await http('get', base(ep, 'Groups'));
      expect(list.status).toBe(200);
      expect(list.body.totalResults).toBe(2);
      const resources = list.body.Resources;
      if (!Array.isArray(resources)) throw new Error('Expected the created Group collection');
      const actualNames = resources.map((resource: unknown) => {
        if (resource === null || typeof resource !== 'object' || !('displayName' in resource) ||
            typeof resource.displayName !== 'string') throw new Error('Expected the created Group name');
        return resource.displayName;
      });
      expect(actualNames.sort()).toEqual([...names].sort());
      expect(scope).toHaveBeenCalledTimes(1);
    } finally {
      scope.mockRestore();
    }
  });

  pgOnly('each Group request shares one fresh endpoint snapshot before reading its resource', async () => {
    const ep = await endpoint();
    const group = await create(ep, 'Groups');
    const ids = [randomUUID(), randomUUID()];
    const reads = new Map<string, number>(ids.map(id => [id, 0]));
    const observed = new Map<string, number>();
    const prisma = app.get(PrismaService);
    const originalQuery = prisma.$queryRaw.bind(prisma);
    const originalRead = groups.findWithMembers.bind(groups);
    const query = jest.spyOn(prisma, '$queryRaw').mockImplementation((sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const id = getCorrelationContext()?.requestId;
      if (id && reads.has(id) && Array.isArray(sql) && sql.join('').includes('current_endpoint AS')) {
        reads.set(id, reads.get(id)! + 1);
      }
      return originalQuery(sql, ...values);
    });

    const resource = jest.spyOn(groups, 'findWithMembers').mockImplementation((...args) => {
      const id = getCorrelationContext()?.requestId;
      if (id && reads.has(id)) observed.set(id, reads.get(id)!);
      return originalRead(...args);
    });
    try {
      for (const id of ids) {
        const response = await request(app.getHttpServer() as Server).get(`${base(ep, 'Groups')}/${group.body.id}`)
          .set('Authorization', `Bearer ${getLegacyToken()}`).set('X-Request-Id', id);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ id: group.body.id, displayName: group.body.displayName });
        expect(observed.get(id)).toBe(1);
      }
      expect((await http('patch', `/scim/admin/endpoints/${ep}`, { active: false })).status).toBe(200);
      expect((await http('get', `${base(ep, 'Groups')}/${group.body.id}`)).status).toBe(403);
    } finally {
      resource.mockRestore();
      query.mockRestore();
    }
  });

  pgOnly('does not return or canonicalize the profile body after a protected snapshot match', async () => {
    const ep = await endpoint();
    const group = await create(ep, 'Groups');
    const prisma = app.get(PrismaService);
    const query = jest.spyOn(prisma, '$queryRaw');
    try {
      const response = await http('patch', `${base(ep, 'Groups')}/${group.body.id}`, {
        schemas: [PATCH],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Protected token match' }],
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: group.body.id, displayName: 'Protected token match' });
      const index = query.mock.calls.findIndex(([sql]) =>
        Array.isArray(sql) && sql.join('').includes('AS resources'));
      expect(index).toBeGreaterThanOrEqual(0);
      const result: unknown = await query.mock.results[index].value;
      if (!Array.isArray(result) || result.length !== 1) throw new Error('Expected one protected snapshot');
      const snapshot: unknown = result[0];
      if (snapshot === null || typeof snapshot !== 'object' || !('profile' in snapshot)) {
        throw new Error('Expected protected profile projection');
      }
      expect(snapshot.profile).toBeNull();
    } finally {
      query.mockRestore();
    }
  });

  pgOnly('falls back to profile content after a metadata-only endpoint change', async () => {
    const ep = await endpoint();
    const group = await create(ep, 'Groups');
    const prisma = app.get(PrismaService);
    const original = groups.updateGroupWithMembers.bind(groups);
    const write = jest.spyOn(groups, 'updateGroupWithMembers').mockImplementationOnce(async (...args) => {
      expect(typeof args[5]).toBe('object');
      await prisma.endpoint.update({ where: { id: ep }, data: { description: 'Concurrent metadata only' } });
      return original(...args);
    });
    try {
      const response = await http('patch', `${base(ep, 'Groups')}/${group.body.id}`, {
        schemas: [PATCH],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Metadata fallback accepted' }],
      });
      expect(write).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: group.body.id, displayName: 'Metadata fallback accepted' });
    } finally {
      write.mockRestore();
    }
  });

  pgOnly('never accepts a matching token as proof for another endpoint scope', async () => {
    const ep = await endpoint();
    const group = await create(ep, 'Groups');
    const original = groups.updateGroupWithMembers.bind(groups);
    const write = jest.spyOn(groups, 'updateGroupWithMembers').mockImplementationOnce((...args) => {
      const revision = args[5];
      if (typeof revision !== 'object') throw new Error('Expected a database snapshot observation');
      args[5] = { ...revision, endpointId: randomUUID(), contentRevision: 'wrong-content-revision' };
      return original(...args);
    });
    try {
      const response = await http('patch', `${base(ep, 'Groups')}/${group.body.id}`, {
        schemas: [PATCH],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Must not commit' }],
      });
      expect(write).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        'urn:scimserver:api:messages:2.0:Diagnostics': { errorCode: 'PROFILE_REVISION_CHANGED' },
      });
      const stored = await groups.findWithMembers(ep, group.body.id);
      expect(stored).toMatchObject({ displayName: group.body.displayName, version: 1, members: [] });
    } finally {
      write.mockRestore();
    }
  });

  pgOnly('the database arbitrates duplicate common ids without a namespace scan or partial members', async () => {
    const ep = await endpoint();
    const id = randomUUID();
    const policy: UniquenessPolicy = [{
      schemaUrn: null, path: [{ name: 'id', multiValued: false }], type: 'string', caseExact: true,
    }];
    const prisma = app.get(PrismaService);
    let scans = 0;
    let locks = 0;
    let transactions = 0;
    const originalTransaction = prisma.$transaction.bind(prisma);
    const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((work, options) =>
      originalTransaction(async tx => {
        transactions++;
        const scan = jest.spyOn(tx.scimResource, 'findMany');
        const lock = jest.spyOn(tx, '$executeRaw');
        try {
          return await work(tx);
        } finally {
          scans += scan.mock.calls.length;
          locks += lock.mock.calls.length;
          scan.mockRestore();
          lock.mockRestore();
        }
      }, options));
    try {
      const results = await Promise.allSettled([0, 1].map(index => groups.create({
        endpointId: ep, scimId: id, externalId: null, displayName: `same-id-${index}`,
        rawPayload: '{}', meta: '{}',
      }, [{ value: `member-${index}`, userId: null, type: null, display: null }], policy)));
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(result => result.status === 'rejected'))
        .toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
      expect(transactions).toBe(2);
      expect(scans).toBe(0);
      expect(locks).toBe(0);
      const winner = results.findIndex(result => result.status === 'fulfilled');
      const row = await groups.findWithMembers(ep, id);
      expect(row).toMatchObject({ version: 1, displayName: `same-id-${winner}`, members: [{ value: `member-${winner}` }] });
      expect(row?.members).toHaveLength(1);
    } finally {
      transaction.mockRestore();
    }
  });

  pgOnly('final wildcard CAS distinguishes disappearance without namespace/profile probes', async () => {
    const ep = await endpoint();
    const initial = await create(ep, 'Groups');
    const group = await groups.findWithMembers(ep, String(initial.body.id));
    if (!group) throw new Error('Expected created Group');
    const other = await createTestApp();
    try {
      await other.get<IGroupRepository>('GROUP_REPOSITORY').delete(group.id);
      await expect(groups.updateGroupWithMembers(group.id, { displayName: 'must-not-reappear' }, [],
        observeWriteVersion(group.version, '*'), [])).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(await groups.findWithMembers(ep, group.scimId)).toBeNull();
    } finally {
      await other.close();
    }
  });

  it('atomic case-insensitive User create uniqueness, including endpoint isolation', async () => {
    const ep = await endpoint();
    const name = `duplicate-${randomUUID()}`;
    const responses = await barrier(users, 'create', () => Promise.all([name, name.toUpperCase()].map((userName) =>
      http('post', base(ep, 'Users'), body('Users', userName)))));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    errorContract(responses.find((r) => r.status === 409)!, 409);
    expect((await users.findAll(ep)).map((r) => r.version)).toEqual([1]);
    await create(await endpoint(), 'Users', name);
  });
  for (const verb of ['put', 'patch'] as const) {
    it(`atomic User ${verb} uniqueness rejects one conflicting rename without version increment`, async () => {
      const ep = await endpoint();
      const originals = await Promise.all([create(ep, 'Users'), create(ep, 'Users')]);
      const name = `rename-${randomUUID()}`;
      const responses = await barrier(users, 'update', () => Promise.all(originals.map((r, i) =>
        write(ep, 'Users', String(r.body.id), verb, i ? name.toUpperCase() : name))));
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      errorContract(responses.find((r) => r.status === 409)!, 409);
      const rows = await users.findAll(ep);
      expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
      expect(rows.filter((r) => r.userName.toLowerCase() === name).length).toBe(1);
      const loser = responses.findIndex((r) => r.status === 409);
      expect(rows.find((r) => r.scimId === originals[loser].body.id)?.userName).toBe(originals[loser].body.userName);
    });
  }
});
