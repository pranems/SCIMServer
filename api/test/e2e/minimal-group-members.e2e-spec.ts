import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimGet, scimPut, scimPatch, scimDelete } from './helpers/request.helper';
import { minimalGroupMembersProfile, minimalGroupUrn, minimalUserUrn } from '../helpers/minimal-group-members.fixture';

const patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
interface GroupResponse {
  id: string;
  members: Array<{ value: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

describe('Minimal imported Group membership schema', () => {
  let app: INestApplication;
  let token: string;
  let endpoint: string;
  let base: string;
  let users: string[];

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(async () => {
    const result = await scimPost(app, '/scim/admin/endpoints', token, {
      name: `minimal-members-${randomUUID()}`, profile: minimalGroupMembersProfile(),
    }).expect(201);
    endpoint = (result.body as { id: string }).id;
    base = `/scim/endpoints/${endpoint}`;
    users = [];
    for (let i = 0; i < 3; i++) {
      const user = await scimPost(app, `${base}/Users`, token, {
        schemas: [minimalUserUrn], userName: `member-${randomUUID()}@example.test`,
      }).expect(201);
      users.push((user.body as { id: string }).id);
    }
  });
  afterEach(async () => {
    if (endpoint) await scimDelete(app, `/scim/admin/endpoints/${endpoint}`, token).expect(204);
  });

  function body(values: string[] = []) {
    return { schemas: [minimalGroupUrn], displayName: `group-${randomUUID()}`, members: values.map(value => ({ value })) };
  }
  async function create(values: string[] = []) {
    const response = await scimPost(app, `${base}/Groups`, token, body(values)).expect(201);
    return `${base}/Groups/${(response.body as { id: string }).id}`;
  }
  async function readMembers(url: string, values: string[]) {
    const response = await scimGet(app, url, token).expect(200);
    const resource = response.body as GroupResponse;
    expect(resource.members.map(member => member.value).sort()).toEqual([...values].sort());
    for (const member of resource.members) {
      for (const key of Object.keys(member)) expect(['value', '$ref']).toContain(key);
    }
    for (const key of Object.keys(resource)) {
      expect(['schemas', 'id', 'displayName', 'externalId', 'members', 'meta']).toContain(key);
    }
    return resource;
  }
  function patch(url: string, Operations: object[]) {
    return scimPatch(app, url, token, { schemas: [patchUrn], Operations });
  }
  async function settings(values: Record<string, boolean>) {
    await scimPatch(app, `/scim/admin/endpoints/${endpoint}`, token, { profile: { settings: values } }).expect(200);
  }

  it('creates populated Groups and deduplicates value-only members', async () => {
    const url = await create([users[0], users[0], users[1]]);
    await readMembers(url, users.slice(0, 2));
  });
  for (const populated of [false, true]) {
    it(`replaces members on a populated=${populated} Group through PUT`, async () => {
      const url = await create(populated ? [users[0]] : []);
      await scimPut(app, url, token, body([users[1], users[2]])).expect(200);
      await readMembers(url, users.slice(1));
    });
    it(`adds, replaces and removes members in order on populated=${populated} Group`, async () => {
      const url = await create(populated ? [users[0]] : []);
      await patch(url, [{ op: 'add', path: 'members', value: [{ value: users[0] }, { value: users[1] }] }]).expect(200);
      await readMembers(url, users.slice(0, 2));
      await patch(url, [{ op: 'replace', path: 'members', value: [{ value: users[2] }] }]).expect(200);
      await readMembers(url, [users[2]]);
      await patch(url, [{ op: 'remove', path: `members[value eq "${users[2]}"]` }]).expect(200);
      await readMembers(url, []);
    });
  }
  it('preserves idempotent duplicate PATCH add and filtered remove', async () => {
    const url = await create([users[0]]);
    await patch(url, [{ op: 'add', path: 'members', value: [{ value: users[0] }, { value: users[0] }] }]).expect(200);
    await readMembers(url, [users[0]]);
    await patch(url, [{ op: 'remove', path: `members[value eq "${users[1]}"]` }]).expect(200);
    await readMembers(url, [users[0]]);
  });
  it('applies multi-member and remove-all policies without partial writes', async () => {
    const url = await create([users[0]]);
    await settings({
      MultiMemberPatchOpForGroupEnabled: false,
      PatchOpAllowRemoveAllMembers: false,
    });
    const before = await readMembers(url, [users[0]]);
    for (const operation of [
      { op: 'add', path: 'members', value: users.slice(1).map(value => ({ value })) },
      { op: 'remove', path: 'members', value: users.slice(0, 2).map(value => ({ value })) },
      { op: 'remove', path: 'members' },
    ]) {
      await patch(url, [{ op: 'replace', path: 'displayName', value: 'must-rollback' }, operation]).expect(400);
      expect(await readMembers(url, [users[0]])).toEqual(before);
    }
    await settings({
      MultiMemberPatchOpForGroupEnabled: true,
      PatchOpAllowRemoveAllMembers: true,
    });
    await patch(url, [{ op: 'add', path: 'members', value: users.slice(1).map(value => ({ value })) }]).expect(200);
    await readMembers(url, users);
    await patch(url, [{ op: 'remove', path: 'members', value: users.slice(0, 2).map(value => ({ value })) }]).expect(200);
    await readMembers(url, [users[2]]);
    await patch(url, [{ op: 'remove', path: 'members' }]).expect(200);
    await readMembers(url, []);
  });
  for (const field of ['display', 'type', 'unknown']) {
    it(`rejects genuinely supplied ${field} through POST, PUT and PATCH without changing existing state`, async () => {
      const url = await create([users[0]]);
      const before = await readMembers(url, [users[0]]);
      const invalid = { ...body(), members: [{ value: users[1], [field]: 'undeclared' }] };
      for (const [method, response] of [
        ['POST', await scimPost(app, `${base}/Groups`, token, invalid)],
        ['PUT', await scimPut(app, url, token, invalid)],
        ['PATCH', await patch(url, [{ op: 'replace', path: 'displayName', value: 'must-rollback' },
          { op: 'add', path: 'members', value: invalid.members }])],
      ] as const) {
        expect({ method, status: response.status }).toMatchObject({ method, status: 400 });
        expect((response.body as { scimType: string }).scimType).toBe('invalidSyntax');
      }
      expect(await readMembers(url, [users[0]])).toEqual(before);
    });
  }
});
