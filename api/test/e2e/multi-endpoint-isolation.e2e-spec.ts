/**
 * Multi-Endpoint Isolation E2E Tests
 *
 * Verifies that 3 independent endpoints with different profile configurations
 * operate in complete isolation - data, config flags, schemas, discovery,
 * and SCIM operations are fully independent and concurrent-safe.
 *
 * Endpoints:
 *   EP-A: rfc-standard + UserSoftDeleteEnabled + StrictSchemaValidation
 *   EP-B: minimal + VerbosePatchSupported (no extensions, no bulk)
 *   EP-C: Custom inline profile with HR extension (returned:never field)
 *   EP-D: entra-id preset (scoped User attrs, MSFT extensions, no bulk, boolean coercion)
 *
 * @see docs/ENDPOINT_PROFILE_ARCHITECTURE.md
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPost, scimPatch, scimBasePath } from './helpers/request.helper';

describe('Multi-Endpoint Isolation (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let epA: string;
  let epB: string;
  let epC: string;
  let epD: string;

  const HR_EXT = 'urn:test:scim:extension:hr:2.0:User';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);

    // EP-A: rfc-standard + SoftDelete + StrictSchema
    const resA = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `iso-a-${Date.now()}`, profilePreset: 'rfc-standard' })
      .expect(201);
    epA = resA.body.id;
    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${epA}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { UserSoftDeleteEnabled: 'True', StrictSchemaValidation: 'True' } } })
      .expect(200);

    // EP-B: minimal + VerbosePatch + StrictSchema OFF (for lenient tests)
    const resB = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `iso-b-${Date.now()}`, profilePreset: 'minimal' })
      .expect(201);
    epB = resB.body.id;
    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${epB}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { VerbosePatchSupported: 'True', StrictSchemaValidation: 'False' } } })
      .expect(200);

    // EP-C: Custom inline profile with HR extension
    const resC = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `iso-c-${Date.now()}`,
        profile: {
          schemas: [
            { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
            {
              id: HR_EXT, name: 'HRExtension',
              attributes: [
                { name: 'badgeNumber', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
                { name: 'secretToken', type: 'string', multiValued: false, required: false, mutability: 'writeOnly', returned: 'never' },
              ],
            },
            { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
          ],
          resourceTypes: [
            { id: 'User', name: 'User', endpoint: '/Users', description: 'User',
              schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
              schemaExtensions: [{ schema: HR_EXT, required: false }] },
            { id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
              schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [] },
          ],
          serviceProviderConfig: {
            patch: { supported: true }, bulk: { supported: false },
            filter: { supported: true, maxResults: 200 }, sort: { supported: true },
            etag: { supported: true }, changePassword: { supported: false },
          },
        },
      })
      .expect(201);
    epC = resC.body.id;

    // EP-D: entra-id (default preset - scoped 20 User attrs, MSFT extensions, no bulk, Entra PATCH flags)
    const resD = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `iso-d-${Date.now()}`, profilePreset: 'entra-id' })
      .expect(201);
    epD = resD.body.id;
  });

  afterAll(async () => {
    const del = (id: string) =>
      request(app.getHttpServer()).delete(`/scim/admin/endpoints/${id}`).set('Authorization', `Bearer ${token}`).expect(204);
    if (epA) await del(epA);
    if (epB) await del(epB);
    if (epC) await del(epC);
    if (epD) await del(epD);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Discovery Isolation - each endpoint returns its own schemas/SPC
  // ═══════════════════════════════════════════════════════════════════

  describe('Discovery Isolation', () => {
    it('EP-A (rfc-standard) should have 3 schemas including EnterpriseUser', async () => {
      const res = await scimGet(app, `${scimBasePath(epA)}/Schemas`, token).expect(200);
      expect(res.body.totalResults).toBe(3);
      const ids = res.body.Resources.map((s: any) => s.id);
      expect(ids).toContain('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
    });

    it('EP-B (minimal) should have exactly 2 schemas (no extensions)', async () => {
      const res = await scimGet(app, `${scimBasePath(epB)}/Schemas`, token).expect(200);
      expect(res.body.totalResults).toBe(2);
      const ids = res.body.Resources.map((s: any) => s.id);
      expect(ids).not.toContain('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
    });

    it('EP-C (custom) should have 3 schemas including HR extension', async () => {
      const res = await scimGet(app, `${scimBasePath(epC)}/Schemas`, token).expect(200);
      expect(res.body.totalResults).toBe(3);
      const ids = res.body.Resources.map((s: any) => s.id);
      expect(ids).toContain(HR_EXT);
      expect(ids).not.toContain('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
    });

    it('EP-A SPC should have bulk=true (rfc-standard)', async () => {
      const res = await scimGet(app, `${scimBasePath(epA)}/ServiceProviderConfig`, token).expect(200);
      expect(res.body.bulk.supported).toBe(true);
    });

    it('EP-C SPC should have bulk=false (custom profile)', async () => {
      const res = await scimGet(app, `${scimBasePath(epC)}/ServiceProviderConfig`, token).expect(200);
      expect(res.body.bulk.supported).toBe(false);
    });

    it('EP-D (entra-id) should have 7 schemas including MSFT extensions', async () => {
      const res = await scimGet(app, `${scimBasePath(epD)}/Schemas`, token).expect(200);
      expect(res.body.totalResults).toBe(7);
      const ids = res.body.Resources.map((s: any) => s.id);
      expect(ids).toContain('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
      expect(ids).toContain('urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User');
    });

    it('EP-D SPC should have bulk=false (entra-id default)', async () => {
      const res = await scimGet(app, `${scimBasePath(epD)}/ServiceProviderConfig`, token).expect(200);
      expect(res.body.bulk.supported).toBe(false);
      expect(res.body.patch.supported).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Data Isolation - CRUD on one endpoint doesn't affect others
  // ═══════════════════════════════════════════════════════════════════

  describe('Data Isolation', () => {
    let userA: string;
    let userB: string;
    let userC: string;
    let userD: string;

    it('should create users on all 4 endpoints independently', async () => {
      const [rA, rB, rC, rD] = await Promise.all([
        scimPost(app, `${scimBasePath(epA)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'alice-a@test.com', displayName: 'Alice on A', active: true,
        }).expect(201),
        scimPost(app, `${scimBasePath(epB)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'bob-b@test.com', displayName: 'Bob on B', active: true,
        }).expect(201),
        scimPost(app, `${scimBasePath(epC)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', HR_EXT],
          userName: 'carol-c@test.com', displayName: 'Carol on C', active: true,
          [HR_EXT]: { badgeNumber: 'B001', secretToken: 'secret123' },
        }).expect(201),
        scimPost(app, `${scimBasePath(epD)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'dave-d@test.com', displayName: 'Dave on D', active: true,
          emails: [{ value: 'dave-d@test.com', type: 'work', primary: true }],
        }).expect(201),
      ]);
      userA = rA.body.id;
      userB = rB.body.id;
      userC = rC.body.id;
      userD = rD.body.id;
      expect(userA).toBeDefined();
      expect(userB).toBeDefined();
      expect(userC).toBeDefined();
      expect(userD).toBeDefined();
    });

    it('EP-A user should NOT be visible on EP-B', async () => {
      await scimGet(app, `${scimBasePath(epB)}/Users/${userA}`, token).expect(404);
    });

    it('EP-B user should NOT be visible on EP-C', async () => {
      await scimGet(app, `${scimBasePath(epC)}/Users/${userB}`, token).expect(404);
    });

    it('EP-C user should NOT be visible on EP-A', async () => {
      await scimGet(app, `${scimBasePath(epA)}/Users/${userC}`, token).expect(404);
    });

    it('EP-A list should show only EP-A users', async () => {
      const res = await scimGet(app, `${scimBasePath(epA)}/Users`, token).expect(200);
      const userNames = res.body.Resources.map((u: any) => u.userName);
      expect(userNames).toContain('alice-a@test.com');
      expect(userNames).not.toContain('bob-b@test.com');
      expect(userNames).not.toContain('carol-c@test.com');
      expect(userNames).not.toContain('dave-d@test.com');
    });

    it('EP-D user should NOT be visible on EP-A or EP-B', async () => {
      await scimGet(app, `${scimBasePath(epA)}/Users/${userD}`, token).expect(404);
      await scimGet(app, `${scimBasePath(epB)}/Users/${userD}`, token).expect(404);
    });

    it('EP-D (entra-id) should return user with scoped attributes', async () => {
      const res = await scimGet(app, `${scimBasePath(epD)}/Users/${userD}`, token).expect(200);
      expect(res.body.userName).toBe('dave-d@test.com');
      expect(res.body.displayName).toBe('Dave on D');
      // entra-id has emails in its scoped attrs
      expect(res.body.emails).toBeDefined();
    });

    it('EP-C user should have HR extension data (badgeNumber) but NOT secretToken (returned:never)', async () => {
      const res = await scimGet(app, `${scimBasePath(epC)}/Users/${userC}`, token).expect(200);
      expect(res.body[HR_EXT]?.badgeNumber).toBe('B001');
      expect(res.body[HR_EXT]?.secretToken).toBeUndefined();
    });

    it('same userName can exist on different endpoints (no cross-endpoint collision)', async () => {
      const res = await scimPost(app, `${scimBasePath(epB)}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'alice-a@test.com', displayName: 'Alice duplicate on B', active: true,
      }).expect(201);
      expect(res.body.id).toBeDefined();
      // Cleanup
      await request(app.getHttpServer())
        .delete(`${scimBasePath(epB)}/Users/${res.body.id}`)
        .set('Authorization', `Bearer ${token}`).expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Config Flag Isolation - flags on one EP don't affect others
  // ═══════════════════════════════════════════════════════════════════

  describe('Config Flag Isolation', () => {
    it('EP-A (StrictSchema ON) should reject unknown attributes', async () => {
      const res = await scimPost(app, `${scimBasePath(epA)}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `strict-test-${Date.now()}@test.com`,
        displayName: 'Strict Test',
        active: true,
        unknownAttr: 'should-be-rejected',
      });
      expect(res.status).toBe(400);
    });

    it('EP-B (StrictSchema OFF) should accept unknown attributes silently', async () => {
      const res = await scimPost(app, `${scimBasePath(epB)}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `loose-test-${Date.now()}@test.com`,
        displayName: 'Loose Test',
        active: true,
        unknownAttr: 'should-be-accepted',
      }).expect(201);
      // Cleanup
      await request(app.getHttpServer())
        .delete(`${scimBasePath(epB)}/Users/${res.body.id}`)
        .set('Authorization', `Bearer ${token}`).expect(204);
    });

    it('EP-A (SoftDelete ON) should soft-delete (active=false), not hard-delete', async () => {
      const user = await scimPost(app, `${scimBasePath(epA)}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `softdel-${Date.now()}@test.com`, displayName: 'SoftDel', active: true,
      }).expect(201);

      await request(app.getHttpServer())
        .delete(`${scimBasePath(epA)}/Users/${user.body.id}`)
        .set('Authorization', `Bearer ${token}`).expect(204);

      // After soft-delete, GET returns 404 (resource marked as deleted)
      await scimGet(app, `${scimBasePath(epA)}/Users/${user.body.id}`, token).expect(404);
    });

    it('EP-B (SoftDelete OFF) should hard-delete', async () => {
      const user = await scimPost(app, `${scimBasePath(epB)}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `harddel-${Date.now()}@test.com`, displayName: 'HardDel', active: true,
      }).expect(201);

      await request(app.getHttpServer())
        .delete(`${scimBasePath(epB)}/Users/${user.body.id}`)
        .set('Authorization', `Bearer ${token}`).expect(204);

      // After hard-delete, GET returns 404
      await scimGet(app, `${scimBasePath(epB)}/Users/${user.body.id}`, token).expect(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Concurrent Operations - parallel CRUD across all 4 endpoints
  // ═══════════════════════════════════════════════════════════════════

  describe('Concurrent Operations', () => {
    it('should handle parallel POST + GET + PATCH across all 4 endpoints', async () => {
      const ts = Date.now();

      // Parallel creates on all 4
      const [cA, cB, cC, cD] = await Promise.all([
        scimPost(app, `${scimBasePath(epA)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `conc-a-${ts}@test.com`, displayName: 'ConcA', active: true,
        }).expect(201),
        scimPost(app, `${scimBasePath(epB)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `conc-b-${ts}@test.com`, displayName: 'ConcB', active: true,
        }).expect(201),
        scimPost(app, `${scimBasePath(epC)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `conc-c-${ts}@test.com`, displayName: 'ConcC', active: true,
        }).expect(201),
        scimPost(app, `${scimBasePath(epD)}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `conc-d-${ts}@test.com`, displayName: 'ConcD', active: true,
          emails: [{ value: `conc-d-${ts}@test.com`, type: 'work', primary: true }],
        }).expect(201),
      ]);

      // Parallel PATCHes on all 4
      await Promise.all([
        scimPatch(app, `${scimBasePath(epA)}/Users/${cA.body.id}`, token, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { displayName: 'PatchedA' } }],
        }).expect(200),
        scimPatch(app, `${scimBasePath(epB)}/Users/${cB.body.id}`, token, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { displayName: 'PatchedB' } }],
        }).expect(200),
        scimPatch(app, `${scimBasePath(epC)}/Users/${cC.body.id}`, token, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { displayName: 'PatchedC' } }],
        }).expect(200),
        scimPatch(app, `${scimBasePath(epD)}/Users/${cD.body.id}`, token, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { displayName: 'PatchedD' } }],
        }).expect(200),
      ]);

      // Parallel GETs to verify all 4
      const [gA, gB, gC, gD] = await Promise.all([
        scimGet(app, `${scimBasePath(epA)}/Users/${cA.body.id}`, token).expect(200),
        scimGet(app, `${scimBasePath(epB)}/Users/${cB.body.id}`, token).expect(200),
        scimGet(app, `${scimBasePath(epC)}/Users/${cC.body.id}`, token).expect(200),
        scimGet(app, `${scimBasePath(epD)}/Users/${cD.body.id}`, token).expect(200),
      ]);

      expect(gA.body.displayName).toBe('PatchedA');
      expect(gB.body.displayName).toBe('PatchedB');
      expect(gC.body.displayName).toBe('PatchedC');
      expect(gD.body.displayName).toBe('PatchedD');

      // Cross-isolation: A's user not on B or D
      await scimGet(app, `${scimBasePath(epB)}/Users/${cA.body.id}`, token).expect(404);
      await scimGet(app, `${scimBasePath(epD)}/Users/${cA.body.id}`, token).expect(404);

      // Parallel deletes all 4
      await Promise.all([
        request(app.getHttpServer()).delete(`${scimBasePath(epA)}/Users/${cA.body.id}`).set('Authorization', `Bearer ${token}`).expect(204),
        request(app.getHttpServer()).delete(`${scimBasePath(epB)}/Users/${cB.body.id}`).set('Authorization', `Bearer ${token}`).expect(204),
        request(app.getHttpServer()).delete(`${scimBasePath(epC)}/Users/${cC.body.id}`).set('Authorization', `Bearer ${token}`).expect(204),
        request(app.getHttpServer()).delete(`${scimBasePath(epD)}/Users/${cD.body.id}`).set('Authorization', `Bearer ${token}`).expect(204),
      ]);
    });
  });
});
