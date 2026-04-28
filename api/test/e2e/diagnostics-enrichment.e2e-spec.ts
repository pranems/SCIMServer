/**
 * E2E tests for SCIM error diagnostics enrichment (G9).
 *
 * Tests structured attribute paths, config snapshots, filter expression,
 * and normalized path separators in the diagnostics extension.
 */
import { INestApplication } from '@nestjs/common';

import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimPut,
  scimGet,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, resetFixtureCounter } from './helpers/fixtures';

const DIAGNOSTICS_URN = 'urn:scimserver:api:messages:2.0:Diagnostics';

describe('Diagnostics Enrichment (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    resetFixtureCounter();
  });

  // ── Phase 1: attributePaths in validation errors ─────────────────────

  describe('attributePaths in strict schema validation', () => {
    it('should include attributePaths array for unknown attributes (POST)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `diag-test-${Date.now()}@test.com`,
        bogusField1: 'value1',
        bogusField2: 'value2',
      }).expect(400);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.errorCode).toBe('VALIDATION_SCHEMA');
      expect(diag.triggeredBy).toBe('StrictSchemaValidation');
      expect(diag.attributePaths).toBeDefined();
      expect(Array.isArray(diag.attributePaths)).toBe(true);
      expect(diag.attributePaths.length).toBeGreaterThanOrEqual(2);
      expect(diag.attributePaths).toContain('bogusField1');
      expect(diag.attributePaths).toContain('bogusField2');
      // attributePath should be set to first
      expect(diag.attributePath).toBeDefined();
    });

    it('should include attributePaths for strict schema validation on PUT', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create a user first
      const user = validUser();
      const createRes = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const userId = createRes.body.id;

      // PUT with unknown attribute should fail strict validation
      const putBody = {
        ...user,
        id: userId,
        bogusAttrOnPut: 'should fail strict',
      };
      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, putBody).expect(400);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.errorCode).toBe('VALIDATION_SCHEMA');
      expect(diag.attributePaths).toBeDefined();
      expect(diag.attributePaths).toContain('bogusAttrOnPut');
      expect(diag.attributePath).toBeDefined();
    });
  });

  // ── Phase 3: activeConfig snapshot ───────────────────────────────────

  describe('activeConfig in diagnostics', () => {
    it('should include StrictSchemaValidation=true in activeConfig', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `config-test-${Date.now()}@test.com`,
        unknownAttr: 'value',
      }).expect(400);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.activeConfig).toBeDefined();
      expect(diag.activeConfig.StrictSchemaValidation).toBe(true);
    });
  });

  // ── Phase 4: filterExpression ────────────────────────────────────────

  describe('filterExpression in filter errors', () => {
    it('should include filterExpression for invalid filter syntax', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {});
      const basePath = scimBasePath(endpointId);

      const badFilter = 'userName eq "test" AND (((invalid';
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=${encodeURIComponent(badFilter)}`,
        token,
      ).expect(400);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.errorCode).toBe('FILTER_INVALID');
      expect(diag.filterExpression).toBe(badFilter);
      expect(diag.parseError).toBeDefined();
    });
  });

  // ── Phase 2: Normalized path separator ─────────────────────────────

  describe('normalized path separators', () => {
    it('diagnostics extension keys should not contain internal runtime fields', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `contract-test-${Date.now()}@test.com`,
        _internalField: 'should fail strict',
      }).expect(400);

      // The error response should have diagnostics
      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();

      // Verify no internal runtime fields leak
      const diagKeys = Object.keys(diag);
      for (const key of diagKeys) {
        expect(key).not.toMatch(/^_/);
      }
    });
  });
});
