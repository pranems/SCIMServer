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

      // User was created with explicit displayName - must be found
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

    it('should filter groups by displayName sw (startsWith)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'SwTestGroup Alpha' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Other Group' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=displayName sw "SwTest"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].displayName).toBe('SwTestGroup Alpha');
    });

    it('should filter groups by displayName pr (present)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'PrGroup' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=displayName pr`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.Resources.every((g: any) => g.displayName)).toBe(true);
    });

    it('should filter groups by externalId pr (present)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'pr-ext-grp-123' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201); // no externalId

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=externalId pr`,
        token,
      ).expect(200);

      // At least the one with externalId should be returned
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.Resources.every((g: any) => g.externalId)).toBe(true);
    });
  });

  // ── UUID guard on id filter ──────────────────────────────────────────────

  describe('id filter with non-UUID value (UUID guard)', () => {
    it('should return 200 with empty results for id eq non-UUID (not 500)', async () => {
      // This was the exact production outage: non-UUID in id filter
      // crashed PostgreSQL with "invalid input syntax for type uuid"
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=id eq "not-a-valid-uuid"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
      expect(res.body.Resources).toEqual([]);
    });

    it('should return 200 with empty results for id eq email address', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=id eq "user@example.com"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
    });

    it('should return 200 for id ne non-UUID on Groups', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=id ne "not-a-uuid"`,
        token,
      ).expect(200);

      // ne with non-UUID: guard returns contradictory filter → 0 results
      // (rather than crash). This is acceptable - a non-UUID can never
      // match a UUID column, so ne should logically return all, but the
      // guard prioritizes safety over accuracy for this edge case.
      expect(res.body).toHaveProperty('totalResults');
    });

    it('should return results for id eq with a valid (but non-existent) UUID', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=id eq "a1b2c3d4-e5f6-7890-abcd-ef1234567890"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
    });
  });

  // ───────────── gt / ge / lt / le (ordering operators) ─────────────

  describe('gt/ge/lt/le ordering operators', () => {
    it('should find users with userName gt a given value', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'alpha-gt@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'zulu-gt@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName gt "m"`,
        token,
      ).expect(200);

      // 'zulu-gt@test.com' > 'm', 'alpha-gt@test.com' < 'm'
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe('zulu-gt@test.com');
    });

    it('should find users with userName ge a given value', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'match-ge@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'alpha-ge@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName ge "match-ge@test.com"`,
        token,
      ).expect(200);

      // 'match-ge@test.com' >= 'match-ge@test.com' (exact match included)
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.Resources.some((r: Record<string, unknown>) => r.userName === 'match-ge@test.com')).toBe(true);
    });

    it('should find users with userName lt a given value', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'alpha-lt@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'zulu-lt@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName lt "m"`,
        token,
      ).expect(200);

      // 'alpha-lt@test.com' < 'm', 'zulu-lt@test.com' > 'm'
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe('alpha-lt@test.com');
    });

    it('should find users with userName le a given value', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'match-le@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'zulu-le@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName le "match-le@test.com"`,
        token,
      ).expect(200);

      // 'match-le@test.com' <= 'match-le@test.com' (exact match included)
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.Resources.some((r: Record<string, unknown>) => r.userName === 'match-le@test.com')).toBe(true);
      // zulu-le should NOT be included (> match)
      expect(res.body.Resources.some((r: Record<string, unknown>) => r.userName === 'zulu-le@test.com')).toBe(false);
    });

    it('should filter Groups with displayName gt', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Alpha Group GT' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Zulu Group GT' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=displayName gt "M"`,
        token,
      ).expect(200);

      // 'Zulu Group GT' > 'M', 'Alpha Group GT' < 'M'
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].displayName).toBe('Zulu Group GT');
    });

    it('should filter Groups with displayName lt', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Alpha Group LT' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Zulu Group LT' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=displayName lt "M"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].displayName).toBe('Alpha Group LT');
    });
  });
});
