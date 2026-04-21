import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimPatch,
  scimGet,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  patchOp,
  resetFixtureCounter,
} from './helpers/fixtures';

const ENT_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const MANAGER_PATH = `${ENT_URN}:manager`;

/**
 * Manager PATCH String Coercion (RFC 7644 §3.5.2.3 + Postel's Law)
 *
 * Tests that the pre-PATCH strict schema validator accepts raw string values
 * for the complex `manager` attribute, matching Microsoft Entra ID behavior.
 *
 * All tests run with StrictSchemaValidation=True to exercise the code path
 * where the bug previously returned 400 for raw string manager values.
 */
describe('Manager PATCH String Coercion (E2E)', () => {
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
    // Create endpoint with StrictSchemaValidation ENABLED — this is where the bug manifests
    endpointId = await createEndpointWithConfig(app, token, {
      StrictSchemaValidation: 'True',
    });
    basePath = scimBasePath(endpointId);
  });

  // ───────────── Add Manager with raw string (Entra ID style) ─────────────

  describe('PATCH add manager with raw string value', () => {
    it('should accept raw string for manager add (Entra ID compat)', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const patch = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: 'a2c1f66c-8611-4bcd-852f-54dc340e3d97',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body[ENT_URN];
      expect(ext).toBeDefined();
      expect(ext.manager).toBeDefined();
      expect(ext.manager.value).toBe('a2c1f66c-8611-4bcd-852f-54dc340e3d97');
    });
  });

  // ───────────── Replace Manager with raw string ─────────────

  describe('PATCH replace manager with raw string value', () => {
    it('should accept raw string for manager replace', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      // First set manager with canonical object form
      const setPatch = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: { value: 'original-mgr-id' },
      }]);
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, setPatch).expect(200);

      // Now replace with raw string
      const patch = patchOp([{
        op: 'replace',
        path: MANAGER_PATH,
        value: 'new-mgr-uuid-456',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body[ENT_URN];
      expect(ext.manager.value).toBe('new-mgr-uuid-456');
    });
  });

  // ───────────── Remove Manager with empty string (RFC 7644 §3.5.2.3) ─────────────

  describe('PATCH remove manager with empty string', () => {
    it('should remove manager when replace value is empty string', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      // Set manager with canonical form first
      const setPatch = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: { value: 'will-be-removed' },
      }]);
      const setRes = await scimPatch(app, `${basePath}/Users/${created.id}`, token, setPatch).expect(200);
      expect(setRes.body[ENT_URN].manager.value).toBe('will-be-removed');

      // Remove via empty string
      const patch = patchOp([{
        op: 'replace',
        path: MANAGER_PATH,
        value: '',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body[ENT_URN];
      const managerGone = !ext || !ext.manager;
      expect(managerGone).toBe(true);
    });

    it('should remove manager when replace value is {"value":""}', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      // Set manager with canonical form first
      const setPatch2 = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: { value: 'will-be-removed-2' },
      }]);
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, setPatch2).expect(200);

      const patch = patchOp([{
        op: 'replace',
        path: MANAGER_PATH,
        value: { value: '' },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body[ENT_URN];
      const managerGone = !ext || !ext.manager;
      expect(managerGone).toBe(true);
    });
  });

  // ───────────── Canonical complex object form still works ─────────────

  describe('PATCH add manager with canonical complex object', () => {
    it('should accept canonical complex object form', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const patch = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: { value: 'canonical-mgr-uuid' },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body[ENT_URN];
      expect(ext.manager.value).toBe('canonical-mgr-uuid');
    });
  });

  // ───────────── Remove manager with explicit remove op ─────────────

  describe('PATCH remove manager with remove op', () => {
    it('should remove manager via remove op', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      // Set manager with canonical form first
      const setMgr = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: { value: 'remove-op-mgr' },
      }]);
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, setMgr).expect(200);

      const patch = patchOp([{
        op: 'remove',
        path: MANAGER_PATH,
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body[ENT_URN];
      const managerGone = !ext || !ext.manager;
      expect(managerGone).toBe(true);
    });
  });

  // ───────────── Persistence: GET after string PATCH ─────────────

  describe('Persistence after string-coerced PATCH', () => {
    it('should persist manager set via raw string after GET', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      // Set manager via raw string
      const patch = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: 'persisted-mgr-uuid',
      }]);
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      // GET and verify
      const getRes = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      const ext = getRes.body[ENT_URN];
      expect(ext.manager.value).toBe('persisted-mgr-uuid');
    });
  });

  // ───────────── Non-strict mode also works ─────────────

  describe('Non-strict mode still works with raw string', () => {
    it('should accept raw string manager in non-strict mode too', async () => {
      // Create endpoint with strict=False
      const lenientId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'False',
      });
      const lenientBase = scimBasePath(lenientId);

      const user = validUser();
      const created = (await scimPost(app, `${lenientBase}/Users`, token, user).expect(201)).body;

      const patch = patchOp([{
        op: 'add',
        path: MANAGER_PATH,
        value: 'lenient-mgr-uuid',
      }]);
      const res = await scimPatch(app, `${lenientBase}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body[ENT_URN];
      expect(ext.manager.value).toBe('lenient-mgr-uuid');
    });
  });
});
