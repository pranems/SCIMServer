import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  scimPut,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  patchOp,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * ETag & Conditional Requests (RFC 7644 §3.14).
 * Tests weak ETag format, meta.version, If-None-Match → 304,
 * ETag changes after modification, and ETag on POST/PUT/PATCH.
 */
describe('ETag & Conditional Requests (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    resetFixtureCounter();
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);
  });

  // ───────────── ETag Header Presence ─────────────

  describe('ETag header presence', () => {
    it('should include ETag header on GET /Users/:id', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      const etag = res.headers['etag'];

      expect(etag).toBeDefined();
      expect(etag).toMatch(/^W\/".*"$/); // Weak ETag format
    });

    it('should include ETag header on GET /Groups/:id', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Groups/${created.id}`, token).expect(200);
      const etag = res.headers['etag'];

      expect(etag).toBeDefined();
      expect(etag).toMatch(/^W\/".*"$/);
    });

    it('should have meta.version matching ETag header', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      expect(res.body.meta.version).toBe(res.headers['etag']);
    });
  });

  // ───────────── Conditional GET (If-None-Match) ─────────────

  describe('If-None-Match conditional GET', () => {
    it('should return 304 Not Modified when ETag matches', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const res = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      const etag = res.headers['etag'];

      // Conditional GET with matching ETag
      await request(app.getHttpServer())
        .get(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .set('If-None-Match', etag)
        .expect(304);
    });

    it('should return 200 with full resource when ETag does not match', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await request(app.getHttpServer())
        .get(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .set('If-None-Match', 'W/"stale-timestamp"')
        .expect(200);
    });
  });

  // ───────────── ETag Changes After Modification ─────────────

  describe('ETag changes after modification', () => {
    it('should return different ETag after PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const beforeRes = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      const etagBefore = beforeRes.headers['etag'];

      await new Promise((r) => setTimeout(r, 50));

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'ETag Changed' }]);
      const patchRes = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);
      const etagAfter = patchRes.headers['etag'];

      expect(etagAfter).toBeDefined();
      expect(etagAfter).not.toBe(etagBefore);
    });

    it('should return 200 with old ETag after resource modification', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const res = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      const oldEtag = res.headers['etag'];

      await new Promise((r) => setTimeout(r, 50));

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Modified' }]);
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      // Old ETag should no longer match → 200
      await request(app.getHttpServer())
        .get(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .set('If-None-Match', oldEtag)
        .expect(200);
    });
  });

  // ───────────── ETag on Write Operations ─────────────

  describe('ETag on write operations', () => {
    it('should include ETag header on POST /Users', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      expect(res.headers['etag']).toBeDefined();
    });

    it('should include ETag header on PUT /Users', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const replacement = validUser({ userName: created.userName });
      const res = await scimPut(app, `${basePath}/Users/${created.id}`, token, replacement).expect(200);
      expect(res.headers['etag']).toBeDefined();
    });

    it('should include ETag header on PATCH /Users', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'ETag PATCH' }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);
      expect(res.headers['etag']).toBeDefined();
    });
  });
});
