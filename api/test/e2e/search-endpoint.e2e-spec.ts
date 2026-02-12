import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  searchRequest,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * POST /.search endpoint tests (RFC 7644 §3.4.3).
 * Covers User and Group search, attributes/excludedAttributes projection,
 * and proper HTTP 200 status (not 201).
 */
describe('POST /.search (E2E)', () => {
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

  // ───────────── POST /Users/.search ─────────────

  describe('POST /Users/.search', () => {
    it('should return ListResponse schema', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'search-user@test.com' })).expect(201);

      const body = searchRequest({ filter: 'userName eq "search-user@test.com"' });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.startIndex).toBeDefined();
      expect(res.body.itemsPerPage).toBeDefined();
    });

    it('should return HTTP 200 (not 201)', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const body = searchRequest();
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body);
      expect(res.status).toBe(200);
    });

    it('should return application/scim+json Content-Type', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const body = searchRequest();
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);
      expect(res.headers['content-type']).toMatch(/scim\+json/);
    });

    it('should support attributes projection', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'proj-user@test.com' })).expect(201);

      const body = searchRequest({
        filter: 'userName eq "proj-user@test.com"',
        attributes: 'userName,displayName',
      });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const resource = res.body.Resources[0];
      expect(resource.userName).toBeDefined();
      expect(resource.id).toBeDefined(); // always-returned
      expect(resource.schemas).toBeDefined(); // always-returned
      expect(resource.emails).toBeUndefined(); // not requested
    });

    it('should support excludedAttributes', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'excl-user@test.com' })).expect(201);

      const body = searchRequest({
        filter: 'userName eq "excl-user@test.com"',
        excludedAttributes: 'emails,phoneNumbers',
      });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const resource = res.body.Resources[0];
      expect(resource.userName).toBeDefined();
      expect(resource.emails).toBeUndefined();
    });

    it('should list all users when no filter is provided', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const body = searchRequest({ count: 5 });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(2);
      expect(res.body.Resources.length).toBeLessThanOrEqual(5);
    });

    it('should respect count parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      }

      const body = searchRequest({ count: 2 });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      expect(res.body.totalResults).toBe(5);
      expect(res.body.Resources.length).toBeLessThanOrEqual(2);
    });
  });

  // ───────────── POST /Groups/.search ─────────────

  describe('POST /Groups/.search', () => {
    it('should return ListResponse schema for Groups', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'SearchGroup' })).expect(201);

      const body = searchRequest({ filter: 'displayName eq "SearchGroup"' });
      const res = await scimPost(app, `${basePath}/Groups/.search`, token, body).expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
    });

    it('should support excludedAttributes=members', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ members: [{ value: user.id }] })).expect(201);

      const body = searchRequest({ excludedAttributes: 'members' });
      const res = await scimPost(app, `${basePath}/Groups/.search`, token, body).expect(200);

      if (res.body.Resources.length > 0) {
        expect(res.body.Resources[0].members).toBeUndefined();
        expect(res.body.Resources[0].displayName).toBeDefined();
      }
    });
  });
});
