import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { randomUUID } from 'crypto';
import { recursiveReadOnlyAttribute, recursiveReadOnlyInput, recursiveReadOnlyExpected } from './helpers/profile-p7-readonly.fixture';

const DIAG = 'urn:scimserver:api:messages:2.0:Diagnostics';
const EXT = 'urn:example:params:scim:schemas:extension:p7:2.0:Test';
const shapes = [
  ['text', 'string', 'bespoke'], ['flag', 'boolean', false], ['whole', 'integer', 27],
  ['fraction', 'decimal', 1.25], ['encoded', 'binary', '+/8='],
  ['link', 'reference', '../Users/123'], ['stamp', 'dateTime', '2024-02-29T12:00:00Z'],
] as const;

describe('P7 declaration and POST/PUT contracts', () => {
  let app: INestApplication;
  let token: string;
  const endpoints: string[] = [];
  const admin = (method: 'post' | 'patch' | 'get' | 'delete', path = '') =>
    request(app.getHttpServer())[method](`/scim/admin/endpoints${path}`).set('Authorization', `Bearer ${token}`);
  const scim = (method: 'post' | 'put' | 'get', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/scim+json');
  const error = (body: Record<string, any>, type: string) => {
    expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(body.status).toBe('400');
    expect(body.scimType).toBe(type);
    expect(typeof body.detail).toBe('string');
    for (const key of Object.keys(body)) expect(['schemas', 'status', 'scimType', 'detail', DIAG]).toContain(key);
  };
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => {
    for (const id of endpoints) await admin('delete', `/${id}`);
    await app.close();
  });

  it.each([{ type: 'typo' }, { multiValued: 'false' }, { mutability: 'Readonly' }, { uniqueness: 'global' }])(
    'admin rejects invalid declaration %j on create and update without changing saved profile', async override => {
      const created = await admin('post').send({ name: `p7-${randomUUID()}`, profilePreset: 'rfc-standard' }).expect(201);
      endpoints.push(created.body.id);
      const before = (await admin('get', `/${created.body.id}`).expect(200)).body;
      const profile = structuredClone(before.profile);
      profile.schemas[0].attributes.push({ name: 'sample', ...override });
      const rejectedCreate = await admin('post').send({ name: `p7-invalid-${randomUUID()}`, profile });
      expect(rejectedCreate.status).toBe(400);
      const rejectedUpdate = await admin('patch', `/${created.body.id}`).send({ profile });
      expect(rejectedUpdate.status).toBe(400);
      const after = (await admin('get', `/${created.body.id}`).expect(200)).body;
      expect(after.profile).toEqual(before.profile);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

  for (const resource of ['User', 'Group', 'Widget']) {
    const core = resource === 'Widget'
      ? 'urn:example:params:scim:schemas:core:2.0:Widget'
      : `urn:ietf:params:scim:schemas:core:2.0:${resource}`;
    const primary = resource === 'User' ? 'userName' : 'displayName';
    const attrs = [
      recursiveReadOnlyAttribute(),
      ...shapes.flatMap(([name, type]) => [
        { name, type, multiValued: false }, { name: `${name}List`, type, multiValued: true },
      ]),
      { name: 'suggested', type: 'string', canonicalValues: ['work'], caseExact: true },
      { name: 'serverOwned', type: 'integer', mutability: 'readOnly' },
      { name: 'fixed', type: 'string', mutability: 'immutable' },
      { name: 'hidden', type: 'string', returned: 'never' },
      { name: 'secret', type: 'string', mutability: 'writeOnly', returned: 'never' },
      { name: 'asked', type: 'string', returned: 'request' },
      { name: 'parent', type: 'complex', subAttributes: [{ name: 'fixed', type: 'string', mutability: 'immutable' }] },
      { name: 'lockedContacts', type: 'complex', multiValued: true, subAttributes: [
        { name: 'value', type: 'string' }, { name: 'primary', type: 'boolean' },
      ] },
      { name: 'children', type: 'complex', multiValued: true, subAttributes: [
        { name: 'value', type: 'string', required: true }, { name: 'labels', type: 'string', multiValued: true },
        { name: 'serverOwned', type: 'integer', mutability: 'readOnly', required: true },
      ] },
    ];
    for (const strict of [true, false]) {
      describe(`${resource} strict=${strict}`, () => {
        let base: string;
        let endpointId: string;
        beforeAll(async () => {
          const response = await admin('post').send({ name: `p7-${resource}-${randomUUID()}`, profile: {
            schemas: [
              { id: core, name: resource, attributes: [{ name: primary, type: 'string', required: true }, ...attrs] },
              { id: EXT, name: 'P7Extension', attributes: [{ name: 'requiredValue', type: 'string', required: true }, ...attrs] },
            ],
            resourceTypes: [{ id: resource, name: resource, description: 'P7', endpoint: `/${resource}s`, schema: core,
              schemaExtensions: [{ schema: EXT, required: true }] }],
            settings: { StrictSchemaValidation: strict, AllowAndCoerceBooleanStrings: false, RfcCompliantSubAttributes: false },
            serviceProviderConfig: { etag: { supported: true } },
          } }).expect(201);
          endpoints.push(response.body.id);
          endpointId = response.body.id;
          base = `/scim/endpoints/${response.body.id}/${resource}s`;
        });
        const body = () => ({
          schemas: [core, EXT], [primary]: `p7-${randomUUID()}`, [EXT]: { requiredValue: 'present' },
        });

        it('requires extension binding even when omitted from schemas and resource body', async () => {
          const input = { schemas: [core], [primary]: `p7-${randomUUID()}` };
          const rejected = await scim('post', base).send(input).expect(400);
          error(rejected.body, 'invalidValue');
          expect(rejected.body[DIAG].attributePaths).toContain(EXT);
          const listed = await scim('get', base).query({ filter: `${primary} eq "${input[primary]}"` }).expect(200);
          expect(listed.body.totalResults).toBe(0);
        });

        it('ignores malformed readOnly data before type/required checks, on POST and PUT', async () => {
          const input = { ...body(), serverOwned: { bad: true },
            children: [{ value: 'child', labels: ['one'], serverOwned: 'not an integer' }],
            [EXT]: { requiredValue: 'present', serverOwned: [] },
          };
          const created = await scim('post', base).send(input).expect(res => {
            expect({ status: res.status, error: res.status >= 400 ? res.body : undefined }).toEqual({ status: 201 });
          });
          expect(created.body.serverOwned).toBeUndefined();
          expect(created.body.children).toEqual([{ value: 'child', labels: ['one'] }]);
          expect(created.body[EXT]).toEqual({ requiredValue: 'present' });
          const replaced = await scim('put', `${base}/${created.body.id}`).send(input).expect(200);
          expect(replaced.body.children).toEqual(created.body.children);
        });

          it('recursively ignores readOnly input on POST and PUT in nested-complex compatibility mode', async () => {
            const input = { ...body(), nested: recursiveReadOnlyInput(),
              [EXT]: { requiredValue: 'present', nested: recursiveReadOnlyInput([]) } };
            const created = await scim('post', base).send(input).expect(201);
            expect(created.body.nested).toEqual(recursiveReadOnlyExpected());
            expect(created.body[EXT].nested).toEqual(recursiveReadOnlyExpected());
            const replaced = await scim('put', `${base}/${created.body.id}`).send(input).expect(200);
            expect(replaced.body.nested).toEqual(recursiveReadOnlyExpected());
            expect(replaced.body[EXT].nested).toEqual(recursiveReadOnlyExpected());
            const read = await scim('get', `${base}/${created.body.id}`).expect(200);
            expect(read.body.nested).toEqual(recursiveReadOnlyExpected());
            expect(read.body[EXT].nested).toEqual(recursiveReadOnlyExpected());
            if (strict) {
              const bad = structuredClone(input);
              delete (bad.nested.records[0].details[0] as { open?: string }).open;
              const rejected = await scim('put', `${base}/${created.body.id}`).send(bad).expect(400);
              error(rejected.body, 'invalidValue');
              expect(rejected.body[DIAG].attributePaths).toContain('nested.records[0].details[0].open');
              expect((await scim('get', `${base}/${created.body.id}`).expect(200)).body).toEqual(read.body);
            }
          });

          it('retains deep server-owned values on PUT after a profile changes them to readOnly', async () => {
            const originalProfile = (await admin('get', `/${endpointId}`).expect(200)).body.profile;
            const seedProfile = structuredClone(originalProfile);
            for (const schema of seedProfile.schemas) {
              schema.attributes = schema.attributes.map((a: { name: string }) =>
                a.name === 'nested' ? recursiveReadOnlyAttribute('readWrite') : a);
            }
            let id: string;
            try {
              await admin('patch', `/${endpointId}`).send({ profile: seedProfile }).expect(200);
              const seed = { ...body(), nested: recursiveReadOnlyInput(7),
                [EXT]: { requiredValue: 'present', nested: recursiveReadOnlyInput(9) } };
              id = (await scim('post', base).send(seed).expect(201)).body.id;
            } finally {
              await admin('patch', `/${endpointId}`).send({ profile: originalProfile }).expect(200);
            }
            const replaced = await scim('put', `${base}/${id}`).send({ ...body(), nested: recursiveReadOnlyInput(false),
              [EXT]: { requiredValue: 'present', nested: recursiveReadOnlyInput({ wrong: true }) } }).expect(200);
            expect(replaced.body.nested).toEqual(recursiveReadOnlyInput(7));
            expect(replaced.body[EXT].nested).toEqual(recursiveReadOnlyInput(9));
          });
        it('preserves immutable state on omitted PUT input or rejects the replacement without mutation', async () => {
          const input = { ...body(), fixed: 'first', [EXT]: { requiredValue: 'present', fixed: 'ext-first' } };
          const created = await scim('post', base).send(input).expect(201);
          const before = (await scim('get', `${base}/${created.body.id}`).expect(200)).body;
          const replacement = await scim('put', `${base}/${created.body.id}`).send(body());
          // This implementation chooses preservation for omitted immutable values.
          expect(replacement.status).toBe(200);
          expect(replacement.body.fixed).toBe('first');
          expect(replacement.body[EXT].fixed).toBe('ext-first');
          const changed = await scim('put', `${base}/${created.body.id}`).send({ ...input, fixed: 'second' }).expect(400);
          error(changed.body, 'mutability');
          const after = (await scim('get', `${base}/${created.body.id}`).expect(200)).body;
          expect(after.fixed).toBe(before.fixed);
          expect(after[EXT].fixed).toBe(before[EXT].fixed);
          expect(after.meta.version).toBe(replacement.body.meta.version);
        });

        it('rejects explicit null clearing a parent with assigned immutable children', async () => {
          const input = { ...body(), parent: { fixed: 'nested' } };
          const created = await scim('post', base).send(input).expect(201);
          const before = (await scim('get', `${base}/${created.body.id}`).expect(200)).body;
          const rejected = await scim('put', `${base}/${created.body.id}`).send({ ...input, parent: null }).expect(400);
          error(rejected.body, 'mutability');
          expect((await scim('get', `${base}/${created.body.id}`).expect(200)).body).toEqual(before);
        });

        it('does not normalize retained readOnly data on unrelated PUT', async () => {
          await admin('patch', `/${endpointId}`).send({ profile: { settings: { PrimaryEnforcement: 'passthrough' } } }).expect(200);
          const contacts = [{ value: 'a', primary: true }, { value: 'b', primary: true }];
          const created = await scim('post', base).send({ ...body(), lockedContacts: contacts }).expect(201);
          const beforeProfile = (await admin('get', `/${endpointId}`).expect(200)).body.profile;
          const updatedProfile = structuredClone(beforeProfile);
          updatedProfile.schemas.find((schema: { id: string }) => schema.id === core).attributes
            .find((attr: { name: string }) => attr.name === 'lockedContacts').mutability = 'readOnly';
          updatedProfile.settings.PrimaryEnforcement = 'normalize';
          try {
            await admin('patch', `/${endpointId}`).send({ profile: updatedProfile }).expect(200);
            const replaced = await scim('put', `${base}/${created.body.id}`).send(body()).expect(200);
            expect(replaced.body.lockedContacts).toEqual(contacts);
            updatedProfile.settings.PrimaryEnforcement = 'reject';
            await admin('patch', `/${endpointId}`).send({ profile: updatedProfile }).expect(200);
            const again = await scim('put', `${base}/${created.body.id}`).send(body()).expect(200);
            expect(again.body.lockedContacts).toEqual(contacts);
          } finally {
            await admin('patch', `/${endpointId}`).send({ profile: beforeProfile }).expect(200);
          }
        });

        it('stores valid scalar/list/complex shapes and projects returned characteristics', async () => {
          const values = Object.fromEntries(shapes.flatMap(([name, , value]) => [[name, value], [`${name}List`, [value]]]));
          const input = { ...body(), ...values, suggested: 'bespoke', hidden: 'never', secret: 'write-only', asked: 'on-request',
            children: [{ value: 'child', labels: ['a', 'b'] }],
            [EXT]: { requiredValue: 'present', ...values, suggested: 'bespoke', hidden: 'ext-never', secret: 'ext-secret' },
          };
          const created = await scim('post', base).send(input).expect(201);
          expect(created.body).toMatchObject(values);
          expect(created.body[EXT]).toMatchObject(values);
          expect(created.body.hidden).toBeUndefined();
          expect(created.body.secret).toBeUndefined();
          expect(created.body[EXT].hidden).toBeUndefined();
          expect(created.body[EXT].secret).toBeUndefined();
          expect(created.body.asked).toBe('on-request');
          const read = await scim('get', `${base}/${created.body.id}`).expect(200);
          expect(read.body.asked).toBeUndefined();
          const selected = await scim('get', `${base}/${created.body.id}`).query({ attributes: 'asked,hidden,secret' }).expect(200);
          expect(selected.body.asked).toBe('on-request');
          expect(selected.body.hidden).toBeUndefined();
          expect(selected.body.secret).toBeUndefined();
          for (const key of Object.keys(read.body)) expect(['schemas', 'id', 'meta', primary, 'active', 'externalId', 'members',
            'suggested', 'children', EXT, ...Object.keys(values)]).toContain(key);
        });

        if (strict) {
          it.each([
            ['stamp', '2023-02-29T00:00:00Z'], ['encoded', 'invalid!'], ['link', 'https://exa mple.test'],
            ['wholeList', [1.25]], ['children', [{ value: 'ok', labels: 'bad' }]],
          ])('rejects bad %s on POST/PUT with stored snapshot and version unchanged', async (key, invalid) => {
            const input = body();
            const created = await scim('post', base).send(input).expect(201);
            const before = (await scim('get', `${base}/${created.body.id}`).expect(200)).body;
            for (const extension of [false, true]) {
              const bad = extension ? { ...input, [EXT]: { requiredValue: 'present', [key as string]: invalid } }
                : { ...input, [key as string]: invalid };
              const rejected = await scim('put', `${base}/${created.body.id}`).send(bad).expect(400);
              error(rejected.body, key === 'children' ? 'invalidSyntax' : 'invalidValue');
              expect((await scim('get', `${base}/${created.body.id}`).expect(200)).body).toEqual(before);
              const post = await scim('post', base).send({ ...bad, [primary]: `bad-${randomUUID()}` }).expect(400);
              error(post.body, key === 'children' ? 'invalidSyntax' : 'invalidValue');
            }
          });
        }
      });
    }
  }
});
