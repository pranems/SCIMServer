import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
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
 * Sorting E2E tests - RFC 7644 §3.4.2.3
 *
 * Validates sortBy/sortOrder query parameter support on
 * GET list endpoints and POST /.search for Users and Groups.
 */
describe('Sorting (RFC 7644 §3.4.2.3) E2E', () => {
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

  // ───────────── ServiceProviderConfig ─────────────

  describe('ServiceProviderConfig', () => {
    it('should report sort as supported', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);
      expect(res.body.sort.supported).toBe(true);
    });
  });

  // ───────────── Users sorting ─────────────

  describe('GET /Users with sortBy', () => {
    let userNames: string[];

    beforeEach(async () => {
      // Create users with different userNames for sorting verification
      userNames = ['charlie@test.com', 'alice@test.com', 'bob@test.com'];
      for (const userName of userNames) {
        await scimPost(app, `${basePath}/Users`, token, validUser({ userName })).expect(201);
      }
    });

    it('should sort by userName ascending (default)', async () => {
      const res = await scimGet(app, `${basePath}/Users?sortBy=userName`, token).expect(200);
      expect(res.body.totalResults).toBe(3);
      const names = res.body.Resources.map((r: any) => r.userName);
      expect(names).toEqual(['alice@test.com', 'bob@test.com', 'charlie@test.com']);
    });

    it('should sort by userName descending', async () => {
      const res = await scimGet(app, `${basePath}/Users?sortBy=userName&sortOrder=descending`, token).expect(200);
      expect(res.body.totalResults).toBe(3);
      const names = res.body.Resources.map((r: any) => r.userName);
      expect(names).toEqual(['charlie@test.com', 'bob@test.com', 'alice@test.com']);
    });

    it('should sort by displayName ascending', async () => {
      // Create users with specific displayNames
      const ep2 = await createEndpoint(app, token);
      const bp2 = scimBasePath(ep2);
      await scimPost(app, `${bp2}/Users`, token, validUser({ userName: 'u1@test.com', displayName: 'Zara' })).expect(201);
      await scimPost(app, `${bp2}/Users`, token, validUser({ userName: 'u2@test.com', displayName: 'Anna' })).expect(201);
      await scimPost(app, `${bp2}/Users`, token, validUser({ userName: 'u3@test.com', displayName: 'Mike' })).expect(201);

      const res = await scimGet(app, `${bp2}/Users?sortBy=displayName`, token).expect(200);
      const names = res.body.Resources.map((r: any) => r.displayName);
      expect(names).toEqual(['Anna', 'Mike', 'Zara']);
    });

    it('should fall back to default sort for unknown sortBy attribute', async () => {
      const res = await scimGet(app, `${basePath}/Users?sortBy=unknownField`, token).expect(200);
      expect(res.body.totalResults).toBe(3);
      // Should still return results (falls back to createdAt asc)
      expect(res.body.Resources.length).toBe(3);
    });

    it('should sort with case-insensitive attribute names', async () => {
      const res = await scimGet(app, `${basePath}/Users?sortBy=USERNAME&sortOrder=ascending`, token).expect(200);
      const names = res.body.Resources.map((r: any) => r.userName);
      expect(names).toEqual(['alice@test.com', 'bob@test.com', 'charlie@test.com']);
    });

    it('should combine sorting with pagination', async () => {
      const res = await scimGet(app, `${basePath}/Users?sortBy=userName&sortOrder=ascending&startIndex=2&count=1`, token).expect(200);
      expect(res.body.totalResults).toBe(3);
      expect(res.body.itemsPerPage).toBe(1);
      expect(res.body.Resources[0].userName).toBe('bob@test.com');
    });

    it('should combine sorting with filter', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName co "test.com"&sortBy=userName&sortOrder=descending`,
        token,
      ).expect(200);
      expect(res.body.totalResults).toBe(3);
      const names = res.body.Resources.map((r: any) => r.userName);
      expect(names).toEqual(['charlie@test.com', 'bob@test.com', 'alice@test.com']);
    });
  });

  // ───────────── Users POST /.search sorting ─────────────

  describe('POST /Users/.search with sortBy/sortOrder', () => {
    beforeEach(async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'charlie@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'alice@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'bob@test.com' })).expect(201);
    });

    it('should sort via POST /.search sortBy ascending', async () => {
      const body = searchRequest({ sortBy: 'userName', sortOrder: 'ascending' });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);
      const names = res.body.Resources.map((r: any) => r.userName);
      expect(names).toEqual(['alice@test.com', 'bob@test.com', 'charlie@test.com']);
    });

    it('should sort via POST /.search sortBy descending', async () => {
      const body = searchRequest({ sortBy: 'userName', sortOrder: 'descending' });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);
      const names = res.body.Resources.map((r: any) => r.userName);
      expect(names).toEqual(['charlie@test.com', 'bob@test.com', 'alice@test.com']);
    });
  });

  // ───────────── Groups sorting ─────────────

  describe('GET /Groups with sortBy', () => {
    beforeEach(async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Zulu Team' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Alpha Team' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Mike Team' })).expect(201);
    });

    it('should sort groups by displayName ascending', async () => {
      const res = await scimGet(app, `${basePath}/Groups?sortBy=displayName`, token).expect(200);
      const names = res.body.Resources.map((r: any) => r.displayName);
      expect(names).toEqual(['Alpha Team', 'Mike Team', 'Zulu Team']);
    });

    it('should sort groups by displayName descending', async () => {
      const res = await scimGet(app, `${basePath}/Groups?sortBy=displayName&sortOrder=descending`, token).expect(200);
      const names = res.body.Resources.map((r: any) => r.displayName);
      expect(names).toEqual(['Zulu Team', 'Mike Team', 'Alpha Team']);
    });
  });

  // ───────────── Groups POST /.search sorting ─────────────

  describe('POST /Groups/.search with sortBy/sortOrder', () => {
    beforeEach(async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Zulu Team' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Alpha Team' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Mike Team' })).expect(201);
    });

    it('should sort groups via POST /.search ascending', async () => {
      const body = searchRequest({ sortBy: 'displayName', sortOrder: 'ascending' });
      const res = await scimPost(app, `${basePath}/Groups/.search`, token, body).expect(200);
      const names = res.body.Resources.map((r: any) => r.displayName);
      expect(names).toEqual(['Alpha Team', 'Mike Team', 'Zulu Team']);
    });

    it('should sort groups via POST /.search descending', async () => {
      const body = searchRequest({ sortBy: 'displayName', sortOrder: 'descending' });
      const res = await scimPost(app, `${basePath}/Groups/.search`, token, body).expect(200);
      const names = res.body.Resources.map((r: any) => r.displayName);
      expect(names).toEqual(['Zulu Team', 'Mike Team', 'Alpha Team']);
    });
  });
});
