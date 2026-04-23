/**
 * E2E Tests - Lexmark ISV Endpoint Profile
 *
 * Comprehensive tests for the Lexmark Cloud Print Management SCIM profile.
 * Lexmark-specific characteristics:
 *   - User-only (no Group resource type)
 *   - Core User: userName, name (givenName/familyName), displayName, preferredLanguage, active
 *   - EnterpriseUser extension (required): costCenter, department
 *   - Custom extension (optional): badgeCode (writeOnly/never), pin (writeOnly/never)
 *   - SPC: patch=true, bulk=false, filter=true(200), sort=true, etag=false, changePassword=false
 *   - Auth: OAuth 2.0
 *
 * Test coverage:
 *   A. Endpoint creation with lexmark preset
 *   B. Discovery endpoints (/Schemas, /ResourceTypes, /ServiceProviderConfig)
 *   C. User CRUD lifecycle
 *   D. EnterpriseUser extension operations
 *   E. Custom extension writeOnly/returned:never behavior
 *   F. PATCH operations (core + extensions)
 *   G. Filtering and list operations
 *   H. User-only isolation (no /Groups endpoint)
 *   I. PUT (replace) operations
 *   J. Negative / edge cases
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
  scimPut,
  scimDelete,
  scimBasePath,
} from './helpers/request.helper';

describe('Lexmark ISV Endpoint Profile (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let epId: string;

  const CORE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const ENTERPRISE_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
  const CUSTOM_URN = 'urn:ietf:params:scim:schemas:extension:custom:2.0:User';

  const ts = () => Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);

    // Create endpoint with Lexmark preset
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `lexmark-e2e-${ts()}`, profilePreset: 'lexmark' })
      .expect(201);
    epId = res.body.id;
  });

  afterAll(async () => {
    // Cleanup endpoint
    if (epId) {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    }
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════
  // A. Endpoint Creation with Lexmark Preset
  // ═══════════════════════════════════════════════════════════════════

  describe('Endpoint creation with lexmark preset', () => {
    it('should create endpoint with lexmark preset successfully', () => {
      expect(epId).toBeDefined();
    });

    it('should have profile with 3 schemas', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile).toBeDefined();
      expect(res.body.profile.schemas.length).toBe(3);
    });

    it('should have profile with 1 resource type (User only)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile.resourceTypes.length).toBe(1);
      expect(res.body.profile.resourceTypes[0].name).toBe('User');
    });

    it('should have SPC with correct Lexmark capabilities', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const spc = res.body.profile.serviceProviderConfig;
      expect(spc.patch.supported).toBe(true);
      expect(spc.bulk.supported).toBe(false);
      expect(spc.filter.supported).toBe(true);
      expect(spc.filter.maxResults).toBe(200);
      expect(spc.sort.supported).toBe(true);
      expect(spc.etag.supported).toBe(false);
      expect(spc.changePassword.supported).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B. Discovery Endpoints
  // ═══════════════════════════════════════════════════════════════════

  describe('Discovery endpoints', () => {
    it('should return 3 schemas from /Schemas', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas`, token).expect(200);
      expect(res.body.totalResults).toBe(3);
      const schemaIds = res.body.Resources.map((s: any) => s.id);
      expect(schemaIds).toContain(CORE_SCHEMA);
      expect(schemaIds).toContain(ENTERPRISE_URN);
      expect(schemaIds).toContain(CUSTOM_URN);
    });

    it('should return core User schema with correct attributes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas/${encodeURIComponent(CORE_SCHEMA)}`, token).expect(200);
      const attrNames = res.body.attributes.map((a: any) => a.name);
      expect(attrNames).toContain('userName');
      expect(attrNames).toContain('name');
      expect(attrNames).toContain('displayName');
      expect(attrNames).toContain('preferredLanguage');
      expect(attrNames).toContain('active');
    });

    it('should return EnterpriseUser schema with costCenter and department', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas/${encodeURIComponent(ENTERPRISE_URN)}`, token).expect(200);
      const attrNames = res.body.attributes.map((a: any) => a.name);
      expect(attrNames).toContain('costCenter');
      expect(attrNames).toContain('department');
      expect(res.body.attributes.length).toBe(2);
    });

    it('should return CustomUser schema with writeOnly/never attributes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Schemas/${encodeURIComponent(CUSTOM_URN)}`, token).expect(200);
      const attrNames = res.body.attributes.map((a: any) => a.name);
      expect(attrNames).toContain('badgeCode');
      expect(attrNames).toContain('pin');
      expect(res.body.attributes.length).toBe(2);

      // Verify writeOnly/never characteristics
      const badgeCode = res.body.attributes.find((a: any) => a.name === 'badgeCode');
      expect(badgeCode.mutability).toBe('writeOnly');
      expect(badgeCode.returned).toBe('never');
      const pin = res.body.attributes.find((a: any) => a.name === 'pin');
      expect(pin.mutability).toBe('writeOnly');
      expect(pin.returned).toBe('never');
    });

    it('should return 1 ResourceType (User)', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].name).toBe('User');
      expect(res.body.Resources[0].endpoint).toBe('/Users');
    });

    it('should show EnterpriseUser as required extension in ResourceTypes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const userRT = res.body.Resources[0];
      const enterpriseExt = userRT.schemaExtensions.find((e: any) => e.schema === ENTERPRISE_URN);
      expect(enterpriseExt).toBeDefined();
      expect(enterpriseExt.required).toBe(true);
    });

    it('should show CustomUser as optional extension in ResourceTypes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const userRT = res.body.Resources[0];
      const customExt = userRT.schemaExtensions.find((e: any) => e.schema === CUSTOM_URN);
      expect(customExt).toBeDefined();
      expect(customExt.required).toBe(false);
    });

    it('should return ServiceProviderConfig with correct Lexmark capabilities', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ServiceProviderConfig`, token).expect(200);
      expect(res.body.patch.supported).toBe(true);
      expect(res.body.bulk.supported).toBe(false);
      expect(res.body.filter.supported).toBe(true);
      expect(res.body.filter.maxResults).toBe(200);
      expect(res.body.sort.supported).toBe(true);
      expect(res.body.etag.supported).toBe(false);
      expect(res.body.changePassword.supported).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // C. User CRUD Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  describe('User CRUD lifecycle', () => {
    let userId: string;

    it('should create a user with core + enterprise extension', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN],
        userName: `lexuser-${t}@lexmark.com`,
        name: { givenName: 'Lex', familyName: 'User' },
        displayName: 'Lex User',
        preferredLanguage: 'en-US',
        active: true,
        [ENTERPRISE_URN]: {
          costCenter: 'CC-100',
          department: 'Engineering',
        },
      }).expect(201);

      userId = res.body.id;
      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBe(`lexuser-${t}@lexmark.com`);
      expect(res.body.displayName).toBe('Lex User');
      expect(res.body.active).toBe(true);
      expect(res.body.name.givenName).toBe('Lex');
      expect(res.body.name.familyName).toBe('User');
      expect(res.body[ENTERPRISE_URN]?.costCenter).toBe('CC-100');
      expect(res.body[ENTERPRISE_URN]?.department).toBe('Engineering');
    });

    it('should GET user by id', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(200);
      expect(res.body.id).toBe(userId);
      expect(res.body.displayName).toBe('Lex User');
      expect(res.body[ENTERPRISE_URN]?.costCenter).toBe('CC-100');
    });

    it('should list users', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users`, token).expect(200);
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      const user = res.body.Resources.find((u: any) => u.id === userId);
      expect(user).toBeDefined();
      expect(user.displayName).toBe('Lex User');
    });

    it('should DELETE user', async () => {
      await scimDelete(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(204);

      // Verify deleted
      await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // D. EnterpriseUser Extension Operations
  // ═══════════════════════════════════════════════════════════════════

  describe('EnterpriseUser extension operations', () => {
    let userId: string;

    beforeAll(async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN],
        userName: `ent-ext-${t}@lexmark.com`,
        displayName: 'Enterprise Ext User',
        active: true,
        [ENTERPRISE_URN]: {
          costCenter: 'CC-200',
          department: 'Sales',
        },
      }).expect(201);
      userId = res.body.id;
    });

    afterAll(async () => {
      if (userId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userId}`, token);
    });

    it('should return enterprise extension data on GET', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(200);
      expect(res.body[ENTERPRISE_URN]?.costCenter).toBe('CC-200');
      expect(res.body[ENTERPRISE_URN]?.department).toBe('Sales');
    });

    it('should PATCH replace enterprise costCenter', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{
          op: 'replace',
          value: { [ENTERPRISE_URN]: { costCenter: 'CC-300' } },
        }],
      }).expect(200);
      expect(res.body[ENTERPRISE_URN]?.costCenter).toBe('CC-300');
      // department should be preserved
      expect(res.body[ENTERPRISE_URN]?.department).toBe('Sales');
    });

    it('should PATCH replace enterprise department', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{
          op: 'replace',
          path: `${ENTERPRISE_URN}:department`,
          value: 'Marketing',
        }],
      }).expect(200);
      expect(res.body[ENTERPRISE_URN]?.department).toBe('Marketing');
    });

    it('should include enterprise extension in list response', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users`, token).expect(200);
      const user = res.body.Resources.find((u: any) => u.id === userId);
      expect(user[ENTERPRISE_URN]?.costCenter).toBe('CC-300');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // E. Custom Extension writeOnly/returned:never Behavior
  // ═══════════════════════════════════════════════════════════════════

  describe('Custom extension writeOnly/returned:never behavior', () => {
    let userId: string;
    let postResponseBody: any;

    beforeAll(async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN, CUSTOM_URN],
        userName: `custom-ext-${t}@lexmark.com`,
        displayName: 'Custom Ext User',
        active: true,
        [ENTERPRISE_URN]: {
          costCenter: 'CC-400',
          department: 'IT',
        },
        [CUSTOM_URN]: {
          badgeCode: 'BADGE-12345',
          pin: '9876',
        },
      }).expect(201);
      userId = res.body.id;
      postResponseBody = res.body;
    });

    afterAll(async () => {
      if (userId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userId}`, token);
    });

    it('should NOT return badgeCode in the POST 201 response body (returned:never)', () => {
      // Verify the actual POST 201 response - not a follow-up GET
      expect(postResponseBody.id).toBeDefined();
      expect(postResponseBody[CUSTOM_URN]?.badgeCode).toBeUndefined();
    });

    it('should NOT return pin in the POST 201 response body (returned:never)', () => {
      expect(postResponseBody[CUSTOM_URN]?.pin).toBeUndefined();
    });

    it('should omit custom extension URN from schemas[] when all attrs are returned:never (FP-1)', () => {
      // After FP-1 fix: extension with only writeOnly/never attrs should not appear
      expect(postResponseBody.schemas).not.toContain(CUSTOM_URN);
      expect(postResponseBody[CUSTOM_URN]).toBeUndefined();
    });

    it('should NOT return badgeCode in GET response (returned:never)', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(200);
      expect(res.body[CUSTOM_URN]?.badgeCode).toBeUndefined();
    });

    it('should NOT return pin in GET response (returned:never)', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(200);
      expect(res.body[CUSTOM_URN]?.pin).toBeUndefined();
    });

    it('should omit custom extension URN from GET response entirely (FP-1)', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(200);
      // Extension key itself should be absent - not present as {}
      expect(res.body[CUSTOM_URN]).toBeUndefined();
      expect(res.body.schemas).not.toContain(CUSTOM_URN);
    });

    it('should NOT return custom extension data in list response', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users`, token).expect(200);
      const user = res.body.Resources.find((u: any) => u.id === userId);
      expect(user).toBeDefined();
      // FP-1: Extension key itself should be absent when all attrs are returned:never
      expect(user[CUSTOM_URN]).toBeUndefined();
      expect(user.schemas).not.toContain(CUSTOM_URN);
    });

    it('should NOT return writeOnly attrs even with ?attributes= request', async () => {
      const res = await scimGet(
        app,
        `${scimBasePath(epId)}/Users/${userId}?attributes=${encodeURIComponent(`${CUSTOM_URN}:badgeCode`)}`,
        token,
      ).expect(200);
      // returned:never overrides attributes request
      expect(res.body[CUSTOM_URN]?.badgeCode).toBeUndefined();
      // FP-1: extension should not appear in schemas or body
      expect(res.body[CUSTOM_URN]).toBeUndefined();
    });

    it('should accept PATCH with writeOnly custom extension attributes', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{
          op: 'replace',
          value: { [CUSTOM_URN]: { badgeCode: 'BADGE-99999', pin: '1111' } },
        }],
      }).expect(200);
      // Updated but still not returned - FP-1: extension key itself absent
      expect(res.body[CUSTOM_URN]).toBeUndefined();
      expect(res.body.schemas).not.toContain(CUSTOM_URN);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // F. PATCH Operations (Core + Extensions)
  // ═══════════════════════════════════════════════════════════════════

  describe('PATCH operations', () => {
    let userId: string;

    beforeAll(async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN],
        userName: `patch-test-${t}@lexmark.com`,
        name: { givenName: 'Patch', familyName: 'Test' },
        displayName: 'Patch Test User',
        preferredLanguage: 'en-US',
        active: true,
        [ENTERPRISE_URN]: {
          costCenter: 'CC-500',
          department: 'HR',
        },
      }).expect(201);
      userId = res.body.id;
    });

    afterAll(async () => {
      if (userId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userId}`, token);
    });

    it('should PATCH replace displayName', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Updated Display' }],
      }).expect(200);
      expect(res.body.displayName).toBe('Updated Display');
    });

    it('should PATCH replace name.givenName', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { name: { givenName: 'NewGiven' } } }],
      }).expect(200);
      expect(res.body.name.givenName).toBe('NewGiven');
    });

    it('should PATCH replace active status', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }).expect(200);
      expect(res.body.active).toBe(false);
    });

    it('should PATCH replace preferredLanguage', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'preferredLanguage', value: 'de-DE' }],
      }).expect(200);
      expect(res.body.preferredLanguage).toBe('de-DE');
    });

    it('should PATCH multiple operations at once', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'active', value: true },
          { op: 'replace', path: 'displayName', value: 'Multi-Patched' },
          { op: 'replace', value: { [ENTERPRISE_URN]: { department: 'Finance' } } },
        ],
      }).expect(200);
      expect(res.body.active).toBe(true);
      expect(res.body.displayName).toBe('Multi-Patched');
      expect(res.body[ENTERPRISE_URN]?.department).toBe('Finance');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // G. Filtering and List Operations
  // ═══════════════════════════════════════════════════════════════════

  describe('Filtering and list operations', () => {
    let user1Id: string;
    let user2Id: string;

    beforeAll(async () => {
      const t = ts();
      const r1 = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN],
        userName: `filter-a-${t}@lexmark.com`,
        displayName: 'Filter Alpha',
        active: true,
        [ENTERPRISE_URN]: { costCenter: 'CC-FILTER', department: 'QA' },
      }).expect(201);
      user1Id = r1.body.id;

      const r2 = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN],
        userName: `filter-b-${t}@lexmark.com`,
        displayName: 'Filter Beta',
        active: false,
        [ENTERPRISE_URN]: { costCenter: 'CC-FILTER', department: 'Dev' },
      }).expect(201);
      user2Id = r2.body.id;
    });

    afterAll(async () => {
      if (user1Id) await scimDelete(app, `${scimBasePath(epId)}/Users/${user1Id}`, token);
      if (user2Id) await scimDelete(app, `${scimBasePath(epId)}/Users/${user2Id}`, token);
    });

    it('should filter by userName eq', async () => {
      const r1 = await scimGet(app, `${scimBasePath(epId)}/Users/${user1Id}`, token).expect(200);
      const userName = r1.body.userName;
      const res = await scimGet(
        app,
        `${scimBasePath(epId)}/Users?filter=${encodeURIComponent(`userName eq "${userName}"`)}`,
        token,
      ).expect(200);
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe(userName);
    });

    it('should filter by active eq true', async () => {
      const res = await scimGet(
        app,
        `${scimBasePath(epId)}/Users?filter=${encodeURIComponent('active eq true')}`,
        token,
      ).expect(200);
      const ids = res.body.Resources.map((r: any) => r.id);
      expect(ids).toContain(user1Id);
    });

    it('should filter by displayName co', async () => {
      const res = await scimGet(
        app,
        `${scimBasePath(epId)}/Users?filter=${encodeURIComponent('displayName co "Alpha"')}`,
        token,
      ).expect(200);
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.Resources.some((u: any) => u.id === user1Id)).toBe(true);
    });

    it('should support startIndex and count pagination', async () => {
      const res = await scimGet(
        app,
        `${scimBasePath(epId)}/Users?startIndex=1&count=1`,
        token,
      ).expect(200);
      expect(res.body.Resources.length).toBeLessThanOrEqual(1);
      expect(res.body.startIndex).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // H. User-Only Isolation (No /Groups Endpoint)
  // ═══════════════════════════════════════════════════════════════════

  describe('User-only isolation (no Groups)', () => {
    it('should return 404 or empty for GET /Groups', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Groups`, token);
      // User-only profiles may return 404 or empty list depending on implementation
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.totalResults).toBe(0);
      }
    });

    it('should not have Group resource type in discovery', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const groupRT = res.body.Resources.find((r: any) => r.name === 'Group');
      expect(groupRT).toBeUndefined();
    });

    it('should not list Group in ResourceTypes', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/ResourceTypes`, token).expect(200);
      const groupRT = res.body.Resources.find((r: any) => r.name === 'Group');
      expect(groupRT).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // I. PUT (Replace) Operations
  // ═══════════════════════════════════════════════════════════════════

  describe('PUT (replace) operations', () => {
    let userId: string;
    let userName: string;

    beforeAll(async () => {
      const t = ts();
      userName = `put-test-${t}@lexmark.com`;
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN],
        userName,
        name: { givenName: 'Put', familyName: 'Original' },
        displayName: 'Put Original',
        active: true,
        [ENTERPRISE_URN]: {
          costCenter: 'CC-PUT',
          department: 'Legal',
        },
      }).expect(201);
      userId = res.body.id;
    });

    afterAll(async () => {
      if (userId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userId}`, token);
    });

    it('should PUT replace entire user resource', async () => {
      const res = await scimPut(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN],
        userName,
        name: { givenName: 'Put', familyName: 'Replaced' },
        displayName: 'Put Replaced',
        active: true,
        preferredLanguage: 'fr-FR',
        [ENTERPRISE_URN]: {
          costCenter: 'CC-PUT-NEW',
          department: 'Finance',
        },
      }).expect(200);

      expect(res.body.displayName).toBe('Put Replaced');
      expect(res.body.name.familyName).toBe('Replaced');
      expect(res.body.preferredLanguage).toBe('fr-FR');
      expect(res.body[ENTERPRISE_URN]?.costCenter).toBe('CC-PUT-NEW');
      expect(res.body[ENTERPRISE_URN]?.department).toBe('Finance');
    });

    it('should preserve id and meta after PUT', async () => {
      const res = await scimGet(app, `${scimBasePath(epId)}/Users/${userId}`, token).expect(200);
      expect(res.body.id).toBe(userId);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('User');
    });

    it('should PUT with custom extension writeOnly data', async () => {
      const res = await scimPut(app, `${scimBasePath(epId)}/Users/${userId}`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN, CUSTOM_URN],
        userName,
        displayName: 'Put With Custom',
        active: true,
        [ENTERPRISE_URN]: { costCenter: 'CC-PUT', department: 'IT' },
        [CUSTOM_URN]: { badgeCode: 'NEW-BADGE', pin: '5555' },
      }).expect(200);

      // writeOnly/never attrs should NOT be returned
      expect(res.body[CUSTOM_URN]?.badgeCode).toBeUndefined();
      expect(res.body[CUSTOM_URN]?.pin).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // J. Negative / Edge Cases
  // ═══════════════════════════════════════════════════════════════════

  describe('Negative and edge cases', () => {
    it('should return 404 for non-existent user', async () => {
      await scimGet(app, `${scimBasePath(epId)}/Users/non-existent-id-12345`, token).expect(404);
    });

    it('should return 409 on duplicate userName POST', async () => {
      const t = ts();
      const userName = `dup-${t}@lexmark.com`;
      await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA],
        userName,
        displayName: 'Dup User 1',
        active: true,
      }).expect(201);

      const dup = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA],
        userName,
        displayName: 'Dup User 2',
        active: true,
      });
      expect(dup.status).toBe(409);
    });

    it('should return 400 for POST without userName', async () => {
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA],
        displayName: 'No Username',
        active: true,
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 for DELETE non-existent user', async () => {
      await scimDelete(app, `${scimBasePath(epId)}/Users/nonexistent-uuid`, token).expect(404);
    });

    it('should create user with only required fields (userName)', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA],
        userName: `minimal-${t}@lexmark.com`,
      }).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBe(`minimal-${t}@lexmark.com`);

      // Cleanup
      await scimDelete(app, `${scimBasePath(epId)}/Users/${res.body.id}`, token);
    });

    it('should create user with all three schemas', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, ENTERPRISE_URN, CUSTOM_URN],
        userName: `allschema-${t}@lexmark.com`,
        displayName: 'All Schema User',
        active: true,
        name: { givenName: 'All', familyName: 'Schema' },
        preferredLanguage: 'ja-JP',
        [ENTERPRISE_URN]: { costCenter: 'CC-ALL', department: 'Research' },
        [CUSTOM_URN]: { badgeCode: 'ALL-BADGE', pin: '0000' },
      }).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body[ENTERPRISE_URN]?.costCenter).toBe('CC-ALL');
      // writeOnly never returned
      expect(res.body[CUSTOM_URN]?.badgeCode).toBeUndefined();
      expect(res.body[CUSTOM_URN]?.pin).toBeUndefined();

      // Cleanup
      await scimDelete(app, `${scimBasePath(epId)}/Users/${res.body.id}`, token);
    });
  });
});
