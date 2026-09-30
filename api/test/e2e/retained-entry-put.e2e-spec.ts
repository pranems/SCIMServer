import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost as rawPost, scimPut as rawPut, scimPatch, scimGet as rawGet, scimDelete } from './helpers/request.helper';
import type { TypedHttpTest } from './helpers/typed-http';
import { retainedEntryCases, retainedRecordsAttribute } from '../helpers/retained-entry.fixture';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY } from '../../src/domain/repositories/repository.tokens';

const extension = 'urn:example:extension:2.0:Retained';
interface WireBody extends Record<string, unknown> {
  id: string;
  [extension]: Record<string, unknown>;
  meta: { version: string };
}
const post = (...args: Parameters<typeof rawPost>) => rawPost(...args) as unknown as TypedHttpTest<WireBody>;
const put = (...args: Parameters<typeof rawPut>) => rawPut(...args) as unknown as TypedHttpTest<WireBody>;
const get = (...args: Parameters<typeof rawGet>) => rawGet(...args) as unknown as TypedHttpTest<WireBody>;

describe('PUT retained complex-entry state on actual resource adapters', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app?.close(); });

  for (const family of ['User', 'Group', 'Widget']) {
    const core = family === 'Widget' ? 'urn:example:core:2.0:Widget' : `urn:ietf:params:scim:schemas:core:2.0:${family}`;
    const primary = family === 'User' ? 'userName' : 'displayName';
    for (const strict of [true, false]) {
      for (const mutability of ['readOnly', 'immutable'] as const) {
        it.each(retainedEntryCases)(`${family} strict=${strict} ${mutability}: $name`, async scenario => {
          const profile = {
            schemas: [
              { id: core, name: family, attributes: [
                { name: primary, type: 'string', required: true },
                { name: 'active', type: 'boolean' },
                ...(family === 'Group' ? [{ name: 'members', type: 'complex', multiValued: true,
                  subAttributes: [{ name: 'value', type: 'string' }] }] : []),
                retainedRecordsAttribute('readWrite'),
              ] },
              { id: extension, name: 'RetainedExtension', attributes: [retainedRecordsAttribute('readWrite')] },
            ],
            resourceTypes: [{ id: family, name: family, endpoint: `/${family}s`, schema: core,
              schemaExtensions: [{ schema: extension, required: false }] }],
            settings: { StrictSchemaValidation: strict, logFileEnabled: false },
            serviceProviderConfig: { etag: { supported: true } },
          };
          const endpoint = await post(app, '/scim/admin/endpoints', token, {
            name: `retained-put-${randomUUID()}`, profile,
          }).expect(201);
          const admin = `/scim/admin/endpoints/${endpoint.body.id}`;
          try {
            const base = `/scim/endpoints/${endpoint.body.id}/${family}s`;
            const primaryValue = `retained-${randomUUID()}`;
            const created = await post(app, base, token, {
              schemas: [core, extension], [primary]: primaryValue,
              records: scenario.before, [extension]: { records: scenario.before },
            }).expect(201);
            const updatedProfile = structuredClone(profile);
            for (const schema of updatedProfile.schemas) {
              schema.attributes = schema.attributes.map(attribute => attribute.name === 'records'
                ? retainedRecordsAttribute(mutability) : attribute);
            }
            await scimPatch(app, admin, token, { profile: updatedProfile }).expect(200);
            const url = `${base}/${created.body.id}`;
            const candidate = { schemas: [core, extension], [primary]: primaryValue,
              records: scenario.after, [extension]: { records: scenario.after } };
            for (const version of [2, 3]) {
              const replaced = await put(app, url, token, candidate).expect(200);
              expect(replaced.body.records).toEqual(scenario.expected);
              expect(replaced.body[extension].records).toEqual(scenario.expected);
              expect(replaced.body.meta.version).toBe(`W/"v${version}"`);
              const read = await get(app, url, token).expect(200);
              expect(read.body).toEqual(replaced.body);
              for (const key of Object.keys(read.body)) {
                expect(['schemas', 'id', 'meta', primary, 'active', 'members', 'records', extension]).toContain(key);
              }
            }
            const repository = app.get<{
              findByScimId(...args: string[]): Promise<{ rawPayload: string } | null>;
            }>(family === 'User' ? USER_REPOSITORY : family === 'Group' ? GROUP_REPOSITORY : GENERIC_RESOURCE_REPOSITORY);
            const saved = await repository.findByScimId(...(family === 'Widget'
              ? [endpoint.body.id, family, created.body.id] : [endpoint.body.id, created.body.id]));
            expect(saved).not.toBeNull();
            const payload = JSON.parse(saved!.rawPayload) as WireBody;
            expect(payload.records).toEqual(scenario.expected);
            expect(payload[extension].records).toEqual(scenario.expected);
          } finally {
            await scimDelete(app, admin, token).expect(204);
          }
        });
      }
    }
  }
});
