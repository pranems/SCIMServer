import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  patchOp,
  noPathMergePatch,
  multiOpPatch,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Advanced PATCH operations (live-test sections 3b, 3c).
 *
 * Tests no-path merge, valuePath, extension URN, manager removal,
 * multi-op in single request, PascalCase ops, and case-insensitive keys.
 */
describe('Advanced PATCH Operations (E2E)', () => {
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

  // ───────────── No-Path Merge (RFC 7644 §3.5.2.1/2) ─────────────

  describe('PATCH with no path (merge into resource)', () => {
    it('should merge value object with replace op', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = noPathMergePatch('replace', { displayName: 'No-Path Merged', active: true });
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('No-Path Merged');
      expect(res.body.active).toBe(true);
    });

    it('should merge value object with add op', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = noPathMergePatch('add', { displayName: 'Add-Merged', title: 'Tester' });
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('Add-Merged');
      expect(res.body.title).toBe('Tester');
    });

    it('should handle case-insensitive keys in no-path merge', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{
        op: 'replace',
        value: { DisplayName: 'CI-Keys Merged', Active: true },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('CI-Keys Merged');
    });
  });

  // ───────────── valuePath (RFC 7644 §3.5.2.2) ─────────────

  describe('PATCH with valuePath', () => {
    it('should update emails[type eq "work"].value via valuePath', async () => {
      const user = validUser({
        emails: [
          { value: 'work@test.com', type: 'work', primary: true },
          { value: 'home@test.com', type: 'home' },
        ],
      });
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const patch = patchOp([{
        op: 'replace',
        path: 'emails[type eq "work"].value',
        value: 'updated-work@test.com',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const workEmail = res.body.emails.find((e: { type: string }) => e.type === 'work');
      expect(workEmail.value).toBe('updated-work@test.com');

      // Home email should be unchanged
      const homeEmail = res.body.emails.find((e: { type: string }) => e.type === 'home');
      expect(homeEmail.value).toBe('home@test.com');
    });
  });

  // ───────────── Extension URN Path ─────────────

  describe('PATCH with extension URN path', () => {
    it('should add enterprise extension attribute via URN path', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{
        op: 'add',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
        value: 'Engineering',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      expect(ext).toBeDefined();
      expect(ext.department).toBe('Engineering');
    });

    it('should replace enterprise extension attribute via URN path', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // First add
      const addPatch = patchOp([{
        op: 'add',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
        value: 'Engineering',
      }]);
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, addPatch).expect(200);

      // Then replace
      const replacePatch = patchOp([{
        op: 'replace',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
        value: 'Product',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, replacePatch).expect(200);

      const ext = res.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      expect(ext.department).toBe('Product');
    });
  });

  // ───────────── Manager Empty-Value Removal (RFC 7644 §3.5.2.3) ─────────────

  describe('Manager empty-value removal', () => {
    it('should remove manager when value is empty string', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Set manager
      const setManager = patchOp([{
        op: 'add',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: 'manager-id-123' },
      }]);
      const setRes = await scimPatch(app, `${basePath}/Users/${created.id}`, token, setManager).expect(200);
      const ext = setRes.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      expect(ext.manager.value).toBe('manager-id-123');

      // Remove with empty value
      const removeManager = patchOp([{
        op: 'replace',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: '' },
      }]);
      const removeRes = await scimPatch(app, `${basePath}/Users/${created.id}`, token, removeManager).expect(200);
      const extAfter = removeRes.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      const managerGone = !extAfter || !extAfter.manager;
      expect(managerGone).toBe(true);
    });
  });

  // ───────────── Multiple Operations in Single PATCH ─────────────

  describe('Multiple operations in single PATCH', () => {
    it('should apply all operations atomically', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ active: true })).expect(201)).body;

      const patch = multiOpPatch([
        { op: 'replace', path: 'displayName', value: 'Multi-Op User' },
        { op: 'replace', path: 'active', value: false },
        { op: 'add', path: 'title', value: 'Engineer' },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('Multi-Op User');
      expect(res.body.active).toBe(false);
      expect(res.body.title).toBe('Engineer');
    });
  });

  // ───────────── Case-Insensitive Filter Attributes ─────────────

  describe('Case-insensitive filter attribute names', () => {
    it('should find users with UPPERCASE filter attribute name', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'cifilter@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=USERNAME eq "cifilter@test.com"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
    });

    it('should find users with PascalCase filter attribute name', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'pcfilter@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=UserName eq "pcfilter@test.com"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
    });

    it('should match filter values case-insensitively for userName', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'cifvalue@test.com' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName eq "CIFVALUE@TEST.COM"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
    });
  });
});
