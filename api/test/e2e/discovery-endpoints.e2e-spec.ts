import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimGet,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Discovery Endpoints (E2E)', () => {
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

  // ───────────── ServiceProviderConfig ─────────────

  describe('GET /ServiceProviderConfig', () => {
    it('should return a valid ServiceProviderConfig', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);

      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      );
      expect(res.body.patch).toBeDefined();
      expect(res.body.patch.supported).toBe(true);
      expect(res.body.filter).toBeDefined();
      expect(res.body.bulk).toBeDefined();
    });

    it('should include all required capability fields', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);

      expect(res.body.patch).toBeDefined();
      expect(res.body.patch.supported).toBe(true);
      expect(res.body.filter).toBeDefined();
      expect(res.body.filter.supported).toBe(true);
      expect(res.body.bulk).toBeDefined();
      expect(res.body.changePassword).toBeDefined();
      expect(res.body.sort).toBeDefined();
      expect(res.body.etag).toBeDefined();
      expect(res.body.etag.supported).toBe(true);
    });
  });

  // ───────────── Schemas ─────────────

  describe('GET /Schemas', () => {
    it('should return SCIM schema definitions', async () => {
      const res = await scimGet(app, `${basePath}/Schemas`, token).expect(200);

      // The response should contain User and Group schemas
      const body = res.body;
      // Could be a ListResponse or direct array — handle both
      const schemas = body.Resources ?? body;
      const ids = Array.isArray(schemas) ? schemas.map((s: { id: string }) => s.id) : [];

      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
    });
  });

  // ───────────── ResourceTypes ─────────────

  describe('GET /ResourceTypes', () => {
    it('should return User and Group resource types', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);

      const body = res.body;
      const types = body.Resources ?? body;
      const names = Array.isArray(types) ? types.map((t: { name: string }) => t.name) : [];

      expect(names).toContain('User');
      expect(names).toContain('Group');
    });

    it('should include endpoint and schema in each resource type', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);

      const types = res.body.Resources ?? res.body;
      const userType = (types as Array<{ name: string; endpoint: string; schema: string }>)
        .find((t) => t.name === 'User');

      expect(userType).toBeDefined();
      expect(userType!.endpoint).toBe('/Users');
      expect(userType!.schema).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
    });
  });
});
