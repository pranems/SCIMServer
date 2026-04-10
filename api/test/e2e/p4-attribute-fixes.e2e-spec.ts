import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * P4 Attribute Characteristic Fixes — E2E
 *
 * Tests for the 3 actionable items from the P4 deep analysis:
 *   SEC-1: GenericPatchEngine prototype pollution guard
 *   G3:    Generic filter caseExactAttrs pass-through
 *
 * Uses a custom resource type (Devices) exercising the generic service path.
 */
describe('P4 — Attribute Characteristic Fixes (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  const SCHEMA_URN = 'urn:example:params:scim:schemas:custom:2.0:Device';
  const RESOURCE_TYPE = 'Devices';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    resetFixtureCounter();

    // Create endpoint with custom Device resource type
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `p4-fixes-test-${Date.now()}`,
        displayName: 'P4 Fixes Test Endpoint',
        profile: {
          schemas: [
            { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
            { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
            {
              id: SCHEMA_URN,
              name: 'Device',
              description: 'Custom device resource for P4 tests',
              attributes: [
                { name: 'deviceName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
                { name: 'serialNumber', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: true, uniqueness: 'none' },
                { name: 'status', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
              ],
            },
          ],
          resourceTypes: [
            { id: 'User', name: 'User', endpoint: '/Users', description: 'User Account', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] },
            { id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [] },
            { id: 'Device', name: 'Device', endpoint: `/${RESOURCE_TYPE}`, description: 'Device', schema: SCHEMA_URN, schemaExtensions: [] },
          ],
          serviceProviderConfig: {
            patch: { supported: true },
            bulk: { supported: false },
            filter: { supported: true, maxResults: 200 },
            changePassword: { supported: false },
            sort: { supported: true },
            etag: { supported: true },
          },
          settings: {},
        },
      })
      .expect(201);

    endpointId = res.body.id;
    basePath = `/scim/endpoints/${endpointId}/${RESOURCE_TYPE}`;
  });

  afterAll(async () => {
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await app.close();
  });

  // ─── SEC-1: Prototype Pollution Guard (GenericPatchEngine) ─────────

  describe('SEC-1 — GenericPatchEngine prototype pollution guard', () => {
    let deviceId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(basePath)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [SCHEMA_URN],
          deviceName: 'Pollution Test Device',
          serialNumber: 'SN-PROTO-001',
          status: 'active',
        })
        .expect(201);
      deviceId = res.body.id;
    });

    afterAll(async () => {
      if (deviceId) {
        await request(app.getHttpServer())
          .delete(`${basePath}/${deviceId}`)
          .set('Authorization', `Bearer ${token}`);
      }
    });

    it('should reject PATCH with __proto__ in path with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'add', path: '__proto__.polluted', value: true },
          ],
        })
        .expect(400);

      expect(res.body.detail).toContain('forbidden key');
    });

    it('should reject PATCH with constructor in path with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'constructor.name', value: 'Evil' },
          ],
        })
        .expect(400);

      expect(res.body.detail).toContain('forbidden key');
    });

    it('should reject PATCH with prototype in path with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'remove', path: 'prototype.isAdmin' },
          ],
        })
        .expect(400);

      expect(res.body.detail).toContain('forbidden key');
    });

    it('should still allow normal PATCH operations', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'status', value: 'retired' },
          ],
        })
        .expect(200);

      expect(res.body.status).toBe('retired');
    });
  });

  // ─── G3: Generic Filter caseExactAttrs Pass-Through ────────────────

  describe('G3 — Generic filter caseExactAttrs pass-through', () => {
    const createdIds: string[] = [];

    beforeAll(async () => {
      // Create 2 devices:
      // - serialNumber 'SN-CaseTest-ABC' (caseExact:true)
      // - serialNumber 'SN-CaseTest-abc' (different case)
      for (const sn of ['SN-CaseTest-ABC', 'SN-CaseTest-abc']) {
        const res = await request(app.getHttpServer())
          .post(basePath)
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', 'application/scim+json')
          .send({
            schemas: [SCHEMA_URN],
            deviceName: `Device ${sn}`,
            serialNumber: sn,
            status: 'active',
          })
          .expect(201);
        createdIds.push(res.body.id);
      }
    });

    afterAll(async () => {
      for (const id of createdIds) {
        await request(app.getHttpServer())
          .delete(`${basePath}/${id}`)
          .set('Authorization', `Bearer ${token}`);
      }
    });

    it('should filter caseExact:true attr (serialNumber) case-sensitively with eq', async () => {
      // serialNumber is caseExact:true — eq "SN-CaseTest-ABC" should match exactly 1
      const res = await request(app.getHttpServer())
        .get(`${basePath}?filter=${encodeURIComponent('serialNumber eq "SN-CaseTest-ABC"')}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].serialNumber).toBe('SN-CaseTest-ABC');
    });

    it('should not match different case for caseExact:true attr', async () => {
      // "SN-CASETEST-ABC" (all uppercase) should NOT match "SN-CaseTest-ABC"
      const res = await request(app.getHttpServer())
        .get(`${basePath}?filter=${encodeURIComponent('serialNumber eq "SN-CASETEST-ABC"')}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(0);
    });

    it('should filter caseExact:false attr (deviceName) case-insensitively', async () => {
      // deviceName is caseExact:false — "DEVICE SN-CASETEST-ABC" should match both
      // "Device SN-CaseTest-ABC" and "Device SN-CaseTest-abc" case-insensitively
      // (both lowercase to "device sn-casetest-abc")
      const res = await request(app.getHttpServer())
        .get(`${basePath}?filter=${encodeURIComponent('deviceName eq "DEVICE SN-CASETEST-ABC"')}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(2);
    });
  });
});
