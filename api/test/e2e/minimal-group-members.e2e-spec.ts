import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimGet, scimPut, scimPatch, scimDelete } from './helpers/request.helper';
import { minimalGroupMembersProfile, minimalGroupUrn, minimalUserUrn } from '../helpers/minimal-group-members.fixture';
import {
  SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN, assertErrorResponseShape,
  assertListResponseShape, assertAllowedKeys,
} from './helpers/contract-assertions';

interface MemberErrorResponse {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function assertMemberError(response: MemberErrorResponse, scimType: string, diagnostics: Record<string, unknown>) {
  expect(response.status).toBe(400);
  expect(response.headers['content-type']).toMatch(/^application\/scim\+json(?:;|$)/i);
  assertErrorResponseShape(response.body);
  expect(Array.isArray(response.body.schemas)).toBe(true);
  expect(response.body.status).toBe('400');
  expect(response.body.detail).not.toBe('');
  expect(response.body.scimType).toBe(scimType);
  expect(response.body[SCIM_DIAGNOSTICS_URN]).toEqual(expect.objectContaining(diagnostics));
}

const patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const groupResponseKeys = ['schemas', 'id', 'displayName', 'externalId', 'members', 'meta'];
interface GroupResponse {
  id: string;
  members: Array<{ value: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
interface GroupListResponse {
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: GroupResponse[];
  [key: string]: unknown;
}

describe('Minimal Group error-contract oracle', () => {
  const diagnostics = {
    errorCode: 'VALIDATION_SCHEMA', triggeredBy: 'StrictSchemaValidation',
    attributePath: 'members[0].display', attributePaths: ['members[0].display'],
    activeConfig: { StrictSchemaValidation: true },
  };
  function validResponse(): MemberErrorResponse {
    return {
      status: 400, headers: { 'content-type': 'application/scim+json; charset=utf-8' },
      body: {
        schemas: [SCIM_ERROR_SCHEMA], status: '400', detail: 'Unknown member attribute',
        scimType: 'invalidSyntax', [SCIM_DIAGNOSTICS_URN]: structuredClone(diagnostics),
      },
    };
  }
  const mutations: Array<[string, (response: MemberErrorResponse) => void]> = [
    ['HTTP status', response => { response.status = 503; }],
    ['media type', response => { response.headers['content-type'] = 'application/json'; }],
    ['schemas', response => { response.body.schemas = []; }],
    ['body status', response => { response.body.status = 400; }],
    ['detail', response => { response.body.detail = null; }],
    ['extra response key', response => { response.body._rawPayload = {}; }],
    ['scimType', response => { response.body.scimType = 'invalidValue'; }],
    ...(['errorCode', 'triggeredBy', 'attributePath', 'attributePaths', 'activeConfig'] as const)
      .map((key): [string, (response: MemberErrorResponse) => void] =>
        [key, response => { response.body[SCIM_DIAGNOSTICS_URN] = { ...diagnostics, [key]: 'incorrect' }; }]),
  ];
  it('accepts the complete valid rejection contract', () => {
    expect(() => assertMemberError(validResponse(), 'invalidSyntax', diagnostics)).not.toThrow();
  });
  it.each(mutations)('rejects a corrupted %s', (_name, mutate) => {
    const response = validResponse();
    mutate(response);
    expect(() => assertMemberError(response, 'invalidSyntax', diagnostics)).toThrow();
  });
});

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
    assertAllowedKeys(resource, groupResponseKeys, 'MinimalGroup');
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
  it('round-trips an accepted member reference through POST, GET, list and search', async () => {
    const member = { value: users[0], $ref: `https://scim.example.test/Users/${users[0]}` };
    const response = await scimPost(app, `${base}/Groups`, token, { ...body(), members: [member] }).expect(201);
    expect((response.body as GroupResponse).members).toEqual([member]);
    const url = `${base}/Groups/${(response.body as GroupResponse).id}`;
    expect((await readMembers(url, [users[0]])).members).toEqual([member]);
    const list = await scimGet(app, `${base}/Groups`, token).expect(200);
    const listBody = list.body as GroupListResponse;
    assertListResponseShape(listBody);
    expect(listBody).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1 });
    expect(listBody.Resources).toHaveLength(1);
    assertAllowedKeys(listBody.Resources[0], groupResponseKeys, 'MinimalGroupListResource');
    expect(listBody.Resources[0].members).toEqual([member]);
    const search = await scimPost(app, `${base}/Groups/.search`, token, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
      attributes: ['members.$ref'],
    }).expect(200);
    const searchBody = search.body as GroupListResponse;
    assertListResponseShape(searchBody);
    expect(searchBody).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1 });
    expect(searchBody.Resources).toHaveLength(1);
    assertAllowedKeys(searchBody.Resources[0], groupResponseKeys, 'MinimalGroupSearchResource');
    expect(searchBody.Resources[0].members).toEqual([{ $ref: member.$ref }]);
  });
  for (const populated of [false, true]) {
    it(`preserves exact references through PUT and ordered PATCH on populated=${populated}`, async () => {
      const url = await create(populated ? [users[0]] : []);
      const first = { value: users[1], $ref: `https://scim.example.test/Users/${users[1]}` };
      const second = { value: users[2], $ref: `https://scim.example.test/Users/${users[2]}?source=import` };
      await scimPut(app, url, token, { ...body(), members: [first] }).expect(200);
      expect((await readMembers(url, [users[1]])).members).toEqual([first]);
      await patch(url, [
        { op: 'add', path: 'members', value: [second, second] },
        { op: 'replace', path: 'displayName', value: 'reference-preserved' },
      ]).expect(200);
      expect((await readMembers(url, users.slice(1))).members).toEqual([first, second]);
      await patch(url, [{ op: 'remove', path: `members[value eq "${users[1]}"]` }]).expect(200);
      expect((await readMembers(url, [users[2]])).members).toEqual([second]);
      await patch(url, [{ op: 'replace', path: 'members', value: [first] }]).expect(200);
      expect((await readMembers(url, [users[1]])).members).toEqual([first]);
    });
  }
  it('keeps references when unrelated members are added and does not synthesize missing references', async () => {
    const url = await create([users[0]]);
    const member = { value: users[1], $ref: `https://scim.example.test/Users/${users[1]}` };
    await patch(url, [{ op: 'add', value: { members: [member] } }]).expect(200);
    expect((await readMembers(url, users.slice(0, 2))).members).toEqual([{ value: users[0] }, member]);
    await patch(url, [{ op: 'replace', value: { displayName: 'retained-on-no-path' } }]).expect(200);
    expect((await readMembers(url, users.slice(0, 2))).members).toEqual([{ value: users[0] }, member]);
  });
  it('rejects immutable reference replacement with exact unchanged persisted state', async () => {
    const member = { value: users[0], $ref: `https://scim.example.test/Users/${users[0]}` };
    const response = await scimPost(app, `${base}/Groups`, token, { ...body(), members: [member] }).expect(201);
    const url = `${base}/Groups/${(response.body as GroupResponse).id}`;
    const before = await readMembers(url, [users[0]]);
    expect(before.members).toEqual([member]);
    const immutablePath = `members[value eq "${users[0]}"].$ref`;
    const rejectedPatch = await patch(url, [
      { op: 'replace', path: 'displayName', value: 'must-rollback' },
      { op: 'replace', path: immutablePath, value: 'https://scim.example.test/Users/changed' },
    ]).expect(400);
    assertMemberError(rejectedPatch, 'mutability', {
      errorCode: 'VALIDATION_PATCH', triggeredBy: 'PatchEngine',
      failedOperationIndex: 1, failedOp: 'replace', failedPath: immutablePath,
    });
    expect(await readMembers(url, [users[0]])).toEqual(before);
    const rejectedPut = await scimPut(app, url, token, { ...body(), members: [{ ...member, $ref: 'https://scim.example.test/Users/changed' }] }).expect(400);
    assertMemberError(rejectedPut, 'mutability', {
      errorCode: 'VALIDATION_IMMUTABLE', attributePath: 'members[0].$ref', attributePaths: ['members[0].$ref'],
    });
    expect(await readMembers(url, [users[0]])).toEqual(before);
  });
  it('applies multi-member and remove-all policies without partial writes', async () => {
    const url = await create([users[0]]);
    await settings({
      MultiMemberPatchOpForGroupEnabled: false,
      PatchOpAllowRemoveAllMembers: false,
    });
    const before = await readMembers(url, [users[0]]);
    for (const { operation, detail } of [
      { operation: { op: 'add', path: 'members', value: users.slice(1).map(value => ({ value })) },
        detail: 'Adding multiple members in a single operation is not allowed.' },
      { operation: { op: 'remove', path: 'members', value: users.slice(0, 2).map(value => ({ value })) },
        detail: 'Removing multiple members in a single operation is not allowed.' },
      { operation: { op: 'remove', path: 'members' },
        detail: 'Removing all members via path=members is not allowed.' },
    ]) {
      const rejected = await patch(url, [{ op: 'replace', path: 'displayName', value: 'must-rollback' }, operation]).expect(400);
      assertMemberError(rejected, 'invalidValue', {
        errorCode: 'VALIDATION_PATCH', triggeredBy: 'PatchEngine',
        failedOperationIndex: 1, failedOp: operation.op, failedPath: 'members',
      });
      expect((rejected.body as Record<string, unknown>).detail).toBe(detail);
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
        const attributePath = `members[${method === 'PATCH' ? 1 : 0}].${field}`;
        assertMemberError(response, 'invalidSyntax', {
          errorCode: 'VALIDATION_SCHEMA', triggeredBy: 'StrictSchemaValidation',
          attributePath, attributePaths: [attributePath], activeConfig: { StrictSchemaValidation: true },
        });
        expect(await readMembers(url, [users[0]])).toEqual(before);
        const collection = await scimGet(app, `${base}/Groups`, token).expect(200);
        const collectionBody = collection.body as GroupListResponse;
        assertListResponseShape(collectionBody);
        expect(collectionBody.totalResults).toBe(1);
        expect(collectionBody.Resources).toHaveLength(1);
        expect(collectionBody.Resources[0].id).toBe(before.id);
      }
      expect(await readMembers(url, [users[0]])).toEqual(before);
    });
  }
});
