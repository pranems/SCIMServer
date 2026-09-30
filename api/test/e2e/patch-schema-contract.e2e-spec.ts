import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimPatch, scimGet, scimDelete } from './helpers/request.helper';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY } from '../../src/domain/repositories/repository.tokens';
import { commonExternalIdPatchFixture } from '../helpers/common-externalid-patch.fixture';

const extension = 'urn:example:extension:p7b:2.0';
const optional = 'urn:example:optional:p7b:2.0';
const patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const attributes = [
  { name: 'count', type: 'integer' },
  { name: 'requested', type: 'string', returned: 'request' },
  { name: 'hidden', type: 'string', returned: 'never' },
  { name: 'secret', type: 'string', mutability: 'writeOnly' },
  { name: 'locked', type: 'string', mutability: 'readOnly' },
  { name: 'record', type: 'complex', subAttributes: [
    { name: 'key', type: 'string', required: true, mutability: 'immutable' },
    { name: 'note', type: 'string', returned: 'request' },
  ] },
  { name: 'tags', type: 'string', multiValued: true },
];

describe('P7b PATCH schema contracts', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app?.close(); });

  for (const family of ['User', 'Group', 'Widget']) for (const strict of [true, false]) {
    describe(`${family} strict=${strict}`, () => {
      const fixture = commonExternalIdPatchFixture(family, strict);
      let endpoint: string;
      let base: string;
      beforeAll(async () => {
        const profile = {
          ...fixture.profile,
          schemas: [{ ...fixture.profile.schemas[0], attributes: [...fixture.profile.schemas[0].attributes, ...attributes] },
            ...fixture.profile.schemas.slice(1).map(s => ({ ...s,
              attributes: s.attributes.map(a => ({ ...a, required: true })) })),
            { id: extension, name: 'P7bExtension', attributes },
            { id: optional, name: 'P7bOptional', attributes }],
          resourceTypes: [{ ...fixture.profile.resourceTypes[0], schemaExtensions: [
            ...fixture.profile.resourceTypes[0].schemaExtensions, { schema: extension, required: true },
            { schema: optional, required: false },
          ] }],
          settings: { ...fixture.profile.settings, VerbosePatchSupported: true },
          serviceProviderConfig: { ...fixture.profile.serviceProviderConfig,
            bulk: { supported: true, maxOperations: 10, maxPayloadSize: 1048576 } },
        };
        const result = await scimPost(app, '/scim/admin/endpoints', token, {
          name: `p7b-${randomUUID()}`, profile,
        }).expect(201);
        endpoint = result.body.id;
        base = `/scim/endpoints/${endpoint}/${family}s`;
      });
      afterAll(async () => { if (endpoint) await scimDelete(app, `/scim/admin/endpoints/${endpoint}`, token).expect(204); });
      async function create() {
        return scimPost(app, base, token, {
          ...fixture.payload(`p7b-${randomUUID()}`), schemas: [fixture.core, ...fixture.profile.resourceTypes[0].schemaExtensions.map(e => e.schema), extension, optional],
          requested: 'core-before', hidden: 'private', secret: 'private',
          [extension]: { count: 1, requested: 'ext-before', hidden: 'private', secret: 'private' },
          [optional]: { count: 1 },
        }).expect(201);
      }
      async function stored(id: string) {
        const repo = app.get<{ findByScimId(...args: string[]): Promise<unknown> }>(
          family === 'User' ? USER_REPOSITORY : family === 'Group' ? GROUP_REPOSITORY : GENERIC_RESOURCE_REPOSITORY,
        );
        return repo.findByScimId(...(family === 'Widget' ? [endpoint, family, id] : [endpoint, id]));
      }
      async function unchanged(operations: object[], type?: string, failedIndex = operations.length) {
        const created = await create();
        const url = `${base}/${created.body.id}`;
        const before = (await scimGet(app, url, token).expect(200)).body;
        const raw = await stored(created.body.id);
        const result = await scimPatch(app, url, token, {
          schemas: [patchUrn], Operations: [{ op: 'replace', path: 'marker', value: 'rollback' }, ...operations],
        }).expect(400);
        expect(result.body.status).toBe('400');
        if (type) expect(result.body.scimType).toBe(type);
        expect(result.body['urn:scimserver:api:messages:2.0:Diagnostics'].failedOperationIndex).toBe(failedIndex);
        expect(typeof result.body.detail).toBe('string');
        for (const key of Object.keys(result.body)) expect(['schemas', 'status', 'scimType', 'detail',
          'urn:scimserver:api:messages:2.0:Diagnostics']).toContain(key);
        expect((await scimGet(app, url, token).expect(200)).body).toEqual(before);
        expect(await stored(created.body.id)).toEqual(raw);
      }
      for (const op of ['add', 'replace']) for (const pathless of [true, false]) {
        it(`accepts ${op} whole namespace pathless=${pathless} and retains untouched required core`, async () => {
          const resource = await create();
          const value = { count: 2, tags: op === 'add' ? 'one' : ['one'] };
          const result = await scimPatch(app, `${base}/${resource.body.id}`, token, {
            schemas: [patchUrn], Operations: [pathless ? { op, value: { [extension]: value } } : { op, path: extension, value }],
          }).expect(200);
          expect(result.body[fixture.primary]).toBe(resource.body[fixture.primary]);
          expect(result.body[extension].count).toBe(2);
          expect(result.body[extension].tags).toEqual(['one']);
          expect(result.body.meta.version).not.toBe(resource.body.meta.version);
          expect((await scimGet(app, `${base}/${resource.body.id}`, token).expect(200)).body).toEqual(result.body);
        });
      }
      it('allows removing an optional extension with locally required attributes', async () => {
        const resource = await create();
        const optional = fixture.profile.resourceTypes[0].schemaExtensions[0].schema;
        const url = `${base}/${resource.body.id}`;
        const result = await scimPatch(app, url, token, { schemas: [patchUrn], Operations: [
          { op: 'remove', path: optional },
        ] }).expect(200);
        expect(result.body[optional]).toBeUndefined();
        expect(result.body.schemas).not.toContain(optional);
        expect((await scimGet(app, url, token).expect(200)).body).toEqual(result.body);
      });
      for (const pathless of [true, false]) it(`returns success after removing a numeric namespace, pathless=${pathless}`, async () => {
        const resource = await create();
        const url = `${base}/${resource.body.id}`;
        const result = await scimPatch(app, url, token, { schemas: [patchUrn], Operations: [
          { op: 'replace', path: 'marker', value: 'committed-with-success' },
          pathless ? { op: 'replace', value: { [optional]: null } } : { op: 'replace', path: optional, value: null },
        ] }).expect(200);
        expect(result.body.marker).toBe('committed-with-success');
        expect(result.body[optional]).toBeUndefined();
        expect(result.body.schemas).not.toContain(optional);
        expect(result.body.meta.version).not.toBe(resource.body.meta.version);
        expect((await scimGet(app, url, token).expect(200)).body).toEqual(result.body);
      });
      if (strict) for (const pathless of [true, false]) it.each([
        7, false, [], ['bad'], { count: 'bad' }, { extra: 7 }, { record: { key: 'ok', extra: 3 } },
        { record: { key: 7 } }, { record: [] },
      ])(`rejects malformed namespace and rolls back pathless=${pathless}: %j`, async value => {
        await unchanged([pathless ? { op: 'replace', value: { [extension]: value } }
          : { op: 'replace', path: extension, value }]);
      });
      it.each([
        { op: 'remove', path: extension },
        { op: 'replace', path: extension, value: null },
        { op: 'replace', value: { [extension]: null } },
      ])('rejects required binding removal: %j', async operation => {
        await unchanged([operation], 'invalidValue');
      });
      if (!strict) it('keeps ordinary non-required type checking strict-only', async () => {
        const resource = await create();
        const result = await scimPatch(app, `${base}/${resource.body.id}`, token, {
          schemas: [patchUrn], Operations: [{ op: 'replace', path: extension, value: { count: 'legacy' } }],
        }).expect(200);
        expect(result.body[extension].count).toBe('legacy');
      });
      if (!strict) it('does not reparse ignored no-path keys after committing', async () => {
        const resource = await create();
        const url = `${base}/${resource.body.id}`;
        const result = await scimPatch(app, url, token, { schemas: [patchUrn], Operations: [
          { op: 'replace', value: { marker: 'committed-with-success', prototype: 'ignored' } },
        ] }).expect(200);
        expect(result.body.marker).toBe('committed-with-success');
        expect(Object.keys(result.body)).not.toContain('prototype');
        expect((await scimGet(app, url, token).expect(200)).body).toEqual(result.body);
      });
      if (strict) it.each([extension, extension.toUpperCase()])('ignores namespace readOnly input before cached strict validation: %s', async namespace => {
        await scimPatch(app, `/scim/admin/endpoints/${endpoint}`, token,
          { profile: { settings: { IgnoreReadOnlyAttributesInPatch: true } } }).expect(200);
        try {
          const resource = await create();
          const url = `${base}/${resource.body.id}`;
          const result = await scimPatch(app, url, token, { schemas: [patchUrn], Operations: [
            { op: 'replace', path: namespace, value: { locked: 7, count: 5 } },
          ] }).expect(200);
          expect(result.body[extension].count).toBe(5);
          expect(result.body[extension].locked).toBeUndefined();
          const raw = await stored(resource.body.id) as { rawPayload: string };
          expect(JSON.parse(raw.rawPayload)[extension].locked).toBeUndefined();
        } finally {
          await scimPatch(app, `/scim/admin/endpoints/${endpoint}`, token,
            { profile: { settings: { IgnoreReadOnlyAttributesInPatch: false } } }).expect(200);
        }
      });
      if (family !== 'Widget') it('Bulk delegates schema rejection with no partial resource write', async () => {
        const resource = await create();
        const url = `${base}/${resource.body.id}`;
        const before = (await scimGet(app, url, token).expect(200)).body;
        const raw = await stored(resource.body.id);
        const result = await scimPost(app, `/scim/endpoints/${endpoint}/Bulk`, token, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
          Operations: [{ method: 'PATCH', path: `/${family}s/${resource.body.id}`, data: {
            schemas: [patchUrn], Operations: [{ op: 'replace', path: 'marker', value: 'rollback' },
              { op: 'remove', path: extension }],
          } }],
        }).expect(200);
        expect(result.body.Operations[0].status).toBe('400');
        expect(result.body.Operations[0].response.scimType).toBe('invalidValue');
        expect((await scimGet(app, url, token).expect(200)).body).toEqual(before);
        expect(await stored(resource.body.id)).toEqual(raw);
      });
      if (family === 'User') it('/Me preserves PATCH request presence and required-binding atomicity', async () => {
        const resource = await scimPost(app, base, token, { ...fixture.payload('e2e-client'),
          schemas: [...fixture.profile.schemas.map(s => s.id), extension], [extension]: { count: 1 } }).expect(201);
        const me = `/scim/endpoints/${endpoint}/Me`;
        const result = await scimPatch(app, me, token, { schemas: [patchUrn], Operations: [
          { op: 'replace', value: { [extension]: { requested: 'me-supplied' } } },
        ] }).expect(200);
        expect(result.body.id).toBe(resource.body.id);
        expect(result.body[extension].requested).toBe('me-supplied');
        const before = (await scimGet(app, me, token).expect(200)).body;
        const raw = await stored(resource.body.id);
        await scimPatch(app, me, token, { schemas: [patchUrn], Operations: [
          { op: 'replace', path: 'marker', value: 'rollback' }, { op: 'remove', path: extension },
        ] }).expect(400);
        expect((await scimGet(app, me, token).expect(200)).body).toEqual(before);
        expect(await stored(resource.body.id)).toEqual(raw);
      });
      for (const prefix of ['', `${extension}:`]) {
        it(`does not let a later operation repair a missing required child ${prefix || 'core'}`, async () => {
          await unchanged([
            { op: 'replace', path: `${prefix}record`, value: { note: 'missing-key' } },
            { op: 'replace', path: `${prefix}record.key`, value: 'too-late' },
          ], 'invalidValue', 1);
        });
        if (!strict) it(`enforces required children on lenient malformed containers ${prefix || 'core'}`, async () => {
          await unchanged([{ op: 'replace', path: `${prefix}record`, value: 7 }], 'invalidValue');
        });
        it(`checks evolving immutable ${prefix || 'core'} namespace`, async () => {
          await unchanged([
            { op: 'add', path: `${prefix}record`, value: { key: 'first' } },
            { op: 'replace', path: `${prefix}record`, value: { key: 'changed' } },
          ], 'mutability');
        });
        it(`retains required child on partial update ${prefix || 'core'}`, async () => {
          const resource = await create();
          const result = await scimPatch(app, `${base}/${resource.body.id}`, token, { schemas: [patchUrn], Operations: [
            { op: 'add', path: `${prefix}record`, value: { key: 'first' } },
            { op: 'replace', path: `${prefix}record`, value: { note: 'supplied' } },
          ] }).expect(200);
          expect((prefix ? result.body[extension] : result.body).record).toEqual({ key: 'first', note: 'supplied' });
          expect(result.body.requested).toBeUndefined();
        });
      }
      it('returns only supplied request-only homonyms and honors explicit projection/privacy', async () => {
        const resource = await create();
        const url = `${base}/${resource.body.id}`;
        const operations = [{ op: 'replace', path: `${extension}:requested`, value: 'changed' },
          { op: 'replace', path: `${extension}:hidden`, value: 'private-next' },
          { op: 'replace', path: 'secret', value: 'private-next' }];
        const result = await scimPatch(app, url, token, { schemas: [patchUrn], Operations: operations }).expect(200);
        expect(result.body[extension].requested).toBe('changed');
        expect(result.body.requested).toBeUndefined();
        expect(result.body[extension].hidden).toBeUndefined();
        expect(result.body.secret).toBeUndefined();
        const later = await scimGet(app, url, token).expect(200);
        expect(later.body[extension].requested).toBeUndefined();
        const projected = await scimPatch(app, `${url}?attributes=marker,hidden,secret,${extension}:hidden`, token,
          { schemas: [patchUrn], Operations: operations }).expect(200);
        expect(projected.body[extension]?.requested).toBeUndefined();
        expect(projected.body.hidden).toBeUndefined();
        expect(projected.body.secret).toBeUndefined();
      });
    });
  }
});
