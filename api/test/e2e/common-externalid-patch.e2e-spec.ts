import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost as rawPost, scimPatch as rawPatch, scimGet as rawGet, scimDelete } from './helpers/request.helper';
import type { TypedHttpTest } from './helpers/typed-http';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY } from '../../src/domain/repositories/repository.tokens';
import { COMMON_PATCH_EXTENSION, commonExternalIdPatchFixture, invalidCommonExternalIds } from '../helpers/common-externalid-patch.fixture';

const extension = COMMON_PATCH_EXTENSION;
const patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
interface Body extends Record<string, unknown> {
  id: string;
  [extension]: { externalId: number[] };
}
const post = (...args: Parameters<typeof rawPost>) => rawPost(...args) as unknown as TypedHttpTest<Body>;
const patch = (...args: Parameters<typeof rawPatch>) => rawPatch(...args) as unknown as TypedHttpTest<Body>;
const get = (...args: Parameters<typeof rawGet>) => rawGet(...args) as unknown as TypedHttpTest<Body>;

describe('PATCH common externalId integration', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app?.close(); });

  for (const family of ['User', 'Group', 'Widget']) {
    for (const strict of [true, false]) {
      describe(`${family} strict=${strict}`, () => {
        const fixture = commonExternalIdPatchFixture(family, strict);
        let endpointId: string;
        let base: string;
        beforeAll(async () => {
          const result = await post(app, '/scim/admin/endpoints', token, {
            name: `common-patch-${randomUUID()}`,
            profile: fixture.profile,
          }).expect(201);
          endpointId = result.body.id;
          base = `/scim/endpoints/${endpointId}/${family}s`;
        });
        afterAll(async () => { if (endpointId) await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, token).expect(204); });
        async function create() {
          return post(app, base, token, fixture.payload(`resource-${randomUUID()}`)).expect(201);
        }
        async function stored(id: string) {
          const repo = app.get<{ findByScimId(...args: string[]): Promise<unknown> }>(
            family === 'User' ? USER_REPOSITORY : family === 'Group' ? GROUP_REPOSITORY : GENERIC_RESOURCE_REPOSITORY,
          );
          return repo.findByScimId(...(family === 'Widget' ? [endpointId, family, id] : [endpointId, id]));
        }
        for (const pathless of [false, true]) {
          it.each(invalidCommonExternalIds)(
            `rejects invalid common externalId with full rollback, pathless=${pathless}: %j`, async value => {
              const created = await create();
              const url = `${base}/${created.body.id}`;
              const before = await get(app, url, token).expect(200);
              const saved = await stored(created.body.id);
              const response = await patch(app, url, token, {
                schemas: [patchUrn], Operations: [
                  { op: 'replace', path: 'marker', value: 'must-rollback' },
                  pathless ? { op: 'replace', value: { externalId: value } }
                    : { op: 'replace', path: 'externalId', value },
                ],
              });
              expect(response.status).toBe(400);
              expect(response.body.status).toBe('400');
              expect(['invalidValue', 'invalidSyntax']).toContain(response.body.scimType);
              expect(typeof response.body.detail).toBe('string');
              for (const key of Object.keys(response.body)) {
                expect(['schemas', 'status', 'scimType', 'detail', 'urn:scimserver:api:messages:2.0:Diagnostics']).toContain(key);
              }
              expect((await get(app, url, token).expect(200)).body).toEqual(before.body);
              expect(await stored(created.body.id)).toEqual(saved);
            },
          );
        }
        it('preserves common string case, extension integer arrays and unrelated custom shapes', async () => {
          const created = await create();
          const url = `${base}/${created.body.id}`;
          const response = await patch(app, url, token, {
            schemas: [patchUrn], Operations: [
              { op: 'replace', path: 'EXTERNALID', value: 'NewCase' },
              { op: 'replace', path: `${extension}:externalId`, value: [2, 3] },
            ],
          }).expect(200);
          expect(response.body.externalId).toBe('NewCase');
          expect(response.body[extension].externalId).toEqual([2, 3]);
          if (family === 'Widget') {
            expect(response.body.displayName).toEqual([7, 8]);
            expect(response.body.active).toBe('custom');
          }
          expect((await get(app, url, token).expect(200)).body).toEqual(response.body);
        });
      });
    }
  }
});
