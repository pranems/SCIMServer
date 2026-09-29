import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import request from 'supertest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createTestApp } from './helpers/app.helper';
import { getLegacyToken } from './helpers/auth.helper';
import type { IGroupRepository } from '../../src/domain/repositories/group.repository.interface';
import type { IUserRepository } from '../../src/domain/repositories/user.repository.interface';
import type { GroupCreateInput, MemberCreateInput } from '../../src/domain/models/group.model';
import { SCIM_EVENTS } from '../../src/modules/stats/scim-events';
import { wrapPrismaError } from '../../src/infrastructure/repositories/prisma/prisma-error.util';

const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const member = (value: string): MemberCreateInput => ({ value, userId: null, type: 'User', display: value });

describe('Group aggregate HTTP and persistence contract', () => {
  let app: INestApplication;
  let groups: IGroupRepository;
  let users: IUserRepository;
  let endpointId: string;
  const http = (verb: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: object, etag?: string) => {
    const req = request(app.getHttpServer() as Server)[verb](url)
      .set('Authorization', `Bearer ${getLegacyToken()}`)
      .set('Content-Type', 'application/scim+json');
    if (etag) req.set('If-Match', etag);
    return body ? req.send(body) : req;
  };
  const base = () => `/scim/v2/endpoints/${endpointId}`;
  const body = (name = `group-${randomUUID()}`, members: { value: string }[] = [{ value: randomUUID() }]) => ({
    schemas: [GROUP], displayName: name, externalId: 'original', members,
  });
  async function stored() { return groups.findAllWithMembers(endpointId); }
  function errorContract(res: request.Response, status: number) {
    expect(res.status).toBe(status);
    const data = res.body as Record<string, unknown>;
    expect(data.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(String(data.status)).toBe(String(status));
    expect(typeof data.detail).toBe('string');
    for (const key of Object.keys(data))
      expect(['schemas', 'status', 'detail', 'scimType', 'urn:scimserver:api:messages:2.0:Diagnostics']).toContain(key);
    expect(JSON.stringify(data)).not.toMatch(/P2002|PrismaClient|"stack"|injected member failure|member lookup unavailable/);
  }
  beforeAll(async () => {
    app = await createTestApp();
    const server = app.getHttpServer() as Server;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    groups = app.get('GROUP_REPOSITORY');
    users = app.get('USER_REPOSITORY');
    expect(groups.constructor.name).toBe(process.env.PERSISTENCE_BACKEND === 'inmemory'
      ? 'InMemoryGroupRepository' : 'PrismaGroupRepository');
    expect((await http('get', '/scim/health')).status).toBe(200);
  });
  beforeEach(async () => {
    const endpoint = await http('post', '/scim/admin/endpoints', {
      name: `group-aggregate-${randomUUID()}`,
      profile: {
        schemas: [{ id: USER, name: 'User', attributes: 'all' }, { id: GROUP, name: 'Group', attributes: 'all' }],
        resourceTypes: ['User', 'Group'].map((name) => ({
          id: name, name, endpoint: `/${name}s`, schema: name === 'User' ? USER : GROUP, schemaExtensions: [],
        })),
        settings: { StrictSchemaValidation: true, logFileEnabled: false },
        serviceProviderConfig: { patch: { supported: true }, etag: { supported: true } },
      },
    });
    expect(endpoint.status).toBe(201);
    endpointId = String((endpoint.body as { id: string }).id);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const group of await stored()) await groups.delete(group.id);
    expect((await http('delete', `/scim/admin/endpoints/${endpointId}`)).status).toBe(204);
  });
  afterAll(async () => { await app?.close(); });

  it('resolves initial members before any Group write and emits no success on failure', async () => {
    const events = jest.spyOn(app.get(EventEmitter2), 'emit');
    jest.spyOn(users, 'findByScimIds').mockRejectedValueOnce(new Error('member lookup unavailable'));
    const result = await http('post', `${base()}/Groups`, body());
    errorContract(result, 500);
    expect(await stored()).toEqual([]);
    expect(events.mock.calls.some(([name]) => name === SCIM_EVENTS.GROUP_CREATED)).toBe(false);
  });

  it.each([
    ['injected private member failure', 500],
    ['connect refused at private database host', 503],
  ] as const)('sanitizes the mapped repository failure: %s', async (message, status) => {
    jest.spyOn(groups, 'create').mockRejectedValueOnce(
      wrapPrismaError(new Error(message), 'Group.create(private-row-id)'),
    );
    const result = await http('post', `${base()}/Groups`, body());
    errorContract(result, status);
    const responseBody = result.body as Record<string, unknown>;
    expect(responseBody.detail).toBe('Failed to create group.');
    expect(JSON.stringify(responseBody)).not.toMatch(/private|injected/);
    expect(await stored()).toEqual([]);
  });

  for (const failure of ['duplicate', 'injected'] as const) {
    it(`POST ${failure} initial membership failure leaves no Group and can be retried`, async () => {
      const original = groups.create.bind(groups);
      const events = jest.spyOn(app.get(EventEmitter2), 'emit');
      const payload = body();
      const spy = jest.spyOn(groups, 'create').mockImplementationOnce(async (data: GroupCreateInput, members: MemberCreateInput[] = []) => {
        const first = members?.[0] ?? member('first');
        const last = { ...first };
        if (failure === 'injected')
          Object.defineProperty(last, 'display', { get: () => { throw new Error('injected member failure'); } });
        return original(data, [first, last]);
      });
      const result = await http('post', `${base()}/Groups`, payload);
      errorContract(result, failure === 'duplicate' ? 409 : 500);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await stored()).toEqual([]);
      expect(events.mock.calls.some(([name]) => name === SCIM_EVENTS.GROUP_CREATED)).toBe(false);
      spy.mockRestore();
      const retry = await http('post', `${base()}/Groups`, payload);
      expect(retry.status).toBe(201);
      expect(await stored()).toHaveLength(1);
      expect((await stored())[0]).toMatchObject({ version: 1, displayName: payload.displayName });
      expect((await stored())[0].members.map((m) => m.value)).toEqual(payload.members.map((m) => m.value));
    });
  }

  for (const verb of ['put', 'patch'] as const) {
    for (const failure of ['duplicate', 'injected'] as const) {
      it(`${verb.toUpperCase()} ${failure} failure preserves fields, payload, version, timestamps and member row ids`, async () => {
        const created = await http('post', `${base()}/Groups`, body());
        expect(created.status).toBe(201);
        const before = (await stored())[0];
        const original = groups.updateGroupWithMembers.bind(groups);
        jest.spyOn(groups, 'updateGroupWithMembers').mockImplementationOnce(async (id, data, members, version) => {
          const first = members[0];
          const last = { ...first };
          if (failure === 'injected')
            Object.defineProperty(last, 'display', { get: () => { throw new Error('injected member failure'); } });
          return original(id, data, [first, last], version);
        });
        const replacement = body('changed');
        const payload = verb === 'put' ? replacement : {
          schemas: [PATCH],
          Operations: [
            { op: 'replace', path: 'displayName', value: 'changed' },
            { op: 'replace', path: 'externalId', value: 'changed' },
            { op: 'replace', path: 'members', value: replacement.members },
          ],
        };
        const result = await http(verb, `${base()}/Groups/${before.scimId}`, payload, 'W/"v1"');
        errorContract(result, failure === 'duplicate' ? 409 : 500);
        expect((await stored())[0]).toEqual(before);
        const read = await http('get', `${base()}/Groups/${before.scimId}`);
        expect(read.status).toBe(200);
        expect(read.body).toEqual(created.body);
      });
    }
  }

  it('one scoped SCIM id wins concurrent aggregate creation without losing-writer members', async () => {
    const input: GroupCreateInput = {
      endpointId, scimId: randomUUID(), externalId: null, displayName: 'same-id',
      rawPayload: '{}', meta: '{}',
    };
    const outcomes = await Promise.allSettled([
      groups.create(input, [member('first')]),
      groups.create(input, [member('second')]),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].members.map((m) => m.value)).toEqual([outcomes[0].status === 'fulfilled' ? 'first' : 'second']);
  });

  (process.env.PERSISTENCE_BACKEND === 'prisma' ? it : it.skip)('native foreign-key failure rolls back Group creation in PostgreSQL', async () => {
    const input: GroupCreateInput = {
      endpointId, scimId: randomUUID(), externalId: null, displayName: 'invalid-reference',
      rawPayload: '{}', meta: '{}',
    };
    await expect(groups.create(input, [
      member('valid-first'), { ...member('missing-reference'), userId: randomUUID() },
    ])).rejects.toMatchObject({ isRepositoryError: true });
    expect(await stored()).toEqual([]);
  });

  it('a failed conditional aggregate writer cannot consume the version or corrupt a concurrent winner', async () => {
    const created = await http('post', `${base()}/Groups`, body());
    expect(created.status).toBe(201);
    const before = (await stored())[0];
    const outcomes = await Promise.allSettled([
      groups.updateGroupWithMembers(before.id, {
        displayName: 'loser', rawPayload: '{"description":"loser"}', externalId: 'loser',
      }, [member('duplicate'), member('duplicate')], 1),
      groups.updateGroupWithMembers(before.id, {
        displayName: 'winner', rawPayload: '{"description":"winner"}', externalId: 'winner',
      }, [member('winner')], 1),
    ]);
    expect(outcomes[0].status).toBe('rejected');
    expect(outcomes[1].status).toBe('fulfilled');
    const rejected = outcomes[0] as PromiseRejectedResult;
    expect(['CONFLICT', 'PRECONDITION_FAILED']).toContain((rejected.reason as { code: string }).code);
    const after = (await stored())[0];
    expect(after).toMatchObject({
      displayName: 'winner', externalId: 'winner', version: 2,
    });
    expect(JSON.parse(after.rawPayload)).toEqual({ description: 'winner' });
    expect(after.members.map((m) => m.value)).toEqual(['winner']);
  });

  it('keeps public duplicate-member deduplication and resolves local/external members in one create', async () => {
    const user = await http('post', `${base()}/Users`, {
      schemas: [USER], userName: `aggregate-user-${randomUUID()}`,
    });
    expect(user.status).toBe(201);
    const id = String((user.body as { id: string }).id);
    try {
      const local = await users.findByScimId(endpointId, id);
      const external = randomUUID();
      const created = await http('post', `${base()}/Groups`, body(undefined, [
        { value: id }, { value: external }, { value: id },
      ]));
      expect(created.status).toBe(201);
      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0].version).toBe(1);
      expect(rows[0].members.map((m) => ({ value: m.value, userId: m.userId })).sort((a, b) => a.value.localeCompare(b.value)))
        .toEqual([{ value: id, userId: local?.id }, { value: external, userId: null }].sort((a, b) => a.value.localeCompare(b.value)));
    } finally {
      expect((await http('delete', `${base()}/Users/${id}`)).status).toBe(204);
    }
  });

  it('reusable live smoke runs on the owned loopback runtime', async () => {
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') throw new Error('Expected owned loopback listener');
    const { stdout } = await promisify(execFile)('pwsh', [
      '-NoProfile', '-File', join(__dirname, '..', '..', '..', 'scripts', 'live-group-aggregate.ps1'),
      '-EndpointUrl', `http://127.0.0.1:${address.port}${base()}`,
    ], { env: { ...process.env, E2E_TOKEN: getLegacyToken() } });
    if (process.env.PG_ANALYSIS_OUTPUT)
      writeFileSync(join(process.env.PG_ANALYSIS_OUTPUT, `${process.env.PERSISTENCE_BACKEND}-group-live.log`), stdout);
    expect(stdout).toContain('group aggregate live contract: 69 assertions passed');
  });
});
