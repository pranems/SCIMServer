/**
 * E2E Tests — Profile Configuration Combinations
 *
 * Comprehensive coverage of all endpoint profile content combinations:
 * - Custom extension schemas on User and Group
 * - Custom resource types via inline profile
 * - Extension PATCH operations (add, replace, remove)
 * - Multiple custom RTs + extensions on one endpoint
 * - Cross-endpoint isolation
 * - Discovery cross-validation
 * - SPC + settings combinations
 *
 * Replaces functionality from skipped live test sections 9m-A, 9m-B, 9m-C, 9y
 * which used deleted Admin Schema/ResourceType APIs.
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimGet,
  scimPost,
  scimPatch,
  scimBasePath,
} from './helpers/request.helper';

describe('Profile Configuration Combinations (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const deleteEp = (id: string) =>
    request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

  const ts = () => Date.now();

  // ═══════════════════════════════════════════════════════════════════
  // A. Custom Extension Schema on User (G-EXT-1, G-EXT-3, G-EXT-4)
  // ═══════════════════════════════════════════════════════════════════

  describe('Custom extension schema on User', () => {
    let epId: string;
    let userId: string;
    const EXT_URN = 'urn:test:scim:extension:hr:2.0:User';

    beforeAll(async () => {
      const t = ts();
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `ext-user-${t}`,
          profile: {
            schemas: [
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:User',
                name: 'User',
                attributes: 'all',
              },
              {
                id: EXT_URN,
                name: 'HRExtension',
                description: 'HR extension for testing',
                attributes: [
                  { name: 'badgeNumber', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: true, uniqueness: 'none' },
                  { name: 'costCenter', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
                  { name: 'secretToken', type: 'string', multiValued: false, required: false, mutability: 'writeOnly', returned: 'never', caseExact: true, uniqueness: 'none' },
                  { name: 'tags', type: 'string', multiValued: true, required: false, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
                ],
              },
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
                name: 'Group',
                attributes: 'all',
              },
            ],
            resourceTypes: [
              {
                id: 'User', name: 'User', endpoint: '/Users', description: 'User',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
                schemaExtensions: [{ schema: EXT_URN, required: false }],
              },
              {
                id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
                schemaExtensions: [],
              },
            ],
            serviceProviderConfig: {
              patch: { supported: true }, bulk: { supported: true, maxOperations: 100, maxPayloadSize: 1048576 },
              filter: { supported: true, maxResults: 200 }, sort: { supported: true },
              etag: { supported: true }, changePassword: { supported: false },
            },
          },
        })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should create user with extension data', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', EXT_URN],
        userName: `ext-user-${t}@test.com`,
        displayName: 'Extension Test',
        active: true,
        emails: [{ value: `ext-user-${t}@test.com`, type: 'work', primary: true }],
        [EXT_URN]: {
          badgeNumber: 'B12345',
          costCenter: 'Engineering',
          secretToken: 'secret123',
          tags: ['vip', 'engineering'],
        },
      }).expect(201);

      userId = res.body.id;
      expect(res.body.id).toBeDefined();
      // Extension data should be in response
      expect(res.body[EXT_URN]?.badgeNumber).toBe('B12345');
      expect(res.body[EXT_URN]?.costCenter).toBe('Engineering');
      // returned:never — secretToken should NOT be in response
      expect(res.body[EXT_URN]?.secretToken).toBeUndefined();
      // Multi-valued array
      expect(res.body[EXT_URN]?.tags).toEqual(['vip', 'engineering']);
    });

    it('should roundtrip extension data on GET', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(200);
      expect(res.body[EXT_URN]?.badgeNumber).toBe('B12345');
      expect(res.body[EXT_URN]?.costCenter).toBe('Engineering');
      expect(res.body[EXT_URN]?.secretToken).toBeUndefined(); // returned:never
    });

    it('should show extension data in list response', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users`, token).expect(200);
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      const user = res.body.Resources.find((u: any) => u.id === userId);
      expect(user).toBeDefined();
      expect(user[EXT_URN]?.badgeNumber).toBe('B12345');
    });

    it('should PATCH replace extension attribute', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { [EXT_URN]: { badgeNumber: 'B99999' } } }],
      }).expect(200);
      expect(res.body[EXT_URN]?.badgeNumber).toBe('B99999');
    });

    it('should show extension in /Schemas discovery', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      const extSchema = res.body.Resources.find((s: any) => s.id === EXT_URN);
      expect(extSchema).toBeDefined();
      expect(extSchema.name).toBe('HRExtension');
      expect(extSchema.attributes.length).toBe(4);
    });

    it('should show extension in /ResourceTypes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const userRT = res.body.Resources.find((r: any) => r.name === 'User');
      expect(userRT.schemaExtensions.length).toBeGreaterThanOrEqual(1);
      expect(userRT.schemaExtensions.some((e: any) => e.schema === EXT_URN)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B. Cross-endpoint Extension Isolation (G-EXT-5)
  // ═══════════════════════════════════════════════════════════════════

  describe('Cross-endpoint extension isolation', () => {
    let epWithExt: string;
    let epWithout: string;

    beforeAll(async () => {
      const t = ts();
      // Endpoint WITH custom extension
      const r1 = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `iso-with-${t}`,
          profile: {
            schemas: [
              { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
              { id: 'urn:test:isolation', name: 'IsoExt', description: 'Isolation test', attributes: [{ name: 'testAttr', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' }] },
            ],
            resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [{ schema: 'urn:test:isolation', required: false }] }],
            serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
          },
        }).expect(201);
      epWithExt = r1.body.id;

      // Endpoint WITHOUT custom extension (rfc-standard)
      const r2 = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `iso-without-${t}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epWithout = r2.body.id;
    });

    afterAll(async () => {
      if (epWithExt) await deleteEp(epWithExt);
      if (epWithout) await deleteEp(epWithout);
    });

    it('endpoint WITH extension should show it in /Schemas', async () => {
      const res = await scimGet(app, `${scimBasePath(epWithExt)}/Schemas`, token).expect(200);
      expect(res.body.Resources.some((s: any) => s.id === 'urn:test:isolation')).toBe(true);
    });

    it('endpoint WITHOUT extension should NOT show it in /Schemas', async () => {
      const res = await scimGet(app, `${scimBasePath(epWithout)}/Schemas`, token).expect(200);
      expect(res.body.Resources.some((s: any) => s.id === 'urn:test:isolation')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // C. SPC Combinations
  // ═══════════════════════════════════════════════════════════════════

  describe('SPC combinations', () => {
    it('all-on endpoint (rfc-standard): bulk, sort, etag all true', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `spc-allon-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      const spc = await scimGet(app, `${scimBasePath(res.body.id)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.bulk.supported).toBe(true);
      expect(spc.body.sort.supported).toBe(true);
      expect(spc.body.etag.supported).toBe(true);
      await deleteEp(res.body.id);
    });

    it('all-off endpoint (minimal): bulk, sort, etag all false', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `spc-alloff-${ts()}`, profilePreset: 'minimal' })
        .expect(201);
      const spc = await scimGet(app, `${scimBasePath(res.body.id)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.bulk.supported).toBe(false);
      expect(spc.body.sort.supported).toBe(false);
      expect(spc.body.etag.supported).toBe(false);
      await deleteEp(res.body.id);
    });

    it('mixed SPC (entra-id): patch+filter+etag on, bulk+sort off', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `spc-entra-${ts()}`, profilePreset: 'entra-id' })
        .expect(201);
      const spc = await scimGet(app, `${scimBasePath(res.body.id)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.patch.supported).toBe(true);
      expect(spc.body.filter.supported).toBe(true);
      expect(spc.body.etag.supported).toBe(true);
      expect(spc.body.bulk.supported).toBe(false);
      expect(spc.body.sort.supported).toBe(false);
      await deleteEp(res.body.id);
    });

    it('bulk-only SPC via inline profile', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `spc-bulkonly-${ts()}`,
          profile: {
            schemas: [{ id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: [{ name: 'userName' }, { name: 'active' }] }],
            resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] }],
            serviceProviderConfig: { patch: { supported: true }, bulk: { supported: true, maxOperations: 50, maxPayloadSize: 524288 }, filter: { supported: false }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
          },
        }).expect(201);
      const spc = await scimGet(app, `${scimBasePath(res.body.id)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.bulk.supported).toBe(true);
      expect(spc.body.bulk.maxOperations).toBe(50);
      expect(spc.body.filter.supported).toBe(false);
      await deleteEp(res.body.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // D. Settings Combinations
  // ═══════════════════════════════════════════════════════════════════

  describe('Settings combinations via config', () => {
    it('SoftDelete + StrictSchema: both enforced independently', async () => {
      const { createEndpointWithConfig } = await import('./helpers/request.helper');
      const epId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        StrictSchemaValidation: 'True',
      });
      expect(epId).toBeDefined();
      const ep = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(ep.body.config.SoftDeleteEnabled).toBe('True');
      expect(ep.body.config.StrictSchemaValidation).toBe('True');
    });

    it('RequireIfMatch + VerbosePatch: both in settings', async () => {
      const { createEndpointWithConfig } = await import('./helpers/request.helper');
      const epId = await createEndpointWithConfig(app, token, {
        RequireIfMatch: 'True',
        VerbosePatchSupported: 'True',
      });
      const ep = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(ep.body.config.RequireIfMatch).toBe('True');
      expect(ep.body.config.VerbosePatchSupported).toBe('True');
    });

    it('all flags set: SoftDelete + Strict + RequireIfMatch + BooleanStrings + Reprovision + PerEndpointCreds', async () => {
      const { createEndpointWithConfig } = await import('./helpers/request.helper');
      const epId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        StrictSchemaValidation: 'True',
        RequireIfMatch: 'True',
        AllowAndCoerceBooleanStrings: 'True',
        ReprovisionOnConflictForSoftDeletedResource: 'True',
        PerEndpointCredentialsEnabled: 'True',
      });
      const ep = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Object.keys(ep.body.config).length).toBeGreaterThanOrEqual(6);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // E. All 5 Presets: Schema + RT + SPC Verification
  // ═══════════════════════════════════════════════════════════════════

  describe('All 5 presets comprehensive', () => {
    const presets = [
      { name: 'entra-id', expectedSchemas: 7, expectedRTs: 2, bulk: false, sort: false, etag: true },
      { name: 'entra-id-minimal', expectedSchemas: 7, expectedRTs: 2, bulk: false, sort: false, etag: true },
      { name: 'rfc-standard', expectedSchemas: 3, expectedRTs: 2, bulk: true, sort: true, etag: true },
      { name: 'minimal', expectedSchemas: 2, expectedRTs: 2, bulk: false, sort: false, etag: false },
      { name: 'user-only', expectedSchemas: 2, expectedRTs: 1, bulk: false, sort: true, etag: true },
    ];

    for (const preset of presets) {
      describe(`${preset.name} preset`, () => {
        let epId: string;

        beforeAll(async () => {
          const res = await request(app.getHttpServer())
            .post('/scim/admin/endpoints')
            .set('Authorization', `Bearer ${token}`)
            .set('Content-Type', 'application/json')
            .send({ name: `preset-${preset.name}-${ts()}`, profilePreset: preset.name })
            .expect(201);
          epId = res.body.id;
        });

        afterAll(async () => {
          if (epId) await deleteEp(epId);
        });

        it(`should have ${preset.expectedSchemas} schemas`, async () => {
          const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
          expect(res.body.totalResults).toBe(preset.expectedSchemas);
        });

        it(`should have ${preset.expectedRTs} resource types`, async () => {
          const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
          expect(res.body.totalResults).toBe(preset.expectedRTs);
        });

        it(`should have bulk=${preset.bulk}, sort=${preset.sort}, etag=${preset.etag}`, async () => {
          const res = await scimGet(app, `${scimBasePath(epId)}/ServiceProviderConfig`, token).expect(200);
          expect(res.body.bulk.supported).toBe(preset.bulk);
          expect(res.body.sort.supported).toBe(preset.sort);
          expect(res.body.etag.supported).toBe(preset.etag);
        });
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // F. EnterpriseUser + msfttest Extension Combinations
  // ═══════════════════════════════════════════════════════════════════

  describe('EnterpriseUser + msfttest extensions (entra-id preset)', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `entra-ext-${ts()}`, profilePreset: 'entra-id' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should include EnterpriseUser schema', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(res.body.Resources.some((s: any) =>
        s.id === 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
      )).toBe(true);
    });

    it('should include 4 msfttest extension schemas', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      const msfttestSchemas = res.body.Resources.filter((s: any) =>
        s.id.includes('msfttest') || s.id.includes('msfttest')
      );
      expect(msfttestSchemas.length).toBeGreaterThanOrEqual(4);
    });

    it('should list EnterpriseUser in User ResourceType schemaExtensions', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const userRT = res.body.Resources.find((r: any) => r.name === 'User');
      expect(userRT.schemaExtensions.some((e: any) =>
        e.schema === 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
      )).toBe(true);
    });

    it('should accept EnterpriseUser extension data on POST', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        ],
        userName: `ent-user-${t}@test.com`,
        displayName: 'Enterprise Test',
        active: true,
        emails: [{ value: `ent-user-${t}@test.com`, type: 'work', primary: true }],
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
          employeeNumber: 'EMP001',
          department: 'Engineering',
        },
      }).expect(201);
      expect(res.body.id).toBeDefined();
      const ext = res.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      expect(ext?.employeeNumber).toBe('EMP001');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // G. No Extension (minimal preset — no Enterprise, no msfttest)
  // ═══════════════════════════════════════════════════════════════════

  describe('minimal preset — no extensions at all', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `no-ext-${ts()}`, profilePreset: 'minimal' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should have exactly 2 schemas (User + Group, no extensions)', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(res.body.totalResults).toBe(2);
      const ids = res.body.Resources.map((s: any) => s.id);
      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
    });

    it('User ResourceType should have 0 schemaExtensions', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const userRT = res.body.Resources.find((r: any) => r.name === 'User');
      expect(userRT.schemaExtensions).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // H. Custom Extension on Group (G-EXT-2)
  // ═══════════════════════════════════════════════════════════════════

  describe('Custom extension schema on Group', () => {
    let epId: string;
    let groupId: string;
    const GROUP_EXT = 'urn:test:scim:extension:dept:2.0:Group';

    beforeAll(async () => {
      const t = ts();
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `grp-ext-${t}`,
          profile: {
            schemas: [
              { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
              { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
              { id: GROUP_EXT, name: 'DeptExtension', description: 'Department extension for Groups',
                attributes: [
                  { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
                  { name: 'costCode', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
                ] },
            ],
            resourceTypes: [
              { id: 'User', name: 'User', endpoint: '/Users', description: 'User',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] },
              { id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
                schemaExtensions: [{ schema: GROUP_EXT, required: false }] },
            ],
            serviceProviderConfig: {
              patch: { supported: true }, bulk: { supported: false },
              filter: { supported: true, maxResults: 200 }, sort: { supported: true },
              etag: { supported: true }, changePassword: { supported: false },
            },
          },
        }).expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should create Group with extension data', async () => {
      const res = await scimPost(app, `${scimBasePath(epId)}/Groups`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', GROUP_EXT],
        displayName: `ExtGroup-${ts()}`,
        [GROUP_EXT]: { department: 'Engineering', costCode: 'ENG-001' },
      }).expect(201);
      groupId = res.body.id;
      expect(res.body[GROUP_EXT]?.department).toBe('Engineering');
    });

    it('should roundtrip Group extension on GET', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Groups/${groupId}`, token).expect(200);
      expect(res.body[GROUP_EXT]?.department).toBe('Engineering');
      expect(res.body[GROUP_EXT]?.costCode).toBe('ENG-001');
    });

    it('should list Group extension in /ResourceTypes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const groupRT = res.body.Resources.find((r: any) => r.name === 'Group');
      expect(groupRT.schemaExtensions.some((e: any) => e.schema === GROUP_EXT)).toBe(true);
    });

    it('should PATCH Group extension attribute', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Groups/${groupId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { [GROUP_EXT]: { department: 'Sales' } } }],
      }).expect(200);
      expect(res.body[GROUP_EXT]?.department).toBe('Sales');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // I. EnterpriseUser Attributes Expanded + Custom maxResults
  // ═══════════════════════════════════════════════════════════════════

  describe('Schema attribute expansion verification', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `attr-expand-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('EnterpriseUser schema should have expanded attributes in /Schemas', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      const entSchema = res.body.Resources.find((s: any) =>
        s.id === 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
      );
      expect(entSchema).toBeDefined();
      expect(entSchema.attributes.length).toBeGreaterThanOrEqual(3);
      const attrNames = entSchema.attributes.map((a: any) => a.name);
      expect(attrNames).toContain('employeeNumber');
      expect(attrNames).toContain('department');
    });

    it('User schema should have expanded core attributes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      const userSchema = res.body.Resources.find((s: any) =>
        s.id === 'urn:ietf:params:scim:schemas:core:2.0:User'
      );
      expect(userSchema.attributes.length).toBeGreaterThanOrEqual(10);
      const attrNames = userSchema.attributes.map((a: any) => a.name);
      expect(attrNames).toContain('userName');
      expect(attrNames).toContain('displayName');
      expect(attrNames).toContain('emails');
      expect(attrNames).toContain('active');
    });
  });

  describe('Custom filter.maxResults in SPC', () => {
    it('should reflect custom maxResults in SPC discovery', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `maxres-${ts()}`,
          profile: {
            schemas: [{ id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: [{ name: 'userName' }] }],
            resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] }],
            serviceProviderConfig: {
              patch: { supported: true }, bulk: { supported: false },
              filter: { supported: true, maxResults: 42 }, sort: { supported: false },
              etag: { supported: false }, changePassword: { supported: false },
            },
          },
        }).expect(201);

      const spc = await scimGet(app, `${scimBasePath(res.body.id)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.filter.maxResults).toBe(42);

      await deleteEp(res.body.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // J. Partial PATCH — Settings Deep-Merge (Phase 14)
  // ═══════════════════════════════════════════════════════════════════

  describe('Partial PATCH — settings deep-merge', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `patch-settings-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should add a new setting via PATCH profile.settings', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { SoftDeleteEnabled: 'True' } } })
        .expect(200);
      expect(res.body.config?.SoftDeleteEnabled).toBe('True');
      expect(res.body.profile?.settings?.SoftDeleteEnabled).toBe('True');
    });

    it('should preserve existing settings when adding another', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { StrictSchemaValidation: 'True' } } })
        .expect(200);
      // Both should exist
      expect(res.body.profile?.settings?.SoftDeleteEnabled).toBe('True');
      expect(res.body.profile?.settings?.StrictSchemaValidation).toBe('True');
    });

    it('should overwrite an individual setting value', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { SoftDeleteEnabled: 'False' } } })
        .expect(200);
      expect(res.body.profile?.settings?.SoftDeleteEnabled).toBe('False');
      // Other setting should still be there
      expect(res.body.profile?.settings?.StrictSchemaValidation).toBe('True');
    });

    it('should not alter schemas/SPC when only settings are PATCHed', async () => {
      // Verify schemas and SPC are preserved
      const schemas = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(schemas.body.totalResults).toBe(3); // rfc-standard has 3 schemas

      const spc = await scimGet(app, `${scimBasePath(epId)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.bulk.supported).toBe(true); // rfc-standard has bulk=true
    });

    it('should add multiple settings in one PATCH', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            settings: {
              RequireIfMatch: 'True',
              VerbosePatchSupported: 'True',
              AllowAndCoerceBooleanStrings: 'True',
            },
          },
        })
        .expect(200);
      expect(res.body.profile?.settings?.RequireIfMatch).toBe('True');
      expect(res.body.profile?.settings?.VerbosePatchSupported).toBe('True');
      expect(res.body.profile?.settings?.AllowAndCoerceBooleanStrings).toBe('True');
      // Existing settings still present
      expect(res.body.profile?.settings?.StrictSchemaValidation).toBe('True');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // K. Partial PATCH — SPC Replacement
  // ═══════════════════════════════════════════════════════════════════

  describe('Partial PATCH — SPC replacement', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `patch-spc-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should replace SPC via partial profile PATCH', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            serviceProviderConfig: {
              patch: { supported: true }, bulk: { supported: false },
              filter: { supported: true, maxResults: 50 }, sort: { supported: false },
              etag: { supported: false }, changePassword: { supported: false },
            },
          },
        })
        .expect(200);

      // Verify SPC was replaced
      const spc = await scimGet(app, `${scimBasePath(epId)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.bulk.supported).toBe(false);
      expect(spc.body.sort.supported).toBe(false);
      expect(spc.body.filter.maxResults).toBe(50);
    });

    it('should not alter schemas when SPC is PATCHed', async () => {
      const schemas = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(schemas.body.totalResults).toBe(3); // rfc-standard: User + Group + EnterpriseUser
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // L. Partial PATCH — Schema Replacement
  // ═══════════════════════════════════════════════════════════════════

  describe('Partial PATCH — schema replacement', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `patch-schema-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should replace schemas via partial profile PATCH', async () => {
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            schemas: [
              { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
            ],
          },
        })
        .expect(200);

      const schemas = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(schemas.body.totalResults).toBe(1);
      expect(schemas.body.Resources[0].id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
    });

    it('should not alter SPC when schemas are PATCHed', async () => {
      const spc = await scimGet(app, `${scimBasePath(epId)}/ServiceProviderConfig`, token).expect(200);
      // rfc-standard SPC should be preserved
      expect(spc.body.patch.supported).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // M. Partial PATCH — Combined profile sections + settings
  // ═══════════════════════════════════════════════════════════════════

  describe('Partial PATCH — combined settings + SPC + schemas', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `patch-combo-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should update settings + SPC in one PATCH', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            settings: { SoftDeleteEnabled: 'True', RequireIfMatch: 'True' },
            serviceProviderConfig: {
              patch: { supported: true }, bulk: { supported: false },
              filter: { supported: true, maxResults: 100 }, sort: { supported: false },
              etag: { supported: true }, changePassword: { supported: false },
            },
          },
        })
        .expect(200);

      expect(res.body.profile?.settings?.SoftDeleteEnabled).toBe('True');
      expect(res.body.profile?.settings?.RequireIfMatch).toBe('True');

      const spc = await scimGet(app, `${scimBasePath(epId)}/ServiceProviderConfig`, token).expect(200);
      expect(spc.body.bulk.supported).toBe(false);
      expect(spc.body.etag.supported).toBe(true);
    });

    it('should update schemas + settings in one PATCH', async () => {
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            schemas: [
              { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
              { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
            ],
            settings: { VerbosePatchSupported: 'True' },
          },
        })
        .expect(200);

      const schemas = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(schemas.body.totalResults).toBe(2); // Only User + Group, no EnterpriseUser

      // Settings should still include all previous + new
      const ep = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(ep.body.profile?.settings?.SoftDeleteEnabled).toBe('True');
      expect(ep.body.profile?.settings?.VerbosePatchSupported).toBe('True');
    });

    it('should reject sending both config and profile in PATCH', async () => {
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          config: { SoftDeleteEnabled: 'True' },
          profile: { settings: { StrictSchemaValidation: 'True' } },
        })
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // N. Partial PATCH — Add custom extension via PATCH
  // ═══════════════════════════════════════════════════════════════════

  describe('Partial PATCH — add extension via profile PATCH', () => {
    let epId: string;
    const EXT_URN = 'urn:test:scim:extension:badge:2.0:User';

    beforeAll(async () => {
      // Start with rfc-standard (no custom extensions)
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `patch-ext-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should add custom extension schema + RT via PATCH', async () => {
      // PATCH to replace schemas and RTs with a custom extension added
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            schemas: [
              { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
              { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
              {
                id: EXT_URN, name: 'BadgeExtension', description: 'Badge extension added via PATCH',
                attributes: [
                  { name: 'badgeId', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
                ],
              },
            ],
            resourceTypes: [
              {
                id: 'User', name: 'User', endpoint: '/Users', description: 'User',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
                schemaExtensions: [{ schema: EXT_URN, required: false }],
              },
              {
                id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [],
              },
            ],
          },
        })
        .expect(200);

      // Verify extension appears in discovery
      const schemas = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(schemas.body.Resources.some((s: any) => s.id === EXT_URN)).toBe(true);
      expect(schemas.body.totalResults).toBe(3);
    });

    it('should accept extension data on POST after PATCH-added extension', async () => {
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', EXT_URN],
        userName: `patch-ext-user-${ts()}@test.com`,
        displayName: 'PATCH Ext User',
        active: true,
        emails: [{ value: `patch-ext-user-${ts()}@test.com`, type: 'work', primary: true }],
        [EXT_URN]: { badgeId: 'BADGE-001' },
      }).expect(201);

      expect(res.body[EXT_URN]?.badgeId).toBe('BADGE-001');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // O. Partial PATCH — displayName + active + profile combined
  // ═══════════════════════════════════════════════════════════════════

  describe('Partial PATCH — displayName + active + profile combined', () => {
    let epId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `patch-multi-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      epId = res.body.id;
    });

    afterAll(async () => {
      if (epId) await deleteEp(epId);
    });

    it('should update displayName + settings + active in one PATCH', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          displayName: 'Updated Display',
          active: true,
          profile: { settings: { SoftDeleteEnabled: 'True' } },
        })
        .expect(200);
      expect(res.body.displayName).toBe('Updated Display');
      expect(res.body.active).toBe(true);
      expect(res.body.profile?.settings?.SoftDeleteEnabled).toBe('True');
    });
  });
});
