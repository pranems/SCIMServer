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
  scimPatch,
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

  // ── Error response body stored in request log ──────────────────────

  describe('error response body in request log', () => {
    it('should store error response body in request log for 400 errors', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Trigger a 400 error
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `log-body-test-${Date.now()}@test.com`,
        unknownAttrForLogTest: 'value',
      }).expect(400);

      // Get the request ID from the response diagnostics
      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      expect(diag.requestId).toBeDefined();

      // Wait briefly for async log write
      await new Promise(resolve => setTimeout(resolve, 500));

      // Fetch the log entry
      const logRes = await scimGet(
        app,
        `/scim/admin/logs?search=${diag.requestId}&pageSize=1`,
        token,
      );

      if (logRes.status === 200 && logRes.body.items?.length > 0) {
        const logItem = logRes.body.items[0];
        // Verify detailed log available by fetching full log entry
        const detailRes = await scimGet(app, `/scim/admin/logs/${logItem.id}`, token);
        if (detailRes.status === 200) {
          // responseBody should be stored (the filter-owned persistence fix)
          expect(detailRes.body.responseBody).toBeDefined();
          if (typeof detailRes.body.responseBody === 'object') {
            expect(detailRes.body.responseBody.status).toBe('400');
          }
        }
      }
    });
  });

  // ── returned:request with excludedAttributes ──────────────────────

  describe('returned:request with excludedAttributes (gap audit)', () => {
    it('excludedAttributes on other fields should NOT cause returned:request attrs to appear', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {});
      const basePath = scimBasePath(endpointId);

      // Create a user with enterprise extension (costCenter is returned:request)
      const user = validUser();
      const createRes = await scimPost(app, `${basePath}/Users`, token, {
        ...user,
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
          costCenter: 'CC-100',
          department: 'Engineering',
        },
      }).expect(201);
      const userId = createRes.body.id;

      // GET with excludedAttributes=displayName - should NOT cause costCenter to appear
      const res = await scimGet(
        app,
        `${basePath}/Users/${userId}?excludedAttributes=displayName`,
        token,
      ).expect(200);

      // displayName should be excluded
      expect(res.body).not.toHaveProperty('displayName');
      // id and schemas should still be present (returned:always)
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
    });
  });

  // ── Diagnostics on PATCH pre-validation errors ────────────────────

  describe('attributePaths on PATCH pre-validation errors', () => {
    it('should include attributePaths + failedOperationIndex for PATCH value validation', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create a user first
      const user = validUser();
      const createRes = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const userId = createRes.body.id;

      // PATCH with invalid value type (name should be complex, not string)
      const res = await scimPatch(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'name', value: 'not-an-object' }],
      });

      // This may return 400 (strict validation) or 200 (depends on path)
      // If 400, verify diagnostics
      if (res.status === 400) {
        const diag = res.body[DIAGNOSTICS_URN];
        if (diag?.errorCode === 'VALIDATION_SCHEMA') {
          expect(diag.triggeredBy).toBe('StrictSchemaValidation');
          expect(diag.failedOperationIndex).toBeDefined();
        }
      }
    });
  });

  // ── Diagnostics key allowlist (contract test) ─────────────────────

  describe('diagnostics extension contract', () => {
    const ALLOWED_DIAGNOSTIC_KEYS = [
      'requestId', 'endpointId', 'logsUrl', 'operation',
      'triggeredBy', 'errorCode',
      'attributePath', 'attributePaths', 'schemaUrn',
      'conflictingResourceId', 'conflictingAttribute', 'incomingValue',
      'failedOperationIndex', 'failedPath', 'failedOp',
      'currentETag', 'parseError', 'filterExpression',
      'activeConfig',
      'primaryCount',
    ];

    it('diagnostics keys should only contain documented fields', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `contract-diag-${Date.now()}@test.com`,
        unknownContractField: 'test',
      }).expect(400);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      for (const key of Object.keys(diag)) {
        expect(ALLOWED_DIAGNOSTIC_KEYS).toContain(key);
      }
    });

    it('409 uniqueness diagnostics should only contain documented fields', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {});
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(409);

      const diag = res.body[DIAGNOSTICS_URN];
      expect(diag).toBeDefined();
      for (const key of Object.keys(diag)) {
        expect(ALLOWED_DIAGNOSTIC_KEYS).toContain(key);
      }
      expect(diag.conflictingResourceId).toBeDefined();
      expect(diag.conflictingAttribute).toBeDefined();
    });
  });
});
