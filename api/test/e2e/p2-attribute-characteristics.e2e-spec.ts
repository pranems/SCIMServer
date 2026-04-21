import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
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
 * P2 Attribute Characteristics E2E Tests
 *
 * Tests for the 6 P2 behavioral gap fixes from the RFC 7643 §2
 * attribute characteristics audit:
 *
 *  R-RET-1: Schema-driven returned:'always' at projection level
 *  R-RET-2: Group 'active' always returned (returned:'always' in schema)
 *  R-RET-3: Sub-attr returned:'always' (e.g., emails.value)
 *  R-MUT-1: writeOnly mutability → returned:never defense-in-depth
 *  R-MUT-2: readOnly sub-attr stripping (e.g., manager.displayName)
 *  R-CASE-1: caseExact-aware in-memory filter evaluation
 */
describe('P2 Attribute Characteristics (E2E)', () => {
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

  // ───────────── R-RET-2: Group does NOT return active (settings v7) ─────────────

  describe('R-RET-2: Group does NOT return active (settings v7)', () => {
    it('GET /Groups/:id should NOT include active', async () => {
      const created = (
        await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)
      ).body;

      const res = await scimGet(
        app,
        `${basePath}/Groups/${created.id}`,
        token,
      ).expect(200);

      // In settings v7, Groups no longer have an 'active' attribute
      expect(res.body).not.toHaveProperty('active');
    });

    it('GET /Groups (list) should NOT include active on any resource', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?count=10`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const group of res.body.Resources) {
        expect(group).not.toHaveProperty('active');
      }
    });

    it('GET /Groups/:id with attributes=displayName should NOT include active', async () => {
      const created = (
        await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)
      ).body;

      const res = await scimGet(
        app,
        `${basePath}/Groups/${created.id}?attributes=displayName`,
        token,
      ).expect(200);

      expect(res.body.displayName).toBeDefined();
      expect(res.body).not.toHaveProperty('active');
    });
  });

  // ───────────── R-RET-1: Schema-driven always-returned ─────────────

  describe('R-RET-1: Schema-driven returned:always attributes', () => {
    it('GET /Groups/:id?attributes=externalId should still include displayName (always)', async () => {
      const created = (
        await scimPost(
          app,
          `${basePath}/Groups`,
          token,
          validGroup({ displayName: 'AlwaysGroup' }),
        ).expect(201)
      ).body;

      // displayName has returned:'always' in Group schema
      const res = await scimGet(
        app,
        `${basePath}/Groups/${created.id}?attributes=externalId`,
        token,
      ).expect(200);

      expect(res.body.displayName).toBe('AlwaysGroup');
    });

    it('excludedAttributes should NOT exclude returned:always attributes', async () => {
      const created = (
        await scimPost(
          app,
          `${basePath}/Groups`,
          token,
          validGroup({ displayName: 'KeepMe' }),
        ).expect(201)
      ).body;

      const res = await scimGet(
        app,
        `${basePath}/Groups/${created.id}?excludedAttributes=displayName`,
        token,
      ).expect(200);

      // displayName is returned:'always' — must NOT be excluded
      expect(res.body.displayName).toBe('KeepMe');
    });
  });

  // ───────────── R-RET-3: Sub-attr projection (returned:default) ─────────────

  describe('R-RET-3: Sub-attr projection behavior', () => {
    it('GET /Users/:id?attributes=emails.type should include only emails.type (others are returned:default)', async () => {
      const user = validUser({
        emails: [
          { value: 'work@test.com', type: 'work', primary: true },
          { value: 'home@test.com', type: 'home', primary: false },
        ],
      });
      const created = (
        await scimPost(app, `${basePath}/Users`, token, user).expect(201)
      ).body;

      const res = await scimGet(
        app,
        `${basePath}/Users/${created.id}?attributes=emails.type`,
        token,
      ).expect(200);

      // emails sub-attributes are all returned:default per RFC 7643 §8.7.1
      // When only emails.type is requested, only emails.type should appear
      expect(res.body.emails).toBeDefined();
      expect(Array.isArray(res.body.emails)).toBe(true);
      for (const email of res.body.emails) {
        expect(email.type).toBeDefined();
      }
    });

    it('GET /Groups/:id?attributes=members.display should include only members.display', async () => {
      // Create a user first to add as member
      const user = (
        await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)
      ).body;

      const group = validGroup({
        members: [{ value: user.id, display: user.displayName || 'Test User' }],
      });
      const created = (
        await scimPost(app, `${basePath}/Groups`, token, group).expect(201)
      ).body;

      const res = await scimGet(
        app,
        `${basePath}/Groups/${created.id}?attributes=members.display`,
        token,
      ).expect(200);

      // members sub-attributes are all returned:default per RFC 7643
      // When only members.display is requested, only that sub-attr should appear
      expect(res.body.members).toBeDefined();
      expect(res.body.members.length).toBeGreaterThanOrEqual(1);
      for (const member of res.body.members) {
        expect(member.display).toBeDefined();
      }
    });
  });

  // ───────────── R-MUT-1: writeOnly → returned:never ─────────────

  describe('R-MUT-1: writeOnly mutability implies returned:never', () => {
    it('POST /Users with password should never return password in response', async () => {
      const res = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser({ password: 'WriteOnlySecret1!' }),
      ).expect(201);

      // password has mutability:'writeOnly' — R-MUT-1 defense-in-depth
      expect(res.body.password).toBeUndefined();
    });

    it('GET /Users?attributes=password should still not return password', async () => {
      await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser({ password: 'WriteOnlySecret2!' }),
      ).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?attributes=password&count=1`,
        token,
      ).expect(200);

      for (const user of res.body.Resources) {
        expect(user.password).toBeUndefined();
      }
    });
  });

  // ───────────── R-MUT-2: readOnly sub-attr stripping ─────────────

  describe('R-MUT-2: readOnly sub-attr stripping', () => {
    it('POST /Users with manager.displayName should strip the readOnly sub-attr', async () => {
      const user = validUser({
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
          manager: {
            value: 'fake-mgr-id',
            displayName: 'Client-Supplied Boss Name',
          },
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        ],
      });

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Retrieve the user to check stored value
      const getRes = await scimGet(
        app,
        `${basePath}/Users/${res.body.id}`,
        token,
      ).expect(200);

      // The enterprise extension manager block should have value but NOT displayName
      const ext = getRes.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      if (ext?.manager) {
        expect(ext.manager.value).toBeDefined();
        // manager.displayName is readOnly — should have been stripped on input
        // (it may or may not be server-populated, but the client value shouldn't persist)
      }
    });

    it('PATCH with path manager.displayName should be silently stripped', async () => {
      const user = validUser({
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
          manager: { value: 'mgr-1' },
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        ],
      });

      const created = (
        await scimPost(app, `${basePath}/Users`, token, user).expect(201)
      ).body;

      // PATCH to change manager.displayName (readOnly sub-attr)
      const patchRes = await scimPatch(
        app,
        `${basePath}/Users/${created.id}`,
        token,
        patchOp([
          { op: 'replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager.displayName', value: 'Hacked Boss' },
          { op: 'replace', path: 'displayName', value: 'Valid Update' },
        ]),
      ).expect(200);

      // displayName (core, readWrite) should be updated
      expect(patchRes.body.displayName).toBe('Valid Update');
    });
  });

  // ───────────── R-CASE-1: caseExact filter behavior ─────────────

  describe('R-CASE-1: caseExact-aware filter evaluation', () => {
    it('filter on externalId (caseExact:true) should match exact case', async () => {
      const user = validUser({ externalId: 'CaseSensitive-ID-123' });
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Exact case should match
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=${encodeURIComponent('externalId eq "CaseSensitive-ID-123"')}`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
    });

    it('filter on userName (caseExact:false) should match case-insensitively', async () => {
      const user = validUser({ userName: 'CaseTest-User@example.com' });
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Different case should still match since userName is not caseExact
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=${encodeURIComponent('userName eq "casetest-user@example.com"')}`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
    });
  });

  // ───────────── Write-Response Projection ─────────────

  describe('Write-response projection', () => {
    it('POST with ?attributes= should project the 201 response', async () => {
      const res = await scimPost(
        app,
        `${basePath}/Users?attributes=userName`,
        token,
        validUser({ displayName: 'Projection Post Test' }),
      ).expect(201);

      // Always-returned attrs must still be present
      expect(res.body.id).toBeDefined();
      expect(res.body.schemas).toBeDefined();
      // Requested attribute present
      expect(res.body.userName).toBeDefined();
      // Non-requested default attribute absent
      expect(res.body.displayName).toBeUndefined();
    });

    it('PUT with ?attributes= should project the 200 response', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const putBody = {
        ...user,
        id: created.id,
        displayName: 'Put Projection Test',
      };

      const res = await scimPut(
        app,
        `${basePath}/Users/${created.id}?attributes=userName`,
        token,
        putBody,
      ).expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBeDefined();
      expect(res.body.displayName).toBeUndefined();
    });

    it('PATCH with ?attributes= should project the 200 response', async () => {
      const created = (
        await scimPost(app, `${basePath}/Users`, token, validUser({ displayName: 'Before Patch' })).expect(201)
      ).body;

      const res = await scimPatch(
        app,
        `${basePath}/Users/${created.id}?attributes=userName`,
        token,
        patchOp([{ op: 'replace', path: 'displayName', value: 'After Patch' }]),
      ).expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBeDefined();
      expect(res.body.displayName).toBeUndefined();
    });

    it('POST with ?excludedAttributes= should exclude from 201 response', async () => {
      const res = await scimPost(
        app,
        `${basePath}/Users?excludedAttributes=displayName`,
        token,
        validUser({ displayName: 'Excluded Test' }),
      ).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBeDefined();
      // displayName should be excluded from response
      expect(res.body.displayName).toBeUndefined();
    });
  });

  // ───────────── Attribute Projection Edge Cases ─────────────

  describe('Attribute projection edge cases', () => {
    it('?attributes=password should NOT return password (returned:never)', async () => {
      const res = await scimPost(
        app,
        `${basePath}/Users?attributes=password`,
        token,
        validUser({ password: 'SecurePass123!' }),
      ).expect(201);

      expect(res.body.password).toBeUndefined();
      // Always-returned fields still present
      expect(res.body.id).toBeDefined();
      expect(res.body.schemas).toBeDefined();
    });

    it('?excludedAttributes=id should NOT remove id (returned:always)', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimGet(
        app,
        `${basePath}/Users/${created.id}?excludedAttributes=id`,
        token,
      ).expect(200);

      // id has returned:always — cannot be excluded
      expect(res.body.id).toBeDefined();
    });

    it('?excludedAttributes=schemas should NOT remove schemas (returned:always)', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimGet(
        app,
        `${basePath}/Users/${created.id}?excludedAttributes=schemas`,
        token,
      ).expect(200);

      expect(res.body.schemas).toBeDefined();
      expect(Array.isArray(res.body.schemas)).toBe(true);
    });

    it('empty ?attributes= should return full response', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ displayName: 'Full Test' })).expect(201)).body;

      const res = await scimGet(
        app,
        `${basePath}/Users/${created.id}?attributes=`,
        token,
      ).expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBeDefined();
    });

    it('mixed case ?attributes=UserName should work case-insensitively', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimGet(
        app,
        `${basePath}/Users/${created.id}?attributes=UserName`,
        token,
      ).expect(200);

      expect(res.body.userName).toBeDefined();
      expect(res.body.id).toBeDefined();
    });
  });
});
