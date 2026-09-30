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
import type { ProfileRevision } from '../../src/domain/repositories/profile-revision';

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
    expect(stdout).toContain('conditional live contract: 33 assertions passed');
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
    it(`${route}: wildcard and absent conditions preserve unconditional write behavior`, async () => {
      const ep = await endpoint();
      const initial = await create(ep, route);
      const id = String(initial.body.id);
      for (const etag of [undefined, '*']) {
        const repo = route === 'Users' ? users : route === 'Groups' ? groups : generic;
        const method = route === 'Groups' ? 'updateGroupWithMembers' : 'update';
        const responses = await barrier(repo, method as keyof typeof repo, () => Promise.all(['a', 'b'].map((name) =>
          write(ep, route, id, 'patch', name, etag))));
        expect(responses.map((r) => r.status)).toEqual([200, 200]);
      }
      expect((await stored(ep, route, id))?.version).toBe(5);
      errorContract(await write(ep, route, id, 'patch', 'no-list', 'W/"v4", W/"v5"'), 412);
      expect((await stored(ep, route, id))?.version).toBe(5);
    });
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
