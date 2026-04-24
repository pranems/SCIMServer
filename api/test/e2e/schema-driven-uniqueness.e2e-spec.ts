/**
 * E2E Tests - Schema-Driven Uniqueness Enforcement (RFC 7643 §2.1)
 *
 * Tests that custom extension attributes with `uniqueness: "server"` are
 * enforced on POST, PUT, and PATCH when the attribute is declared in the
 * endpoint's profile schema. Also validates caseExact-aware comparison.
 *
 * This closes the gap where only hardcoded column attributes (userName,
 * externalId, displayName) had uniqueness enforcement.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimGet,
  scimPost,
  scimPatch,
  scimPut,
  scimDelete,
  scimBasePath,
} from './helpers/request.helper';

describe('Schema-Driven Uniqueness Enforcement (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let epId: string;

  const CORE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const EXT_URN = 'urn:test:uniqueness:2.0:User';

  const ts = () => Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);

    // Create endpoint with inline profile that declares a custom extension
    // attribute with uniqueness: "server" and caseExact: true
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `uniq-e2e-${ts()}`,
        profile: {
          schemas: [
            {
              id: CORE_SCHEMA,
              name: 'User',
              attributes: 'all',
            },
            {
              id: EXT_URN,
              name: 'UniquenessExtension',
              description: 'Extension with unique attributes for testing',
              attributes: [
                {
                  name: 'employeeBadge',
                  type: 'string',
                  multiValued: false,
                  required: false,
                  mutability: 'readWrite',
                  returned: 'default',
                  caseExact: true,
                  uniqueness: 'server',
                  description: 'Unique badge number (case-sensitive)',
                },
                {
                  name: 'department',
                  type: 'string',
                  multiValued: false,
                  required: false,
                  mutability: 'readWrite',
                  returned: 'default',
                  caseExact: false,
                  uniqueness: 'none',
                  description: 'Non-unique department name',
                },
                {
                  name: 'badgeAlias',
                  type: 'string',
                  multiValued: false,
                  required: false,
                  mutability: 'readWrite',
                  returned: 'default',
                  caseExact: false,
                  uniqueness: 'server',
                  description: 'Unique badge alias (case-insensitive)',
                },
              ],
            },
          ],
          resourceTypes: [
            {
              id: 'User',
              name: 'User',
              endpoint: '/Users',
              description: 'User Account',
              schema: CORE_SCHEMA,
              schemaExtensions: [{ schema: EXT_URN, required: false }],
            },
          ],
          serviceProviderConfig: {
            patch: { supported: true },
            bulk: { supported: false },
            filter: { supported: true, maxResults: 200 },
            sort: { supported: true },
            etag: { supported: false },
            changePassword: { supported: false },
          },
        },
      })
      .expect(201);
    epId = res.body.id;
  });

  afterAll(async () => {
    if (epId) {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    }
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════
  // A. POST - Schema-driven uniqueness on create
  // ═══════════════════════════════════════════════════════════════════

  describe('POST - uniqueness on create', () => {
    let user1Id: string;

    afterAll(async () => {
      if (user1Id) await scimDelete(app, `${scimBasePath(epId)}/Users/${user1Id}`, token);
    });

    it('should create first user with unique extension attribute', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `uniq-user1-${t}@example.com`,
        displayName: 'Uniqueness User 1',
        active: true,
        [EXT_URN]: {
          employeeBadge: 'BADGE-001',
          department: 'Engineering',
          badgeAlias: 'alpha',
        },
      }).expect(201);

      user1Id = res.body.id;
      expect(res.body[EXT_URN]?.employeeBadge).toBe('BADGE-001');
    });

    it('should reject duplicate employeeBadge (caseExact: true, exact match)', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `uniq-user2-${t}@example.com`,
        displayName: 'Uniqueness User 2',
        active: true,
        [EXT_URN]: {
          employeeBadge: 'BADGE-001', // same as user1
          department: 'Sales',
        },
      });
      expect(res.status).toBe(409);
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('should allow different-case employeeBadge (caseExact: true)', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `uniq-user3-${t}@example.com`,
        displayName: 'Uniqueness User 3',
        active: true,
        [EXT_URN]: {
          employeeBadge: 'badge-001', // different case - should be allowed
          department: 'HR',
        },
      }).expect(201);

      // Cleanup
      await scimDelete(app, `${scimBasePath(epId)}/Users/${res.body.id}`, token);
    });

    it('should reject duplicate badgeAlias case-insensitively (caseExact: false)', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `uniq-user4-${t}@example.com`,
        displayName: 'Uniqueness User 4',
        active: true,
        [EXT_URN]: {
          employeeBadge: 'BADGE-999',
          badgeAlias: 'ALPHA', // same as user1's "alpha" - case-insensitive
        },
      });
      expect(res.status).toBe(409);
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('should allow non-unique department (uniqueness: none)', async () => {
      const t = ts();
      const res = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `uniq-user5-${t}@example.com`,
        displayName: 'Uniqueness User 5',
        active: true,
        [EXT_URN]: {
          employeeBadge: 'BADGE-005',
          department: 'Engineering', // same as user1 - should be allowed
        },
      }).expect(201);

      // Cleanup
      await scimDelete(app, `${scimBasePath(epId)}/Users/${res.body.id}`, token);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B. PUT - Schema-driven uniqueness on replace
  // ═══════════════════════════════════════════════════════════════════

  describe('PUT - uniqueness on replace', () => {
    let userAId: string;
    let userBId: string;
    let userBName: string;

    beforeAll(async () => {
      const t = ts();
      const r1 = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `put-a-${t}@example.com`,
        displayName: 'Put User A',
        active: true,
        [EXT_URN]: { employeeBadge: 'PUT-A', badgeAlias: 'put-alias-a' },
      }).expect(201);
      userAId = r1.body.id;

      userBName = `put-b-${t}@example.com`;
      const r2 = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: userBName,
        displayName: 'Put User B',
        active: true,
        [EXT_URN]: { employeeBadge: 'PUT-B', badgeAlias: 'put-alias-b' },
      }).expect(201);
      userBId = r2.body.id;
    });

    afterAll(async () => {
      if (userAId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userAId}`, token);
      if (userBId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userBId}`, token);
    });

    it('should reject PUT that would create duplicate unique extension attr', async () => {
      const res = await scimPut(app, `${scimBasePath(epId)}/Users/${userBId}`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: userBName,
        displayName: 'Put User B Updated',
        active: true,
        [EXT_URN]: { employeeBadge: 'PUT-A' }, // conflicts with userA
      });
      expect(res.status).toBe(409);
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('should allow PUT replacing own value (self-exclusion)', async () => {
      const res = await scimPut(app, `${scimBasePath(epId)}/Users/${userBId}`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: userBName,
        displayName: 'Put User B Same',
        active: true,
        [EXT_URN]: { employeeBadge: 'PUT-B' }, // same as own value
      }).expect(200);
      expect(res.body[EXT_URN]?.employeeBadge).toBe('PUT-B');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // C. PATCH - Schema-driven uniqueness on modify
  // ═══════════════════════════════════════════════════════════════════

  describe('PATCH - uniqueness on modify', () => {
    let userXId: string;
    let userYId: string;

    beforeAll(async () => {
      const t = ts();
      const rx = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `patch-x-${t}@example.com`,
        displayName: 'Patch User X',
        active: true,
        [EXT_URN]: { employeeBadge: 'PATCH-X', badgeAlias: 'patch-x-alias' },
      }).expect(201);
      userXId = rx.body.id;

      const ry = await scimPost(app, `${scimBasePath(epId)}/Users`, token, {
        schemas: [CORE_SCHEMA, EXT_URN],
        userName: `patch-y-${t}@example.com`,
        displayName: 'Patch User Y',
        active: true,
        [EXT_URN]: { employeeBadge: 'PATCH-Y', badgeAlias: 'patch-y-alias' },
      }).expect(201);
      userYId = ry.body.id;
    });

    afterAll(async () => {
      if (userXId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userXId}`, token);
      if (userYId) await scimDelete(app, `${scimBasePath(epId)}/Users/${userYId}`, token);
    });

    it('should reject PATCH that would create duplicate unique extension attr', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userYId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{
          op: 'replace',
          value: { [EXT_URN]: { employeeBadge: 'PATCH-X' } }, // conflicts with userX
        }],
      });
      expect(res.status).toBe(409);
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('should allow PATCH keeping own unique value', async () => {
      const res = await scimPatch(app, `${scimBasePath(epId)}/Users/${userYId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{
          op: 'replace',
          value: { [EXT_URN]: { employeeBadge: 'PATCH-Y', department: 'Updated' } },
        }],
      }).expect(200);
      expect(res.body[EXT_URN]?.employeeBadge).toBe('PATCH-Y');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // D. No-op when no unique extension attrs
  // ═══════════════════════════════════════════════════════════════════

  describe('No-op for standard schemas (no custom uniqueness attrs)', () => {
    let stdEpId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `std-uniq-${ts()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      stdEpId = res.body.id;
    });

    afterAll(async () => {
      if (stdEpId) {
        await request(app.getHttpServer())
          .delete(`/scim/admin/endpoints/${stdEpId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(204);
      }
    });

    it('should not trigger schema-driven uniqueness for rfc-standard preset (no custom unique attrs)', async () => {
      const t = ts();
      // Create two users - only userName uniqueness should apply, not extension attrs
      await scimPost(app, `${scimBasePath(stdEpId)}/Users`, token, {
        schemas: [CORE_SCHEMA],
        userName: `std-u1-${t}@example.com`,
        displayName: 'Standard User 1',
        active: true,
      }).expect(201);

      await scimPost(app, `${scimBasePath(stdEpId)}/Users`, token, {
        schemas: [CORE_SCHEMA],
        userName: `std-u2-${t}@example.com`,
        displayName: 'Standard User 2',
        active: true,
      }).expect(201);
      // Both succeed - no uniqueness conflict on non-unique attrs
    });
  });
});
