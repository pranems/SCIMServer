import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Filter operator tests (live-test section 9g).
 * Tests co (contains), sw (startsWith), pr (presence),
 * compound 'and' filters, and case-insensitive matching.
 */
describe('Filter Operators (E2E)', () => {
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

  // ───────────── co (contains) ─────────────

  describe('co (contains) operator', () => {
    it('should find users with userName containing substring', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'alice-filter@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'bob-other@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName co "alice"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe('alice-filter@test.com');
    });

    it('should be case-insensitive', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'alice-ci@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName co "ALICE"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
    });
  });

  // ───────────── sw (startsWith) ─────────────

  describe('sw (startsWith) operator', () => {
    it('should find users with userName starting with prefix', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'prefix-user@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'other-user@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName sw "prefix"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe('prefix-user@test.com');
    });

    it('should return 0 results for non-matching prefix', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName sw "zzz-nonexistent"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
    });
  });

  // ───────────── pr (presence) ─────────────

  describe('pr (presence) operator', () => {
    it('should find users where externalId is present', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ externalId: 'ext-123' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=externalId pr`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
    });

    it('should find users where displayName is present', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ displayName: 'Presence Test User' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=displayName pr`,
        token,
      ).expect(200);

      // User was created with explicit displayName — must be found
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
    });
  });

  // ───────────── Compound 'and' ─────────────

  describe('Compound and filter', () => {
    it('should find users matching both conditions', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'and-user1@test.com', active: true })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'and-user2@test.com', active: false })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName sw "and-user" and active eq true`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe('and-user1@test.com');
    });

    it('should return 0 when second condition fails', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'and-fail@test.com', active: true })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName eq "and-fail@test.com" and active eq false`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
    });
  });

  // ───────────── Group Filters ─────────────

  describe('Group filters', () => {
    it('should find groups with displayName containing substring', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Engineering Team' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Marketing' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=displayName co "Engineering"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].displayName).toBe('Engineering Team');
    });

    it('should filter groups by externalId eq', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'grp-ext-001' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'grp-ext-002' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=externalId eq "grp-ext-001"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
    });
  });
});
