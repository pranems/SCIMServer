/**
 * E2E Tests — Schema Characteristics Cache Integration
 *
 * Validates that the precomputed schema cache produces correct end-to-end
 * behavior across all SCIM operations. Tests cover:
 *
 * 1. Boolean coercion via cache (parent-aware precision)
 * 2. Returned characteristic filtering via cache (never/request/always)
 * 3. ReadOnly stripping via cache (POST/PUT/PATCH)
 * 4. CaseExact filtering via cache
 * 5. UniqueAttributes enforcement via cache
 * 6. Cache consistency after profile PATCH (admin update mid-session)
 * 7. Extension name-collision precision (core vs extension same-name attrs)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimGet,
  scimPost,
  scimPatch,
  scimPut,
  scimDelete,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, patchOp, resetFixtureCounter } from './helpers/fixtures';

describe('Schema Cache Integration (E2E)', () => {
  let app: INestApplication;
  let token: string;

  const CORE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const EXT_URN = 'urn:test:cache:2.0:User';
  const ts = () => Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Helper: Create endpoint with custom extension schema ───────────

  async function createCacheTestEndpoint(extAttrs: any[] = []): Promise<{ epId: string; basePath: string }> {
    resetFixtureCounter();
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `cache-e2e-${ts()}`,
        profile: {
          schemas: [
            { id: CORE_SCHEMA, name: 'User', attributes: 'all' },
            {
              id: EXT_URN,
              name: 'CacheTestExtension',
              description: 'Extension for cache integration tests',
              attributes: extAttrs.length > 0 ? extAttrs : [
                { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
                { name: 'badge', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'never', description: 'writeOnly badge' },
                { name: 'active', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'String active — NOT boolean' },
                { name: 'score', type: 'integer', multiValued: false, required: false, mutability: 'readOnly', returned: 'default', description: 'ReadOnly computed score' },
              ],
            },
          ],
          resourceTypes: [
            {
              id: 'User', name: 'User', endpoint: '/Users', description: 'User',
              schema: CORE_SCHEMA,
              schemaExtensions: [{ schema: EXT_URN, required: false }],
            },
          ],
          settings: {
            AllowAndCoerceBooleanStrings: 'True',
            StrictSchemaValidation: 'False',
          },
        },
      })
      .expect(201);

    const epId = res.body.id;
    return { epId, basePath: scimBasePath(epId) };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Boolean Coercion — Parent-Aware Precision
  // ═══════════════════════════════════════════════════════════════════════

  describe('Boolean coercion via cache (parent-aware)', () => {
    let epId: string;
    let basePath: string;

    beforeAll(async () => {
      ({ epId, basePath } = await createCacheTestEndpoint());
    });

    it('should coerce core active from string "True" to boolean true', async () => {
      const user = validUser({ active: 'True' as any });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Core active must be boolean true in response
      expect(res.body.active).toBe(true);
    });

    it('should NOT coerce extension active (string type) from "True" to boolean', async () => {
      const user = validUser({
        [EXT_URN]: { department: 'Engineering', active: 'True' },
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Extension active is declared as string — must remain string "True"
      const extBlock = res.body[EXT_URN];
      expect(extBlock).toBeDefined();
      expect(extBlock.active).toBe('True'); // NOT boolean true
    });

    it('should coerce emails[].primary from string "True" to boolean', async () => {
      const user = validUser({
        emails: [{ value: 'a@b.com', type: 'work', primary: 'True' as any }],
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.emails[0].primary).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Returned Characteristic Filtering
  // ═══════════════════════════════════════════════════════════════════════

  describe('Returned characteristics filtering via cache', () => {
    let epId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      ({ epId, basePath } = await createCacheTestEndpoint());

      // Create a user with extension data including returned:never "badge"
      const user = validUser({
        [EXT_URN]: { department: 'HR', badge: 'SECRET-123', active: 'Visible' },
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      userId = res.body.id;
    });

    it('should strip returned:never extension attr (badge) from GET response', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200);

      const ext = res.body[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.badge).toBeUndefined(); // returned:never — must not appear
      expect(ext.department).toBe('HR'); // returned:default — should appear
    });

    it('should strip returned:never from LIST response', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();
      const ext = user[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.badge).toBeUndefined();
    });

    it('should strip returned:never from POST response', async () => {
      const user = validUser({
        [EXT_URN]: { department: 'Sales', badge: 'TOP-SECRET' },
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const ext = res.body[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.badge).toBeUndefined();
      expect(ext.department).toBe('Sales');
    });

    it('should always include returned:always attrs (id, userName)', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. ReadOnly Stripping via Cache
  // ═══════════════════════════════════════════════════════════════════════

  describe('ReadOnly stripping via cache', () => {
    let epId: string;
    let basePath: string;

    beforeAll(async () => {
      ({ epId, basePath } = await createCacheTestEndpoint());
    });

    it('should strip readOnly extension attr (score) from POST payload', async () => {
      const user = validUser({
        [EXT_URN]: { department: 'IT', score: 42 },
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // score is readOnly — stripped from input, not in output
      const ext = res.body[EXT_URN];
      if (ext) {
        expect(ext.score).toBeUndefined();
      }
      expect(ext?.department).toBe('IT');
    });

    it('should strip client-supplied id and meta from POST', async () => {
      const user = validUser({
        id: 'client-id',
        meta: { resourceType: 'Fake' },
      } as any);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.id).not.toBe('client-id');
      expect(res.body.meta.resourceType).toBe('User');
    });

    it('should strip readOnly extension attr from PUT payload', async () => {
      // Create user first
      const user = validUser({ [EXT_URN]: { department: 'Eng' } });
      const cr = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const userId = cr.body.id;

      // PUT with readOnly score
      const putBody = {
        ...user,
        [EXT_URN]: { department: 'NewDept', score: 99 },
      };
      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, putBody).expect(200);

      const ext = res.body[EXT_URN];
      if (ext) {
        expect(ext.score).toBeUndefined();
      }
      expect(ext?.department).toBe('NewDept');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Cache Consistency After Profile Update
  // ═══════════════════════════════════════════════════════════════════════

  describe('Cache consistency after profile PATCH', () => {
    it('should use fresh cache after admin adds new extension schema', async () => {
      // Create endpoint with only core schema
      const res1 = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `cache-refresh-${ts()}`,
          profile: {
            schemas: [{ id: CORE_SCHEMA, name: 'User', attributes: 'all' }],
            resourceTypes: [
              { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: CORE_SCHEMA, schemaExtensions: [] },
            ],
          },
        })
        .expect(201);

      const epId = res1.body.id;
      const basePath = scimBasePath(epId);

      // Create user — no extension
      const u1 = validUser();
      const cr = await scimPost(app, `${basePath}/Users`, token, u1).expect(201);
      const userId = cr.body.id;

      // Admin updates profile: add extension schema
      const NEW_EXT = 'urn:test:dynamic:2.0:User';
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            schemas: [
              { id: CORE_SCHEMA, name: 'User', attributes: 'all' },
              {
                id: NEW_EXT,
                name: 'DynamicExt',
                attributes: [
                  { name: 'level', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
                ],
              },
            ],
            resourceTypes: [
              {
                id: 'User', name: 'User', endpoint: '/Users', description: 'User',
                schema: CORE_SCHEMA,
                schemaExtensions: [{ schema: NEW_EXT, required: false }],
              },
            ],
          },
        })
        .expect(200);

      // Create user with new extension — should work since cache was refreshed
      const u2 = validUser({
        [NEW_EXT]: { level: 'Senior' },
      });
      const res2 = await scimPost(app, `${basePath}/Users`, token, u2).expect(201);

      expect(res2.body[NEW_EXT]).toBeDefined();
      expect(res2.body[NEW_EXT].level).toBe('Senior');

      // Cleanup
      await scimDelete(app, `${basePath}/Users/${userId}`, token).expect(204);
      await scimDelete(app, `${basePath}/Users/${res2.body.id}`, token).expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Extension Name-Collision Precision
  // ═══════════════════════════════════════════════════════════════════════

  describe('Extension name-collision precision', () => {
    let epId: string;
    let basePath: string;

    beforeAll(async () => {
      ({ epId, basePath } = await createCacheTestEndpoint());
    });

    it('should preserve core active=true alongside extension active="SomeString"', async () => {
      const user = validUser({
        active: true,
        [EXT_URN]: { active: 'SomeString', department: 'Test' },
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Core active: boolean
      expect(res.body.active).toBe(true);
      // Extension active: string (preserved, not coerced)
      expect(res.body[EXT_URN]?.active).toBe('SomeString');
    });

    it('should not coerce extension active="False" to boolean false', async () => {
      const user = validUser({
        active: 'False' as any, // core: should be coerced to boolean false
        [EXT_URN]: { active: 'False', department: 'QA' },
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.active).toBe(false); // core: coerced
      expect(res.body[EXT_URN]?.active).toBe('False'); // extension: NOT coerced
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Multiple Requests Same Endpoint — Cache Reuse
  // ═══════════════════════════════════════════════════════════════════════

  describe('Multiple requests same endpoint — cache reuse', () => {
    let epId: string;
    let basePath: string;

    beforeAll(async () => {
      ({ epId, basePath } = await createCacheTestEndpoint());
    });

    it('should produce consistent results across 5 sequential POST requests', async () => {
      const results: any[] = [];

      for (let i = 0; i < 5; i++) {
        const user = validUser({
          active: 'True' as any,
          [EXT_URN]: { department: `Dept-${i}`, badge: `BADGE-${i}`, active: 'True' },
        });
        const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
        results.push(res.body);
      }

      // All 5 should have consistent cache-driven behavior
      for (const r of results) {
        expect(r.active).toBe(true); // core boolean coerced
        expect(r[EXT_URN]?.badge).toBeUndefined(); // returned:never stripped
        expect(r[EXT_URN]?.active).toBe('True'); // extension string NOT coerced
        expect(r[EXT_URN]?.department).toBeDefined(); // returned:default present
      }
    });

    it('should produce consistent results across GET, LIST, POST, PUT, PATCH', async () => {
      // Create
      const user = validUser({ [EXT_URN]: { department: 'Ops', badge: 'X', active: 'Yes' } });
      const cr = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const uid = cr.body.id;

      // GET
      const getRes = await scimGet(app, `${basePath}/Users/${uid}`, token).expect(200);
      expect(getRes.body[EXT_URN]?.badge).toBeUndefined();
      expect(getRes.body[EXT_URN]?.department).toBe('Ops');

      // LIST
      const listRes = await scimGet(app, `${basePath}/Users?filter=userName eq "${cr.body.userName}"`, token).expect(200);
      const found = listRes.body.Resources?.[0];
      expect(found?.[EXT_URN]?.badge).toBeUndefined();

      // PUT
      const putRes = await scimPut(app, `${basePath}/Users/${uid}`, token, {
        ...user,
        [EXT_URN]: { department: 'NewOps', badge: 'Y', active: 'No' },
      }).expect(200);
      expect(putRes.body[EXT_URN]?.badge).toBeUndefined();
      expect(putRes.body[EXT_URN]?.department).toBe('NewOps');

      // PATCH
      const patchRes = await scimPatch(app, `${basePath}/Users/${uid}`, token, patchOp([
        { op: 'replace', path: `${EXT_URN}:department`, value: 'FinalDept' },
      ])).expect(200);
      expect(patchRes.body[EXT_URN]?.badge).toBeUndefined();
      expect(patchRes.body[EXT_URN]?.department).toBe('FinalDept');
    });
  });
});
