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

  // ───────────── Phase 7: Version-Based ETag Format ─────────────

  describe('Version-based ETag format (Phase 7)', () => {
    it('should use W/"v{N}" format for ETags', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const res = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      const etag = res.headers['etag'];

      expect(etag).toMatch(/^W\/"v\d+"$/); // Version-based: W/"v1", W/"v2", etc.
    });

    it('should start at W/"v1" for newly created resources', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      expect(res.headers['etag']).toBe('W/"v1"');
    });

    it('should increment version after PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Version Bump' }]);
      const patchRes = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(patchRes.headers['etag']).toBe('W/"v2"');
    });

    it('should increment version after PUT', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const replacement = validUser({ userName: created.userName });
      const putRes = await scimPut(app, `${basePath}/Users/${created.id}`, token, replacement).expect(200);

      expect(putRes.headers['etag']).toBe('W/"v2"');
    });

    it('should increment version on groups after PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
      expect(created.meta.version).toBe('W/"v1"');

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Version Bump Group' }]);
      const patchRes = await scimPatch(app, `${basePath}/Groups/${created.id}`, token, patch).expect(200);

      expect(patchRes.headers['etag']).toBe('W/"v2"');
      expect(patchRes.body.meta.version).toBe('W/"v2"');
    });
  });

  // ───────────── Phase 7: If-Match Pre-Write Enforcement ─────────────

  describe('If-Match pre-write enforcement (Phase 7)', () => {
    it('should allow PATCH when If-Match matches current ETag', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Match OK' }]);
      await request(app.getHttpServer())
        .patch(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', 'W/"v1"')
        .send(patch)
        .expect(200);
    });

    it('should return 412 when If-Match does not match current ETag on PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Stale' }]);
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', 'W/"v999"')
        .send(patch)
        .expect(412);

      expect(res.body.detail).toContain('ETag');
    });

    it('should return 412 when If-Match does not match current ETag on PUT', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const replacement = validUser({ userName: created.userName });
      await request(app.getHttpServer())
        .put(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', 'W/"v999"')
        .send(replacement)
        .expect(412);
    });

    it('should return 412 when If-Match does not match current ETag on DELETE', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', 'W/"v999"')
        .expect(412);
    });

    it('should allow wildcard If-Match (*) on PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Wildcard OK' }]);
      await request(app.getHttpServer())
        .patch(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', '*')
        .send(patch)
        .expect(200);
    });

    it('should protect against stale write after concurrent modification', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const originalEtag = 'W/"v1"';

      // First PATCH succeeds with correct ETag
      const patch1 = patchOp([{ op: 'replace', path: 'displayName', value: 'First Edit' }]);
      await request(app.getHttpServer())
        .patch(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', originalEtag)
        .send(patch1)
        .expect(200);

      // Second PATCH with stale ETag → 412
      const patch2 = patchOp([{ op: 'replace', path: 'displayName', value: 'Stale Edit' }]);
      await request(app.getHttpServer())
        .patch(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', originalEtag)
        .send(patch2)
        .expect(412);
    });

    it('should apply If-Match enforcement on Groups', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Group Stale' }]);
      await request(app.getHttpServer())
        .patch(`${basePath}/Groups/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', 'W/"v999"')
        .send(patch)
        .expect(412);
    });
  });

  // ───────────── Phase 7: RequireIfMatch Config Flag ─────────────

  describe('RequireIfMatch config flag (Phase 7)', () => {
    let requireEndpointId: string;
    let requireBasePath: string;

    beforeEach(async () => {
      requireEndpointId = await createEndpointWithConfig(app, token, {
        RequireIfMatch: true,
      });
      requireBasePath = scimBasePath(requireEndpointId);
    });

    it('should return 428 when RequireIfMatch=true and no If-Match on PATCH', async () => {
      const created = (await scimPost(app, `${requireBasePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'No Header' }]);
      await scimPatch(app, `${requireBasePath}/Users/${created.id}`, token, patch).expect(428);
    });

    it('should return 428 when RequireIfMatch=true and no If-Match on PUT', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${requireBasePath}/Users`, token, user).expect(201)).body;

      const replacement = validUser({ userName: created.userName });
      await scimPut(app, `${requireBasePath}/Users/${created.id}`, token, replacement).expect(428);
    });

    it('should return 428 when RequireIfMatch=true and no If-Match on DELETE', async () => {
      const created = (await scimPost(app, `${requireBasePath}/Users`, token, validUser()).expect(201)).body;

      await scimDelete(app, `${requireBasePath}/Users/${created.id}`, token).expect(428);
    });

    it('should succeed when RequireIfMatch=true and If-Match is provided', async () => {
      const created = (await scimPost(app, `${requireBasePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Has Header' }]);
      await request(app.getHttpServer())
        .patch(`${requireBasePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', 'W/"v1"')
        .send(patch)
        .expect(200);
    });

    it('should allow POST (create) without If-Match even when RequireIfMatch=true', async () => {
      await scimPost(app, `${requireBasePath}/Users`, token, validUser()).expect(201);
    });
  });
});
