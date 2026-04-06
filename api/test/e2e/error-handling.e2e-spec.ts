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
});
