import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getLegacyToken } from './helpers/auth.helper';
import type { IUserRepository } from '../../src/domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../src/domain/repositories/group.repository.interface';
import type { IGenericResourceRepository } from '../../src/domain/repositories/generic-resource.repository.interface';
import { compileUniquenessPolicy } from '../../src/domain/repositories/uniqueness-policy';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const DEVICE = 'urn:example:atomic:Device';
const EXT = 'urn:example:atomic:core:extension';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const routes = ['Users', 'Groups', 'Devices'] as const;
type Route = typeof routes[number];
type Body = Record<string, unknown> & { id: string; Resources: Body[]; meta: { version: string } };
type Response = Omit<request.Response, 'body'> & { body: Body };

describe('atomic schema uniqueness through HTTP controllers', () => {
  let app: INestApplication;
  let users: IUserRepository;
  let groups: IGroupRepository;
  let generic: IGenericResourceRepository;
  const endpoints: string[] = [];
  const http = (verb: 'post' | 'get' | 'put' | 'patch' | 'delete', url: string, body?: object): Promise<Response> =>
    request(app.getHttpServer() as Server)[verb](url)
      .set('Authorization', `Bearer ${getLegacyToken()}`)
      .set('Content-Type', 'application/scim+json').send(body);
  const base = (ep: string, route: Route) => `/scim/v2/endpoints/${ep}/${route}`;
  const schema = (route: Route) => ({ Users: USER, Groups: GROUP, Devices: DEVICE }[route]);
  const body = (route: Route, extension: object, name: string = randomUUID()) => ({
    schemas: [schema(route), EXT],
    ...(route === 'Users' ? { userName: name } : { displayName: name }),
    [EXT]: extension,
  });
  const rows = async (ep: string, route: Route) => route === 'Users' ? users.findAll(ep)
    : route === 'Groups' ? groups.findAllWithMembers(ep) : generic.findAll(ep, 'Device');
  async function endpoint(
    customName: Record<string, unknown> = { type: 'string', uniqueness: 'server' },
    customAttributes: Record<string, unknown>[] = [],
  ) {
    const res = await http('post', '/scim/admin/endpoints', {
      name: `atomic-${randomUUID()}`,
      profile: {
        schemas: [
          { id: USER, name: 'User', attributes: 'all' },
          { id: GROUP, name: 'Group', attributes: 'all' },
          { id: DEVICE, name: 'Device', attributes: [
            { name: 'displayName', ...customName },
            ...customAttributes,
          ] },
          { id: EXT, name: 'UniqueValues', attributes: [
            { name: 'badge', type: 'string', uniqueness: 'server' },
            { name: 'exact', type: 'string', caseExact: true, uniqueness: 'server' },
            { name: 'aliases', type: 'string', multiValued: true, uniqueness: 'server' },
            { name: 'codes', type: 'complex', multiValued: true, subAttributes: [
              { name: 'value', type: 'string', uniqueness: 'server' },
            ] },
            { name: 'members', type: 'complex', multiValued: true, subAttributes: [
              { name: '$ref', type: 'reference', uniqueness: 'server', referenceTypes: ['external'] },
            ] },
            { name: 'displayName', type: 'string', uniqueness: 'server' },
            { name: 'free', type: 'string', uniqueness: 'none' },
            { name: 'defaultFree', type: 'string' },
            { name: 'number', type: 'decimal', uniqueness: 'server' },
            { name: 'reference', type: 'reference', uniqueness: 'server', referenceTypes: ['external'] },
            { name: 'enabled', type: 'boolean' },
            { name: 'instant', type: 'dateTime' },
            { name: 'binary', type: 'binary' },
          ] },
        ],
        resourceTypes: routes.map((route) => ({
          id: route.slice(0, -1), name: route.slice(0, -1), endpoint: `/${route}`,
          schema: schema(route), schemaExtensions: [{ schema: EXT, required: false }],
        })),
        settings: { StrictSchemaValidation: true, logFileEnabled: false },
        serviceProviderConfig: { patch: { supported: true }, etag: { supported: true } },
      },
    });
    expect(res.status).toBe(201);
    endpoints.push(res.body.id);
    return res.body.id;
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
  });
  afterAll(async () => {
    for (const ep of endpoints) expect((await http('delete', `/scim/admin/endpoints/${ep}`)).status).toBe(204);
    await app?.close();
  });

  /** Both requests finish service prechecks before either original repository call runs. */
  async function compete(route: Route, verb: 'post' | 'put' | 'patch', work: () => Promise<Response[]>) {
    const repo = route === 'Users' ? users : route === 'Groups' ? groups : generic;
    const method = verb === 'post' ? 'create' : route === 'Groups' ? 'updateGroupWithMembers' : 'update';
    const target = repo as unknown as Record<string, (...args: unknown[]) => unknown>;
    const original = target[method];
    let arrivals = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const timeout = setTimeout(release, 5000);
    const spy = jest.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
      if (++arrivals === 2) release();
      await ready;
      return original.apply(repo, args);
    });
    try {
      const result = await work();
      expect(arrivals).toBe(2);
      return result;
    } finally {
      clearTimeout(timeout);
      spy.mockRestore();
    }
  }
  function conflict(res: Response) {
    expect(res.status).toBe(409);
    expect(res.body.scimType).toBe('uniqueness');
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(String(res.body.status)).toBe('409');
    expect(typeof res.body.detail).toBe('string');
    for (const key of Object.keys(res.body)) {
      expect(['schemas', 'status', 'scimType', 'detail', 'urn:scimserver:api:messages:2.0:Diagnostics']).toContain(key);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/P2002|PrismaClient|stack/);
  }
    it('smokes the new live uniqueness contract against this owned loopback runtime', async () => {
      const ep = await endpoint();
      const address = (app.getHttpServer() as Server).address();
      if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
      const { stdout } = await promisify(execFile)('pwsh', [
        '-NoProfile', '-File', join(__dirname, '..', '..', '..', 'scripts', 'live-atomic-uniqueness.ps1'),
        '-EndpointUrl', `http://127.0.0.1:${address.port}/scim/v2/endpoints/${ep}`,
      ], { env: { ...process.env, E2E_TOKEN: getLegacyToken() } });
      expect(stdout).toContain('atomic uniqueness live contract: 21 assertions passed');
    });
    it('Group member uniqueness commits with scalars and members in the real repository', async () => {
      const ep = await endpoint();
      const policy = compileUniquenessPolicy([{ id: GROUP, isCoreSchema: true, attributes: [{
        name: 'members', type: 'complex', multiValued: true, required: false, subAttributes: [{
          name: 'value', type: 'string', multiValued: false, required: false, uniqueness: 'server',
        }],
      }] }]);
      const input = () => ({ endpointId: ep, scimId: randomUUID(), displayName: randomUUID(), externalId: null, rawPayload: '{}', meta: '{}' });
      const member = { userId: null, value: randomUUID(), type: null, display: null };
      const result = await Promise.allSettled([groups.create(input(), [member], policy), groups.create(input(), [member], policy)]);
      expect(result.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const second = await groups.create(input(), [], policy);
      await expect(groups.updateGroupWithMembers(second.id, { displayName: 'loser' }, [member], 1, policy)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(groups.addMembers(second.id, [member], policy)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await groups.findWithMembers(ep, second.scimId)).toMatchObject({ version: 1, displayName: second.displayName, members: [] });
      expect((await groups.findAllWithMembers(ep)).filter((r) => r.members.some((m) => m.value === member.value))).toHaveLength(1);
    });
    const pgOnly = process.env.PERSISTENCE_BACKEND === 'prisma' ? it : it.skip;
    pgOnly('two application instances with independent pools cannot own the same value', async () => {
      const ep = await endpoint();
      const other = await createTestApp();
      const peer = other.get<IGenericResourceRepository>('GENERIC_RESOURCE_REPOSITORY');
      const originalA = generic.create.bind(generic);
      const originalB = peer.create.bind(peer);
      let count = 0;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => { release = resolve; });
      const timer = setTimeout(release, 5000);
      const wait = async () => { if (++count === 2) release(); await ready; };
      const a = jest.spyOn(generic, 'create').mockImplementation(async (...args) => { await wait(); return originalA(...args); });
      const b = jest.spyOn(peer, 'create').mockImplementation(async (...args) => { await wait(); return originalB(...args); });
      try {
        const result = await Promise.all([
          http('post', base(ep, 'Devices'), body('Devices', { badge: 'replica' })),
          request(other.getHttpServer() as Server).post(base(ep, 'Devices'))
            .set('Authorization', `Bearer ${getLegacyToken()}`).set('Content-Type', 'application/scim+json')
            .send(body('Devices', { badge: 'REPLICA' })) as unknown as Promise<Response>,
        ]);
        expect(count).toBe(2);
        expect(result.map((r) => r.status).sort()).toEqual([201, 409]);
        conflict(result.find((r) => r.status === 409)!);
        expect(await generic.findAll(ep, 'Device')).toHaveLength(1);
      } finally {
        clearTimeout(timer); a.mockRestore(); b.mockRestore(); await other.close();
      }
    });
  for (const route of routes) {
    it(`${route}: extension members.$ref is represented and is not a builtin Group exclusion`, async () => {
      const ep = await endpoint();
      const extension = { members: [{ $ref: 'https://example.com/member' }] };
      const first = await http('post', base(ep, route), body(route, extension));
      expect(first.status).toBe(201);
      expect(first.body[EXT]).toMatchObject(extension);
      conflict(await http('post', base(ep, route), body(route, extension)));
      expect(await rows(ep, route)).toHaveLength(1);
    });
    it.each([
      { value: 'free', VALUE: 'taken' },
      { VALUE: 'taken', value: 'free' },
    ])(`${route}: refuses ambiguous case aliases before persistence %j`, async (item) => {
      const ep = await endpoint();
      expect((await http('post', base(ep, route), body(route, { codes: [{ value: 'taken' }] }))).status).toBe(201);
      const res = await http('post', base(ep, route), body(route, { codes: [item] }));
      expect(res.status).toBe(400);
      expect(res.body.scimType).toBe('invalidValue');
      expect(await rows(ep, route)).toHaveLength(1);
    });
    it(`${route}: removal releases a value and self writes do not consume another owner`, async () => {
      const ep = await endpoint();
      const first = await http('post', base(ep, route), body(route, { badge: 'owned' }));
      expect(first.status).toBe(201);
      expect((await http('patch', `${base(ep, route)}/${first.body.id}`, {
        schemas: [PATCH], Operations: [{ op: 'remove', path: `${EXT}:badge` }],
      })).status).toBe(200);
      expect((await http('post', base(ep, route), body(route, { badge: 'owned' }))).status).toBe(201);
      expect((await rows(ep, route)).filter((r) => (JSON.parse(r.rawPayload) as Record<string, Record<string, unknown>>)[EXT]?.badge != null)).toHaveLength(1);
    });
    for (const verb of ['post', 'put', 'patch'] as const) {
      for (const [attribute, value] of [
        ['badge', 'SAME'], ['aliases', ['same', 'other']],
        ['codes', [{ value: 'same' }]], ['displayName', 'same'],
      ] as const) {
        it(`${route} ${verb}: two DIFFERENT resources compete for ${attribute}`, async () => {
          const ep = await endpoint();
          const initial = verb === 'post' ? [] : await Promise.all([0, 1].map(() => http('post', base(ep, route), body(route, {}))));
          initial.forEach((res) => expect(res.status).toBe(201));
          const result = await compete(route, verb, () => Promise.all([0, 1].map((index) => {
            const url = verb === 'post' ? base(ep, route) : `${base(ep, route)}/${initial[index].body.id}`;
            const data = verb === 'patch' ? {
              schemas: [PATCH], Operations: [{ op: 'add', path: `${EXT}:${attribute}`, value }],
            } : body(route, { [attribute]: value });
            return http(verb, url, data);
          })));
          expect(result.map((res) => res.status).sort()).toEqual([verb === 'post' ? 201 : 200, 409]);
          conflict(result.find((res) => res.status === 409)!);
          const stored = await rows(ep, route);
          const owners = stored.filter((r) => (JSON.parse(r.rawPayload) as Record<string, Record<string, unknown>>)[EXT]?.[attribute] != null);
          expect(owners).toHaveLength(1);
          expect(stored).toHaveLength(verb === 'post' ? 1 : 2);
          expect(stored.map((r) => r.version).sort()).toEqual(verb === 'post' ? [1] : [1, 2]);
        });
      }
      it(`${route} ${verb}: promoted name has one owner`, async () => {
        const ep = await endpoint();
        const initial = verb === 'post' ? [] : await Promise.all([0, 1].map(() => http('post', base(ep, route), body(route, {}))));
        initial.forEach((res) => expect(res.status).toBe(201));
        const name = `claimed-${randomUUID()}`;
        const result = await compete(route, verb, () => Promise.all([0, 1].map((index) =>
          http(verb, verb === 'post' ? base(ep, route) : `${base(ep, route)}/${initial[index].body.id}`,
            verb === 'patch' ? { schemas: [PATCH], Operations: [
              { op: 'replace', path: route === 'Users' ? 'userName' : 'displayName', value: name },
            ] } : body(route, {}, name)))));
        expect(result.map((r) => r.status).sort()).toEqual([verb === 'post' ? 201 : 200, 409]);
        conflict(result.find((r) => r.status === 409)!);
        const stored = await rows(ep, route);
        expect(stored.filter((r) => ('userName' in r ? r.userName : r.displayName) === name)).toHaveLength(1);
      });
    }
    it(`${route}: none/default, absent/null, caseExact and self updates preserve semantics`, async () => {
      const ep = await endpoint();
      const a = await http('post', base(ep, route), body(route, { exact: 'ABC', free: 'shared', defaultFree: 'shared', badge: null }));
      const b = await http('post', base(ep, route), body(route, { exact: 'abc', free: 'shared', defaultFree: 'shared' }));
      expect([a.status, b.status]).toEqual([201, 201]);
      const update = await http('patch', `${base(ep, route)}/${a.body.id}`, {
        schemas: [PATCH], Operations: [{ op: 'replace', path: `${EXT}:exact`, value: 'ABC' }],
      });
      expect(update.status).toBe(200);
      expect(update.body.meta.version).not.toBe(a.body.meta.version);
      conflict(await http('post', base(ep, route), body(route, { exact: 'ABC' })));
      expect((await rows(ep, route)).length).toBe(2);
    });
  }
  it('namespaces isolate endpoints and resource types', async () => {
    const a = await endpoint();
    const b = await endpoint();
    for (const ep of [a, b]) for (const route of routes) {
      expect((await http('post', base(ep, route), body(route, { badge: 'shared' }, 'shared'))).status).toBe(201);
    }
  });
  for (const attribute of ['displayName', 'externalId']) for (const definition of [
    { type: 'integer', multiValued: false },
    { type: 'string', multiValued: true },
  ]) {
    for (const verb of ['post', 'put', 'patch'] as const) {
      it(`custom core ${attribute} ${definition.type} MV=${definition.multiValued}: competing ${verb} follows payload, not the column`, async () => {
        const field = { ...definition, uniqueness: 'server' };
        const ep = attribute === 'displayName' ? await endpoint(field)
          : await endpoint({ type: 'string' }, [{ name: attribute, ...field }]);
        const value = definition.multiValued ? ['shared', 'other'] : 42;
        const valueBody = (value: unknown) => ({ schemas: [DEVICE, EXT], displayName: randomUUID(), [attribute]: value, [EXT]: {} });
        const initial = verb === 'post' ? [] : await Promise.all([0, 1].map((i) =>
          http('post', base(ep, 'Devices'), valueBody(definition.multiValued ? [`initial-${i}`] : i))));
        initial.forEach((r) => expect(r.status).toBe(201));
        for (const r of initial) {
          const read = await http('get', `${base(ep, 'Devices')}/${r.body.id}`);
          expect(read.status).toBe(200);
          expect(read.body[attribute]).toEqual(r.body[attribute]);
        }
        const result = await compete('Devices', verb, () => Promise.all([0, 1].map((i) =>
          http(verb, verb === 'post' ? base(ep, 'Devices') : `${base(ep, 'Devices')}/${initial[i].body.id}`,
            verb === 'patch' ? { schemas: [PATCH], Operations: [{ op: 'replace', path: attribute, value }] }
              : valueBody(value)))));
        expect(result.map((r) => r.status).sort()).toEqual([verb === 'post' ? 201 : 200, 409]);
        conflict(result.find((r) => r.status === 409)!);
        const winner = result.find((r) => r.status !== 409)!;
        expect(winner.body[attribute]).toEqual(value);
        const read = await http('get', `${base(ep, 'Devices')}/${winner.body.id}`);
        expect(read.status).toBe(200);
        expect(read.body[attribute]).toEqual(value);
        const stored = await rows(ep, 'Devices');
        expect(stored.filter((r) => JSON.stringify((JSON.parse(r.rawPayload) as Record<string, unknown>)[attribute]) === JSON.stringify(value))).toHaveLength(1);
        expect(stored.map((r) => r.version).sort()).toEqual(verb === 'post' ? [1] : [1, 2]);
      });
    }
    it(`custom core ${attribute} ${definition.type} MV=${definition.multiValued}: none permits repeated values`, async () => {
      const field = { ...definition, uniqueness: 'none' };
      const ep = attribute === 'displayName' ? await endpoint(field)
        : await endpoint({ type: 'string' }, [{ name: attribute, ...field }]);
      const value = definition.multiValued ? ['shared'] : 42;
      for (const _owner of [0, 1]) {
        const res = await http('post', base(ep, 'Devices'), { schemas: [DEVICE, EXT], displayName: randomUUID(), [attribute]: value, [EXT]: {} });
        expect(res.status).toBe(201);
        expect(res.body[attribute]).toEqual(value);
      }
    });
  }
  it.each(['displayName', 'externalId'])('custom immutable numeric %s preserves the public payload during self replacement', async (attribute) => {
    const field = { type: 'integer', uniqueness: 'server', mutability: 'immutable' };
    const ep = attribute === 'displayName' ? await endpoint(field)
      : await endpoint({ type: 'string' }, [{ name: attribute, ...field }]);
    const original = { schemas: [DEVICE, EXT], displayName: 'unchanged', [attribute]: 42, [EXT]: {} };
    const created = await http('post', base(ep, 'Devices'), original);
    expect(created.status).toBe(201);
    const replaced = await http('put', `${base(ep, 'Devices')}/${created.body.id}`, original);
    expect(replaced.status).toBe(200);
    expect(replaced.body[attribute]).toBe(42);
    const read = await http('get', `${base(ep, 'Devices')}/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body[attribute]).toBe(42);
    const changed = await http('put', `${base(ep, 'Devices')}/${created.body.id}`, { ...original, [attribute]: 43 });
    expect(changed.status).toBe(400);
    expect(changed.body.scimType).toBe('mutability');
    expect((await rows(ep, 'Devices'))[0].version).toBe(2);
  });
  it.each(['active', 'userName'])('custom core %s is a typed payload value, not a builtin column policy', async (attribute) => {
    const ep = await endpoint({ type: 'string' }, [{ name: attribute, type: 'integer', uniqueness: 'server' }]);
    const result = await compete('Devices', 'post', () => Promise.all([0, 1].map(() =>
      http('post', base(ep, 'Devices'), { ...body('Devices', {}), [attribute]: 42 }))));
    expect(result.map((r) => r.status).sort()).toEqual([201, 409]);
    conflict(result.find((r) => r.status === 409)!);
    expect(result.find((r) => r.status === 201)!.body[attribute]).toBe(42);
    expect((JSON.parse((await rows(ep, 'Devices'))[0].rawPayload) as Record<string, unknown>)[attribute]).toBe(42);
  });
  it.each([
    ['number', 4, 4.0],
    ['reference', 'https://example.com/Resource', 'https://example.com/Resource'],
  ])('typed equality for %s', async (attribute, first, second) => {
    const ep = await endpoint();
    expect((await http('post', base(ep, 'Devices'), body('Devices', { [attribute]: first }))).status).toBe(201);
    conflict(await http('post', base(ep, 'Devices'), body('Devices', { [attribute]: second })));
  });
  it('reference uniqueness is case exact by type, without needing a caseExact declaration', async () => {
    const ep = await endpoint();
    for (const reference of ['https://example.com/Resource', 'https://example.com/resource']) {
      expect((await http('post', base(ep, 'Devices'), body('Devices', { reference }))).status).toBe(201);
    }
    expect(await rows(ep, 'Devices')).toHaveLength(2);
  });
  it.each([
    ['enabled', false], ['instant', '2026-09-28T12:00:00Z'], ['binary', 'YQ=='],
  ])('%s is a non-unique type, not a missing equality implementation', async (attribute, value) => {
    const ep = await endpoint();
    for (const _owner of [0, 1]) {
      expect((await http('post', base(ep, 'Devices'), body('Devices', { [attribute]: value }))).status).toBe(201);
    }
    expect(await rows(ep, 'Devices')).toHaveLength(2);
  });
});
