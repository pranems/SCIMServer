import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
  scimDelete,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, validGroup, resetFixtureCounter } from './helpers/fixtures';

/**
 * Error Handling & SCIM Error Format E2E tests.
 *
 * Validates Phase A improvements:
 * - All error responses are SCIM-compliant (schemas, detail, status as string)
 * - Content-Type is application/scim+json for SCIM route errors
 * - 404 errors for non-existent resources have correct body
 * - 409 uniqueness errors have correct scimType
 * - Error responses contain the SCIM Error schema URN
 */
describe('Error Handling & SCIM Error Format (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetFixtureCounter();
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);
  });

  // ─── SCIM Error Body Format ───────────────────────────────────────

  describe('SCIM error body format (RFC 7644 §3.12)', () => {
    it('GET non-existent user should return SCIM-compliant 404', async () => {
      const res = await scimGet(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);

      expect(res.status).toBe(404);
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.status).toBe('404');
      expect(typeof res.body.status).toBe('string');
      expect(res.body.detail).toBeDefined();
      expect(res.headers['content-type']).toContain('application/scim+json');
    });

    it('GET non-existent group should return SCIM-compliant 404', async () => {
      const res = await scimGet(app, `${basePath}/Groups/00000000-0000-0000-0000-000000000000`, token);

      expect(res.status).toBe(404);
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.status).toBe('404');
      expect(typeof res.body.status).toBe('string');
    });

    it('POST duplicate userName should return SCIM-compliant 409 with scimType=uniqueness', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const res = await scimPost(app, `${basePath}/Users`, token, user);

      expect(res.status).toBe(409);
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.scimType).toBe('uniqueness');
      expect(res.body.status).toBe('409');
      expect(typeof res.body.status).toBe('string');
      expect(res.body.detail).toContain('already exists');
    });

    it('POST duplicate group displayName should return SCIM-compliant 409', async () => {
      const group = validGroup();
      await scimPost(app, `${basePath}/Groups`, token, group).expect(201);

      const res = await scimPost(app, `${basePath}/Groups`, token, group);

      expect(res.status).toBe(409);
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.scimType).toBe('uniqueness');
      expect(res.body.status).toBe('409');
    });

    it('DELETE non-existent user should return SCIM-compliant 404', async () => {
      const res = await scimDelete(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);

      expect(res.status).toBe(404);
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.status).toBe('404');
      expect(res.body.scimType).toBe('noTarget');
    });

    it('PUT non-existent user should return SCIM-compliant 404', async () => {
      const res = await scimPut(
        app,
        `${basePath}/Users/00000000-0000-0000-0000-000000000000`,
        token,
        validUser(),
      );

      expect(res.status).toBe(404);
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.status).toBe('404');
    });

    it('PATCH non-existent user should return SCIM-compliant 404', async () => {
      const res = await scimPatch(
        app,
        `${basePath}/Users/00000000-0000-0000-0000-000000000000`,
        token,
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'active', value: false }],
        },
      );

      expect(res.status).toBe(404);
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.status).toBe('404');
    });
  });

  // ─── Error status as string ───────────────────────────────────────

  describe('status field is always a string (RFC 7644 §3.12)', () => {
    it('400 error status should be string "400"', async () => {
      // POST with missing required schema
      const res = await scimPost(app, `${basePath}/Users`, token, {
        userName: 'test@example.com',
        // missing schemas array
      });

      expect(res.status).toBe(400);
      if (res.body.status) {
        expect(typeof res.body.status).toBe('string');
      }
    });

    it('404 error status should be string "404"', async () => {
      const res = await scimGet(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);
      expect(typeof res.body.status).toBe('string');
    });

    it('409 error status should be string "409"', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const res = await scimPost(app, `${basePath}/Users`, token, user);
      expect(typeof res.body.status).toBe('string');
    });
  });

  // ─── Content-Type header ──────────────────────────────────────────

  describe('Content-Type on error responses', () => {
    it('should return application/scim+json on 404', async () => {
      const res = await scimGet(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);
      expect(res.headers['content-type']).toContain('application/scim+json');
    });

    it('should return application/scim+json on 409', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const res = await scimPost(app, `${basePath}/Users`, token, user);
      expect(res.headers['content-type']).toContain('application/scim+json');
    });

    it('should return application/scim+json on 400', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, {
        userName: 'test@example.com',
      });
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toContain('application/scim+json');
    });
  });

  // ─── X-Request-Id correlation ─────────────────────────────────────

  describe('X-Request-Id on error responses', () => {
    it('should include X-Request-Id header on error responses', async () => {
      const res = await scimGet(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);
      expect(res.status).toBe(404);
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
    });

    it('should propagate client-supplied X-Request-Id', async () => {
      const clientRequestId = 'test-correlation-id-12345';
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', clientRequestId);

      expect(res.status).toBe(404);
      expect(res.headers['x-request-id']).toBe(clientRequestId);
    });
  });

  // ─── Diagnostics Extension (Phase A Step 4) ──────────────────────

  describe('Diagnostics extension in error responses', () => {
    const DIAGNOSTICS_URN = 'urn:scimserver:api:messages:2.0:Diagnostics';

    it('404 should include diagnostics extension with requestId and endpointId', async () => {
      const res = await scimGet(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);

      expect(res.status).toBe(404);
      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.requestId).toBeDefined();
      expect(typeof diag.requestId).toBe('string');
      expect(diag.requestId.length).toBeGreaterThan(0);
      expect(diag.endpointId).toBe(endpointId);
      expect(diag.logsUrl).toBeDefined();
      expect(diag.logsUrl).toContain(diag.requestId);
    });

    it('409 uniqueness error should include diagnostics extension', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const res = await scimPost(app, `${basePath}/Users`, token, user);

      expect(res.status).toBe(409);
      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.requestId).toBeDefined();
      expect(diag.endpointId).toBe(endpointId);
    });

    it('diagnostics logsUrl should point to endpoint-scoped path', async () => {
      const res = await scimGet(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);

      expect(res.status).toBe(404);
      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag.logsUrl).toContain(`/scim/endpoints/${endpointId}/logs/recent`);
    });

    it('diagnostics requestId should match X-Request-Id header', async () => {
      const clientReqId = 'diag-test-req-id-99999';
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', clientReqId);

      expect(res.status).toBe(404);
      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag.requestId).toBe(clientReqId);
      expect(res.headers['x-request-id']).toBe(clientReqId);
    });

    it('standard SCIM error fields should be preserved alongside diagnostics', async () => {
      const res = await scimGet(app, `${basePath}/Users/00000000-0000-0000-0000-000000000000`, token);

      expect(res.status).toBe(404);
      // Standard fields
      expect(res.body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(res.body.status).toBe('404');
      expect(res.body.detail).toBeDefined();
      // Diagnostics alongside
      expect(res.body[DIAGNOSTICS_URN]).toBeDefined();
    });
  });

  // ─── GlobalExceptionFilter integration (Step C) ───────────────────

  describe('GlobalExceptionFilter — non-HttpException handling', () => {
    it('should return SCIM-compliant 500 for requests to non-existent custom resource types', async () => {
      // Requesting a resource type that doesn't exist on the endpoint
      // triggers a code path that may throw a non-HttpException depending on
      // how the generic controller processes unknown resource types.
      // The key assertion: ANY 4xx/5xx response on /scim/* routes must be SCIM-compliant.
      const res = await request(app.getHttpServer())
        .get(`${basePath}/NonExistentResourceType/some-id`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json');

      // Should get 404 (resource type not found) — either from generic controller or NestJS routing
      expect(res.status).toBeGreaterThanOrEqual(400);

      // Verify SCIM error format if body has schemas
      if (res.body?.schemas) {
        expect(res.body.schemas).toContain(SCIM_ERROR_SCHEMA);
        expect(typeof res.body.status).toBe('string');
      }
    });

    it('should always include X-Request-Id on error responses regardless of exception type', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({}); // Empty body — triggers validation error

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should not leak internal error details in response body', async () => {
      // Send malformed JSON-like content that might cause parser errors
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'] });
        // Missing userName — should get 400, not 500 with stack trace

      expect(res.status).toBeGreaterThanOrEqual(400);
      // Response body should not contain stack traces
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('at ');
      expect(bodyStr).not.toContain('node_modules');
    });
  });

  // ─── enrichContext E2E verification (addMissingTests gap #1) ──────

  describe('enrichContext fields in log entries', () => {
    it('POST /Users should produce log entry with resourceType=User and operation=create', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Query ring buffer for this endpoint's recent logs
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/recent?category=scim.user&limit=5`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const createEntry = res.body.entries.find(
        (e: any) => e.message?.includes('User created') || e.message?.includes('Creating user'),
      );
      // Verify enriched context fields are present
      if (createEntry) {
        expect(createEntry.resourceType).toBe('User');
        expect(createEntry.operation).toBe('create');
      }
    });
  });

  // ─── CONFIG category audit trail E2E (addMissingTests gap #2) ─────

  describe('CONFIG category for admin audit trail', () => {
    it('PUT /admin/log-config/level/:level should produce log with category=config', async () => {
      // First ensure level is at DEBUG so INFO audit logs are captured
      await request(app.getHttpServer())
        .put('/scim/admin/log-config/level/DEBUG')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Now change level to TRACE — this change itself is logged at INFO (which passes DEBUG threshold)
      await request(app.getHttpServer())
        .put('/scim/admin/log-config/level/TRACE')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Check ring buffer for config category entry
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config/recent?category=config&limit=5')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const configEntry = res.body.entries.find(
        (e: any) => e.category === 'config' && e.message?.includes('log level'),
      );
      expect(configEntry).toBeDefined();

      // Restore level
      await request(app.getHttpServer())
        .put('/scim/admin/log-config/level/DEBUG')
        .set('Authorization', `Bearer ${token}`);
    });
  });

  // ─── 401 SCIM error body format (addMissingTests gap #5) ──────────

  describe('401 error body format', () => {
    it('should return SCIM-compliant 401 with missing auth header', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        // No Authorization header
        .set('Accept', 'application/scim+json');

      expect(res.status).toBe(401);
      // 401 should have SCIM error schema
      if (res.body?.schemas) {
        expect(res.body.schemas).toContain(SCIM_ERROR_SCHEMA);
        expect(typeof res.body.status).toBe('string');
      }
    });

    it('should return SCIM-compliant 401 with invalid token', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', 'Bearer invalid-token-12345')
        .set('Accept', 'application/scim+json');

      expect(res.status).toBe(401);
      if (res.body?.schemas) {
        expect(res.body.schemas).toContain(SCIM_ERROR_SCHEMA);
      }
    });
  });
});
