/**
 * API Response Contract Verification (E2E)
 *
 * Verifies that every API endpoint response contains ONLY documented fields
 * (allowlist) and never leaks internal fields (denylist). Covers all major
 * response shapes: SCIM resources, list envelopes, error bodies, discovery,
 * and admin write operations.
 *
 * @see .github/prompts/apiContractVerification.prompt.md
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  createEndpoint,
  scimBasePath,
  scimPost,
  scimGet,
  scimPatch,
  scimPut,
} from './helpers/request.helper';
import { validUser, validGroup, resetFixtureCounter } from './helpers/fixtures';

// ─── Internal Field Denylist ────────────────────────────────────────────────
// These fields are internal implementation details that must NEVER appear
// in any API response. Prefixed with _ or DB-internal column names.
const INTERNAL_DENYLIST = [
  '_schemaCaches',
  '_rawPayload',
  '_prismaMetadata',
  '_version',
  'endpointId',
  'scimId',
  'rawPayload',
];

/**
 * Assert that a response body contains no internal/leaked fields.
 * Checks the denylist and also verifies no _-prefixed keys except _links.
 */
function assertNoDeniedFields(body: Record<string, unknown>, context: string): void {
  for (const field of INTERNAL_DENYLIST) {
    expect(body).not.toHaveProperty(field);
  }
  const underscoreKeys = Object.keys(body).filter(
    (k) => k.startsWith('_') && k !== '_links',
  );
  if (underscoreKeys.length > 0) {
    fail(`${context}: unexpected _-prefixed keys: ${underscoreKeys.join(', ')}`);
  }
}

/**
 * Assert that every key in the body is in the allowed set.
 */
function assertAllowedKeys(
  body: Record<string, unknown>,
  allowed: string[],
  context: string,
): void {
  const keys = Object.keys(body);
  for (const key of keys) {
    if (!allowed.includes(key)) {
      fail(`${context}: unexpected key '${key}' not in allowlist [${allowed.join(', ')}]`);
    }
  }
}

// ─── SCIM Resource Allowlists ───────────────────────────────────────────────

// Core User attributes that MAY appear in a User resource response.
// This is intentionally broad - the point is to catch LEAKED fields, not
// to enforce which optional SCIM fields are present.
const USER_ALLOWED_KEYS = [
  'schemas', 'id', 'externalId', 'meta',
  'userName', 'name', 'displayName', 'nickName', 'profileUrl',
  'title', 'userType', 'preferredLanguage', 'locale', 'timezone',
  'active', 'emails', 'phoneNumbers', 'ims', 'photos',
  'addresses', 'groups', 'entitlements', 'roles', 'x509Certificates',
  // Enterprise extension URN key
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  // Custom extension URN keys (from profiles)
  'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User',
  'urn:ietf:params:scim:schemas:extension:msfttest:User',
];

const GROUP_ALLOWED_KEYS = [
  'schemas', 'id', 'externalId', 'meta',
  'displayName', 'members',
  // Custom extension URN keys
  'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group',
  'urn:ietf:params:scim:schemas:extension:msfttest:Group',
];

const LIST_RESPONSE_ALLOWED_KEYS = [
  'schemas', 'totalResults', 'startIndex', 'itemsPerPage', 'Resources',
];

const ERROR_RESPONSE_ALLOWED_KEYS = [
  'schemas', 'status', 'scimType', 'detail',
  // Diagnostics extension (optional)
  'urn:scimserver:api:messages:2.0:Diagnostics',
  // Warning extension (optional)
  'urn:scimserver:api:messages:2.0:Warning',
];

const SPC_ALLOWED_KEYS = [
  'schemas', 'documentationUri', 'patch', 'bulk', 'filter',
  'changePassword', 'sort', 'etag', 'authenticationSchemes', 'meta',
];

const META_ALLOWED_KEYS = [
  'resourceType', 'created', 'lastModified', 'location', 'version',
];

const PROFILE_ALLOWED_KEYS = [
  'schemas', 'settings', 'resourceTypes', 'serviceProviderConfig',
];

describe('API Response Contract Verification (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);
  });

  afterAll(async () => {
    // Cleanup endpoint
    try {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`);
    } catch {}
    await app.close();
  });

  beforeEach(() => {
    resetFixtureCounter();
  });

  // ─── SCIM User Resource Responses ───────────────────────────────────────

  describe('SCIM User resource response contract', () => {
    let userId: string;

    afterAll(async () => {
      if (userId) {
        try {
          await request(app.getHttpServer())
            .delete(`${basePath}/Users/${userId}`)
            .set('Authorization', `Bearer ${token}`);
        } catch {}
      }
    });

    it('POST /Users response should contain only allowed keys', async () => {
      const user = validUser();
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      userId = res.body.id;

      assertAllowedKeys(res.body, USER_ALLOWED_KEYS, 'POST /Users');
      assertNoDeniedFields(res.body, 'POST /Users');

      // meta sub-object contract
      expect(res.body.meta).toBeDefined();
      assertAllowedKeys(res.body.meta, META_ALLOWED_KEYS, 'POST /Users meta');
    });

    it('GET /Users/:id response should contain only allowed keys', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200);

      assertAllowedKeys(res.body, USER_ALLOWED_KEYS, 'GET /Users/:id');
      assertNoDeniedFields(res.body, 'GET /Users/:id');
      assertAllowedKeys(res.body.meta, META_ALLOWED_KEYS, 'GET /Users/:id meta');
    });

    it('PUT /Users/:id response should contain only allowed keys', async () => {
      const user = validUser({ userName: `put-contract-${Date.now()}@test.com` });
      // First create
      const createRes = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const putId = createRes.body.id;

      const putRes = await scimPut(app, `${basePath}/Users/${putId}`, token, {
        ...user,
        id: putId,
        displayName: 'PUT Contract Test',
      }).expect(200);

      assertAllowedKeys(putRes.body, USER_ALLOWED_KEYS, 'PUT /Users/:id');
      assertNoDeniedFields(putRes.body, 'PUT /Users/:id');

      // Cleanup
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${putId}`)
        .set('Authorization', `Bearer ${token}`);
    });

    it('PATCH /Users/:id response should contain only allowed keys', async () => {
      const patchRes = await scimPatch(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { displayName: 'Patched Contract' } }],
      }).expect(200);

      assertAllowedKeys(patchRes.body, USER_ALLOWED_KEYS, 'PATCH /Users/:id');
      assertNoDeniedFields(patchRes.body, 'PATCH /Users/:id');
    });
  });

  // ─── SCIM Group Resource Responses ──────────────────────────────────────

  describe('SCIM Group resource response contract', () => {
    let groupId: string;

    afterAll(async () => {
      if (groupId) {
        try {
          await request(app.getHttpServer())
            .delete(`${basePath}/Groups/${groupId}`)
            .set('Authorization', `Bearer ${token}`);
        } catch {}
      }
    });

    it('POST /Groups response should contain only allowed keys', async () => {
      const group = validGroup();
      const res = await scimPost(app, `${basePath}/Groups`, token, group).expect(201);
      groupId = res.body.id;

      assertAllowedKeys(res.body, GROUP_ALLOWED_KEYS, 'POST /Groups');
      assertNoDeniedFields(res.body, 'POST /Groups');
      assertAllowedKeys(res.body.meta, META_ALLOWED_KEYS, 'POST /Groups meta');
    });

    it('GET /Groups/:id response should contain only allowed keys', async () => {
      const res = await scimGet(app, `${basePath}/Groups/${groupId}`, token).expect(200);

      assertAllowedKeys(res.body, GROUP_ALLOWED_KEYS, 'GET /Groups/:id');
      assertNoDeniedFields(res.body, 'GET /Groups/:id');
    });

    it('PATCH /Groups/:id response should contain only allowed keys', async () => {
      const res = await scimPatch(app, `${basePath}/Groups/${groupId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { displayName: 'Patched Contract Group' } }],
      }).expect(200);

      assertAllowedKeys(res.body, GROUP_ALLOWED_KEYS, 'PATCH /Groups/:id');
      assertNoDeniedFields(res.body, 'PATCH /Groups/:id');
    });
  });

  // ─── SCIM List Response Envelope ────────────────────────────────────────

  describe('SCIM ListResponse envelope contract', () => {
    it('GET /Users list response should contain only allowed envelope keys', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);

      assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'GET /Users list');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(typeof res.body.totalResults).toBe('number');
      expect(typeof res.body.startIndex).toBe('number');
      expect(typeof res.body.itemsPerPage).toBe('number');
      expect(Array.isArray(res.body.Resources)).toBe(true);

      // Each resource in the list should also conform
      for (const resource of res.body.Resources) {
        assertNoDeniedFields(resource, 'GET /Users list resource');
      }
    });

    it('GET /Groups list response should contain only allowed envelope keys', async () => {
      const res = await scimGet(app, `${basePath}/Groups`, token).expect(200);

      assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'GET /Groups list');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');

      for (const resource of res.body.Resources) {
        assertNoDeniedFields(resource, 'GET /Groups list resource');
      }
    });

    it('POST /Users/.search response should use ListResponse envelope', async () => {
      const res = await scimPost(app, `${basePath}/Users/.search`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
        filter: 'userName co "@"',
      }).expect(200);

      assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'POST /Users/.search');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });
  });

  // ─── SCIM Error Response ────────────────────────────────────────────────

  describe('SCIM Error response contract', () => {
    it('404 error should contain only allowed keys', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users/00000000-0000-0000-0000-000000000000`,
        token,
      ).expect(404);

      assertAllowedKeys(res.body, ERROR_RESPONSE_ALLOWED_KEYS, '404 error');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });

    it('400 error (missing userName) should contain only allowed keys', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        // Missing userName - required
      }).expect(400);

      assertAllowedKeys(res.body, ERROR_RESPONSE_ALLOWED_KEYS, '400 error');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('400');
    });

    it('409 uniqueness error should contain only allowed keys', async () => {
      const user = validUser({ userName: `conflict-contract-${Date.now()}@test.com` });
      const first = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(409);

      assertAllowedKeys(res.body, ERROR_RESPONSE_ALLOWED_KEYS, '409 error');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('409');

      // Cleanup
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${first.body.id}`)
        .set('Authorization', `Bearer ${token}`);
    });
  });

  // ─── Discovery Endpoint Responses ───────────────────────────────────────

  describe('Discovery endpoint response contracts', () => {
    it('ServiceProviderConfig should contain only allowed keys', async () => {
      const res = await scimGet(
        app,
        `${basePath}/ServiceProviderConfig`,
        token,
      ).expect(200);

      assertAllowedKeys(res.body, SPC_ALLOWED_KEYS, 'ServiceProviderConfig');
      assertNoDeniedFields(res.body, 'ServiceProviderConfig');
      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      );
    });

    it('Schemas endpoint should return ListResponse envelope', async () => {
      const res = await scimGet(app, `${basePath}/Schemas`, token).expect(200);

      // Schemas may return a ListResponse or a direct array - check both
      if (res.body.schemas && Array.isArray(res.body.Resources)) {
        assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'GET /Schemas');
      }
      assertNoDeniedFields(res.body, 'GET /Schemas');
    });

    it('ResourceTypes endpoint should return ListResponse envelope', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);

      if (res.body.schemas && Array.isArray(res.body.Resources)) {
        assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'GET /ResourceTypes');
      }
      assertNoDeniedFields(res.body, 'GET /ResourceTypes');
    });
  });

  // ─── Admin Write Response Contracts ─────────────────────────────────────

  describe('Admin write response contracts', () => {
    const ADMIN_FULL_ALLOWED_KEYS = [
      'id', 'name', 'displayName', 'description', 'profile',
      'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links',
    ];

    it('POST /admin/endpoints (create) response should match full view contract', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `contract-create-${Date.now()}`, profilePreset: 'rfc-standard' })
        .expect(201);

      assertAllowedKeys(res.body, ADMIN_FULL_ALLOWED_KEYS, 'POST /admin/endpoints');
      assertNoDeniedFields(res.body, 'POST /admin/endpoints');

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${res.body.id}`)
        .set('Authorization', `Bearer ${token}`);
    });

    it('PATCH /admin/endpoints/:id response should match full view contract', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ displayName: `Contract Updated ${Date.now()}` })
        .expect(200);

      assertAllowedKeys(res.body, ADMIN_FULL_ALLOWED_KEYS, 'PATCH /admin/endpoints');
      assertNoDeniedFields(res.body, 'PATCH /admin/endpoints');
    });
  });

  // ─── Admin Version Response Contract ────────────────────────────────────

  describe('Admin version response contract', () => {
    it('GET /admin/version should contain only expected fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/version')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assertNoDeniedFields(res.body, 'GET /admin/version');
      // Version response should have at least version field
      expect(res.body).toHaveProperty('version');
    });
  });

  // ─── Admin List Endpoint Response Contract ──────────────────────────────

  describe('Admin list endpoints response contract', () => {
    it('GET /admin/endpoints (list) should return envelope with allowlisted keys', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Envelope keys
      const envelopeAllowed = ['totalResults', 'endpoints'];
      assertAllowedKeys(res.body, envelopeAllowed, 'GET /admin/endpoints envelope');
      expect(typeof res.body.totalResults).toBe('number');
      expect(Array.isArray(res.body.endpoints)).toBe(true);

      // Each endpoint in the list should match summary view shape
      if (res.body.endpoints.length > 0) {
        const ep = res.body.endpoints[0];
        const SUMMARY_KEYS = [
          'id', 'name', 'displayName', 'description', 'profileSummary',
          'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links',
        ];
        assertAllowedKeys(ep, SUMMARY_KEYS, 'endpoint summary item');
        assertNoDeniedFields(ep, 'endpoint summary item');
      }
    });
  });

  // ─── Bulk Response Contract ─────────────────────────────────────────────

  describe('Bulk response contract', () => {
    let bulkEndpointId: string;
    let bulkBasePath: string;

    beforeAll(async () => {
      // Create endpoint with bulk enabled
      const epRes = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `contract-bulk-${Date.now()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      bulkEndpointId = epRes.body.id;
      bulkBasePath = scimBasePath(bulkEndpointId);
    });

    it('POST /Bulk response should match BulkResponse contract', async () => {
      const bulkReq = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'POST',
            path: '/Users',
            bulkId: 'bulk-contract-1',
            data: {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
              userName: `bulk-contract-${Date.now()}@test.com`,
              displayName: 'Bulk Contract Test',
              active: true,
            },
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post(`${bulkBasePath}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(bulkReq)
        .expect(200);

      // BulkResponse envelope
      const BULK_ALLOWED = ['schemas', 'Operations'];
      assertAllowedKeys(res.body, BULK_ALLOWED, 'POST /Bulk');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:BulkResponse');
      expect(Array.isArray(res.body.Operations)).toBe(true);

      // Each operation result should have valid keys
      if (res.body.Operations.length > 0) {
        const op = res.body.Operations[0];
        const OP_ALLOWED = ['method', 'bulkId', 'version', 'location', 'status', 'response'];
        assertAllowedKeys(op, OP_ALLOWED, 'Bulk operation result');
        assertNoDeniedFields(op, 'Bulk operation result');
        expect(op.status).toBe('201');

        // If response body present (for POST), verify resource shape
        if (op.response) {
          assertNoDeniedFields(op.response, 'Bulk POST response body');
        }
      }

      // Cleanup
      if (res.body.Operations?.[0]?.location) {
        const userId = res.body.Operations[0].location.split('/').pop();
        try {
          await request(app.getHttpServer())
            .delete(`${bulkBasePath}/Users/${userId}`)
            .set('Authorization', `Bearer ${token}`);
        } catch { /* ignore */ }
      }
    });
  });

  // ─── Temporal Coupling: Cache Leak Detection (⚡ F-A1) ──────────────────

  describe('Temporal coupling: admin endpoint after SCIM operations', () => {
    it('GET /admin/endpoints/:id should have clean profile after SCIM operations trigger cache building', async () => {
      // 1. Create users to trigger schema cache building
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // 2. Read admin endpoint - must still be clean
      const adminRes = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Profile must not contain _schemaCaches
      const profile = adminRes.body.profile;
      if (profile) {
        assertAllowedKeys(profile, PROFILE_ALLOWED_KEYS, 'Profile after SCIM ops');
        expect(profile).not.toHaveProperty('_schemaCaches');
      }
      assertNoDeniedFields(adminRes.body, 'Admin endpoint after SCIM ops');

      // Cleanup
      try {
        await request(app.getHttpServer())
          .delete(`${basePath}/Users/${user.id}`)
          .set('Authorization', `Bearer ${token}`);
      } catch { /* ignore */ }
    });
  });
});
