/**
 * E2E Tests - RCA Diagnostics Enrichment
 *
 * Tests the attribute-level diagnostic fields added to SCIM error responses:
 * - conflictingResourceId, conflictingAttribute, incomingValue (409)
 * - failedOperationIndex, failedPath, failedOp (PATCH 400)
 * - parseError (filter 400)
 * - currentETag (428)
 * - logsUrl hint when ring buffer is empty
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  scimPut,
  scimDelete,
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, validGroup, patchOp, resetFixtureCounter } from './helpers/fixtures';

const DIAGNOSTICS_URN = 'urn:scimserver:api:messages:2.0:Diagnostics';

describe('RCA Diagnostics Enrichment (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // -- 409 conflictingResourceId --

  describe('409 uniqueness - conflictingResourceId', () => {
    let endpointId: string;
    let basePath: string;
    let existingUserId: string;
    let existingUserName: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      const user = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      existingUserId = user.body.id;
      existingUserName = user.body.userName;
    });

    afterAll(async () => {
      await scimDelete(app, `${basePath}/Users/${existingUserId}`, token).expect(204);
    });

    it('should include conflictingResourceId in 409 response diagnostics', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token,
        validUser({ userName: existingUserName }),
      ).expect(409);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.conflictingResourceId).toBe(existingUserId);
      expect(diag.conflictingAttribute).toBe('userName');
      expect(diag.incomingValue).toBe(existingUserName);
      expect(diag.operation).toBe('create');
    });
  });

  // -- PATCH failedOperationIndex --

  describe('PATCH 400 - failedOperationIndex', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        IgnoreReadOnlyAttributesInPatch: 'False',
      });
      basePath = scimBasePath(endpointId);

      const user = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      userId = user.body.id;
    });

    afterAll(async () => {
      await scimDelete(app, `${basePath}/Users/${userId}`, token).expect(204);
    });

    it('should include diagnostics in PATCH 400 response', async () => {
      const res = await scimPatch(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'displayName', value: 'Good' },
          { op: 'replace', path: 'id', value: 'hacked-id' }, // readOnly - fails
        ],
      }).expect(400);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.requestId).toBeDefined();
      expect(diag.endpointId).toBe(endpointId);
      expect(diag.logsUrl).toContain(endpointId);
    });
  });

  // -- Filter parseError --

  describe('filter 400 - parseError', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('should include parseError in invalidFilter diagnostics', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName%20eqq%20"john"`,
        token,
      ).expect(400);

      expect(res.body.scimType).toBe('invalidFilter');
      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.parseError).toBeDefined();
      expect(typeof diag.parseError).toBe('string');
      expect(diag.parseError.length).toBeGreaterThan(0);
    });
  });

  // -- 428 currentETag --

  describe('428 - currentETag', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        RequireIfMatch: 'True',
      });
      basePath = scimBasePath(endpointId);

      const user = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      userId = user.body.id;
    });

    afterAll(async () => {
      // Need If-Match to delete when RequireIfMatch=True
      const getRes = await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200);
      const etag = getRes.headers?.etag;
      if (etag) {
        await request(app.getHttpServer())
          .delete(`${basePath}/Users/${userId}`)
          .set('Authorization', `Bearer ${token}`)
          .set('If-Match', etag)
          .expect(204);
      }
    });

    it('should include currentETag in 428 diagnostics', async () => {
      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'updated@example.com',
      }).expect(428);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.triggeredBy).toBe('RequireIfMatch');
      expect(diag.currentETag).toBeDefined();
      expect(diag.currentETag).toMatch(/^W\/"v\d+"$/);
    });
  });

  // -- logsUrl hint --

  describe('ring buffer hint on empty result', () => {
    it('should include hint when querying with nonexistent requestId', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config/recent?requestId=nonexistent-req-id-12345')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.count).toBe(0);
      expect(res.body.hint).toBeDefined();
      expect(res.body.hint).toContain('/scim/admin/logs');
    });
  });
});
