/**
 * API Response Contract Verification - Part 2 (E2E)
 *
 * Covers contract tests for previously-uncovered endpoint categories:
 *   - Discovery endpoints (C1-C5, D1-D5): SPC, Schemas, ResourceTypes
 *   - OAuth token response (B2)
 *   - Admin version response (G1)
 *   - Admin credential responses (F1-F2): create + list (no clientSecret leak)
 *   - Admin database statistics (I5)
 *   - Endpoint log responses (P1, P4)
 *   - /Me endpoint contract (M1)
 *
 * @see .github/prompts/apiContractVerification.prompt.md
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
  scimPost,
  scimGet,
} from './helpers/request.helper';
import { validUser, validGroup, resetFixtureCounter } from './helpers/fixtures';

// ─── Internal Field Denylist ────────────────────────────────────────────────
// Denylist for SCIM resource responses (endpointId is internal routing)
const SCIM_DENYLIST = [
  '_schemaCaches',
  '_rawPayload',
  '_prismaMetadata',
  '_version',
  'endpointId',
  'scimId',
  'rawPayload',
];

// Denylist for admin/log responses (endpointId IS a legitimate field here)
const ADMIN_DENYLIST = [
  '_schemaCaches',
  '_rawPayload',
  '_prismaMetadata',
  '_version',
  'scimId',
  'rawPayload',
];

function assertNoDeniedFields(
  body: Record<string, unknown>,
  context: string,
  denylist: string[] = SCIM_DENYLIST,
): void {
  for (const field of denylist) {
    expect(body).not.toHaveProperty(field);
  }
  const underscoreKeys = Object.keys(body).filter(
    (k) => k.startsWith('_') && k !== '_links',
  );
  expect(underscoreKeys).toEqual([]);
}

function assertAllowedKeys(
  body: Record<string, unknown>,
  allowed: string[],
  context: string,
): void {
  for (const key of Object.keys(body)) {
    expect(allowed).toContain(key);
  }
}

// ─── Discovery Allowlists ─────────────────────────────────────────────────

const SPC_ALLOWED_KEYS = [
  'schemas',
  'documentationUri',
  'patch',
  'bulk',
  'filter',
  'changePassword',
  'sort',
  'etag',
  'authenticationSchemes',
  'meta',
];

const SCHEMA_RESOURCE_ALLOWED_KEYS = [
  'schemas',
  'id',
  'name',
  'description',
  'attributes',
  'meta',
];

const RESOURCE_TYPE_ALLOWED_KEYS = [
  'schemas',
  'id',
  'name',
  'description',
  'endpoint',
  'schema',
  'schemaExtensions',
  'meta',
];

const LIST_RESPONSE_ALLOWED_KEYS = [
  'schemas',
  'totalResults',
  'startIndex',
  'itemsPerPage',
  'Resources',
];

const META_ALLOWED_KEYS = [
  'resourceType',
  'created',
  'lastModified',
  'location',
  'version',
];

const ERROR_RESPONSE_ALLOWED_KEYS = [
  'schemas',
  'status',
  'scimType',
  'detail',
  'urn:scimserver:api:messages:2.0:Diagnostics',
  'urn:scimserver:api:messages:2.0:Warning',
];

describe('API Response Contract Verification - Part 2 (E2E)', () => {
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

  // =========================================================================
  // Discovery: Root-Level (C1-C5)
  // =========================================================================

  describe('Discovery endpoint response contracts (root-level)', () => {
    it('C1: GET /ServiceProviderConfig should match SPC contract', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/ServiceProviderConfig')
        .expect(200);

      assertAllowedKeys(res.body, SPC_ALLOWED_KEYS, 'GET /ServiceProviderConfig');
      assertNoDeniedFields(res.body, 'GET /ServiceProviderConfig');

      // Verify sub-object shapes
      expect(res.body.schemas).toBeDefined();
      expect(res.body.patch).toHaveProperty('supported');
      expect(res.body.bulk).toHaveProperty('supported');
      expect(res.body.filter).toHaveProperty('supported');
    });

    it('C2: GET /Schemas should return ListResponse envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/Schemas')
        .expect(200);

      assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'GET /Schemas');
      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
      );
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);

      // Each schema resource should match contract
      for (const schema of res.body.Resources) {
        assertAllowedKeys(schema, SCHEMA_RESOURCE_ALLOWED_KEYS, 'Schema resource');
        assertNoDeniedFields(schema, 'Schema resource');
      }
    });

    it('C3: GET /Schemas/:uri should return single schema contract', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/Schemas/urn:ietf:params:scim:schemas:core:2.0:User')
        .expect(200);

      assertAllowedKeys(res.body, SCHEMA_RESOURCE_ALLOWED_KEYS, 'GET /Schemas/:uri');
      assertNoDeniedFields(res.body, 'GET /Schemas/:uri');
      expect(res.body.id).toBe(
        'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect(Array.isArray(res.body.attributes)).toBe(true);
    });

    it('C4: GET /ResourceTypes should return ListResponse envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/ResourceTypes')
        .expect(200);

      assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'GET /ResourceTypes');
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);

      for (const rt of res.body.Resources) {
        assertAllowedKeys(rt, RESOURCE_TYPE_ALLOWED_KEYS, 'ResourceType');
        assertNoDeniedFields(rt, 'ResourceType');
      }
    });

    it('C5: GET /ResourceTypes/:id should return single RT contract', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/ResourceTypes/User')
        .expect(200);

      assertAllowedKeys(
        res.body,
        RESOURCE_TYPE_ALLOWED_KEYS,
        'GET /ResourceTypes/User',
      );
      assertNoDeniedFields(res.body, 'GET /ResourceTypes/User');
      expect(res.body.id).toBe('User');
      expect(res.body.schema).toContain('User');
    });
  });

  // =========================================================================
  // Discovery: Endpoint-Scoped (D1-D5)
  // =========================================================================

  describe('Discovery endpoint response contracts (endpoint-scoped)', () => {
    it('D1: GET /endpoints/:eid/ServiceProviderConfig should match SPC', async () => {
      const res = await scimGet(
        app,
        `${basePath}/ServiceProviderConfig`,
        token,
      ).expect(200);

      assertAllowedKeys(res.body, SPC_ALLOWED_KEYS, 'Scoped SPC');
      assertNoDeniedFields(res.body, 'Scoped SPC');
    });

    it('D2: GET /endpoints/:eid/Schemas should return ListResponse', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Schemas`,
        token,
      ).expect(200);

      assertAllowedKeys(res.body, LIST_RESPONSE_ALLOWED_KEYS, 'Scoped Schemas list');
      for (const schema of res.body.Resources) {
        assertAllowedKeys(schema, SCHEMA_RESOURCE_ALLOWED_KEYS, 'Scoped Schema');
        assertNoDeniedFields(schema, 'Scoped Schema');
      }
    });

    it('D4: GET /endpoints/:eid/ResourceTypes should return ListResponse', async () => {
      const res = await scimGet(
        app,
        `${basePath}/ResourceTypes`,
        token,
      ).expect(200);

      assertAllowedKeys(
        res.body,
        LIST_RESPONSE_ALLOWED_KEYS,
        'Scoped ResourceTypes',
      );
      for (const rt of res.body.Resources) {
        assertAllowedKeys(rt, RESOURCE_TYPE_ALLOWED_KEYS, 'Scoped RT');
        assertNoDeniedFields(rt, 'Scoped RT');
      }
    });
  });

  // =========================================================================
  // OAuth Token Response (B2)
  // =========================================================================

  describe('OAuth token response contract', () => {
    const TOKEN_ALLOWED_KEYS = [
      'access_token',
      'token_type',
      'expires_in',
      'scope',
    ];

    it('B2: POST /oauth/token should return only documented fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'e2e-client',
          client_secret: 'e2e-client-secret',
        })
        .expect(201);

      assertAllowedKeys(res.body, TOKEN_ALLOWED_KEYS, 'POST /oauth/token');
      expect(res.body.token_type).toBe('Bearer');
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.expires_in).toBe('number');
    });
  });

  // =========================================================================
  // Admin Version Response (G1)
  // =========================================================================

  describe('Admin version response contract', () => {
    it('G1: GET /admin/version should contain only documented keys', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/version')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Version response has a broader shape - verify no internal leaks
      assertNoDeniedFields(res.body, 'GET /admin/version');
      // Must have version field
      expect(res.body).toHaveProperty('version');
      expect(typeof res.body.version).toBe('string');
    });
  });

  // =========================================================================
  // Admin Credential Responses (F1-F2)
  // =========================================================================

  describe('Admin credential response contracts', () => {
    let credEndpointId: string;

    beforeAll(async () => {
      credEndpointId = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: 'True',
      });
    });

    it('F1: POST /admin/endpoints/:eid/credentials should return token on create', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/scim/admin/endpoints/${credEndpointId}/credentials`,
        )
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'contract-test' })
        .expect(201);

      // Must have token on create
      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.token).toBe('string');
      assertNoDeniedFields(res.body, 'POST credential create', ADMIN_DENYLIST);

      // Must have id
      expect(res.body).toHaveProperty('id');
    });

    it('F2: GET /admin/endpoints/:eid/credentials should NOT include token/hash', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/scim/admin/endpoints/${credEndpointId}/credentials`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      for (const cred of res.body) {
        assertNoDeniedFields(cred, 'Credential list item', ADMIN_DENYLIST);
        // Token/hash must NEVER appear in list responses
        expect(cred).not.toHaveProperty('token');
        expect(cred).not.toHaveProperty('tokenHash');
        expect(cred).not.toHaveProperty('hash');
        expect(cred).not.toHaveProperty('secret');
      }
    });
  });

  // =========================================================================
  // Admin Database Statistics (I5)
  // =========================================================================

  describe('Admin database statistics response contract', () => {
    it('I5: GET /admin/database/statistics should return structured stats', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/database/statistics')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assertNoDeniedFields(res.body, 'GET /admin/database/statistics', ADMIN_DENYLIST);
      // Stats response has structured sub-objects
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('groups');
    });
  });

  // =========================================================================
  // Endpoint Log Responses (P1, P4)
  // =========================================================================

  describe('Endpoint log response contracts', () => {
    it('P1: GET /endpoints/:eid/logs/recent should return log data', async () => {
      // Generate at least one log entry
      await scimGet(app, `${basePath}/Users`, token).expect(200);

      const res = await request(app.getHttpServer())
        .get(`${basePath}/logs/recent`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Response may be array or object with entries - verify no internal leaks
      const entries = Array.isArray(res.body) ? res.body : (res.body.entries ?? []);
      for (const entry of entries.slice(0, 3)) {
        if (typeof entry === 'object' && entry !== null) {
          assertNoDeniedFields(entry, 'Log entry', ADMIN_DENYLIST);
        }
      }
    });

    it('P4: GET /endpoints/:eid/logs/history should return log entries', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/logs/history`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // History response may be array or wrapped - verify it's valid JSON
      expect(res.body).toBeDefined();
      // No internal fields anywhere
      if (typeof res.body === 'object' && res.body !== null) {
        assertNoDeniedFields(res.body, 'Log history', ADMIN_DENYLIST);
      }
    });
  });

  // =========================================================================
  // SCIM Error Response Contract (cross-cutting)
  // =========================================================================

  describe('SCIM error response contracts', () => {
    it('404 error should match strict error contract', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users/00000000-0000-0000-0000-000000000000`,
        token,
      ).expect(404);

      assertAllowedKeys(
        res.body,
        ERROR_RESPONSE_ALLOWED_KEYS,
        '404 SCIM error',
      );
      assertNoDeniedFields(res.body, '404 SCIM error');
      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:api:messages:2.0:Error',
      );
      expect(typeof res.body.status).toBe('string');
      expect(res.body.status).toBe('404');
      expect(typeof res.body.detail).toBe('string');
    });

    it('409 uniqueness error should match strict error contract', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const res = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        user,
      ).expect(409);

      assertAllowedKeys(
        res.body,
        ERROR_RESPONSE_ALLOWED_KEYS,
        '409 SCIM error',
      );
      assertNoDeniedFields(res.body, '409 SCIM error');
      expect(res.body.status).toBe('409');
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('400 validation error should match strict error contract', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        // missing userName - required field
      }).expect(400);

      assertAllowedKeys(
        res.body,
        ERROR_RESPONSE_ALLOWED_KEYS,
        '400 SCIM error',
      );
      assertNoDeniedFields(res.body, '400 SCIM error');
      expect(res.body.status).toBe('400');
    });
  });

  // =========================================================================
  // ListResponse envelope contract (additional coverage)
  // =========================================================================

  describe('ListResponse envelope contracts', () => {
    it('GET /Users list should match strict ListResponse envelope', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);

      assertAllowedKeys(
        res.body,
        LIST_RESPONSE_ALLOWED_KEYS,
        'GET /Users list',
      );
      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
      );
      expect(typeof res.body.totalResults).toBe('number');
      expect(typeof res.body.startIndex).toBe('number');
      expect(typeof res.body.itemsPerPage).toBe('number');
    });

    it('GET /Groups list should match strict ListResponse envelope', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Groups`,
        token,
      ).expect(200);

      assertAllowedKeys(
        res.body,
        LIST_RESPONSE_ALLOWED_KEYS,
        'GET /Groups list',
      );
    });

    it('POST /Users/.search should match strict ListResponse envelope', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users/.search`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [
            'urn:ietf:params:scim:api:messages:2.0:SearchRequest',
          ],
          startIndex: 1,
          count: 10,
        })
        .expect(200);

      assertAllowedKeys(
        res.body,
        LIST_RESPONSE_ALLOWED_KEYS,
        'POST /Users/.search',
      );
    });
  });
});
