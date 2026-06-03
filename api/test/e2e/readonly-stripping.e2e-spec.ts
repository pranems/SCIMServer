import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  patchOp,
  resetFixtureCounter,
} from './helpers/fixtures';

const SCIM_WARNING_URN = 'urn:scimserver:api:messages:2.0:Warning';

describe('ReadOnly Attribute Stripping (RFC 7643 §2.2)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ────────── POST /Users - readOnly stripping ──────────

  describe('POST /Users - strip readOnly attributes', () => {
    let endpointId: string;
    let basePath: string;

    beforeEach(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('should strip client-supplied id from POST payload', async () => {
      const user = validUser({ id: 'client-supplied-id' } as any);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.id).not.toBe('client-supplied-id');
    });

    it('should strip client-supplied meta from POST payload', async () => {
      const user = validUser({ meta: { resourceType: 'FAKE', created: '2000-01-01T00:00:00Z' } } as any);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('User');
      expect(res.body.meta.created).not.toBe('2000-01-01T00:00:00Z');
    });

    it('should strip client-supplied groups (readOnly) from POST payload', async () => {
      const user = validUser({ groups: [{ value: 'fake-group', display: 'Fake' }] } as any);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // groups should either be undefined/empty - client value should not persist
      const getRes = await scimGet(app, `${basePath}/Users/${res.body.id}`, token).expect(200);
      expect(getRes.body.groups ?? []).toHaveLength(0);
    });

    it('should preserve readWrite attributes while stripping readOnly ones', async () => {
      const user = validUser({
        id: 'client-id',
        displayName: 'Alice DisplayName',
      } as any);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.id).not.toBe('client-id');
      expect(res.body.displayName).toBe('Alice DisplayName');
      expect(res.body.userName).toBe(user.userName);
    });
  });

  // ────────── PUT /Users - readOnly stripping ──────────

  describe('PUT /Users - strip readOnly attributes', () => {
    let endpointId: string;
    let basePath: string;

    beforeEach(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('should strip client-supplied id and meta from PUT payload', async () => {
      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const scimId = created.body.id;

      const putBody = {
        ...user,
        id: 'overridden-id',
        meta: { resourceType: 'FAKE' },
        displayName: 'Updated Name',
      };

      const res = await scimPut(app, `${basePath}/Users/${scimId}`, token, putBody).expect(200);

      expect(res.body.id).toBe(scimId);
      expect(res.body.meta.resourceType).toBe('User');
      expect(res.body.displayName).toBe('Updated Name');
    });
  });

  // ────────── PATCH /Users - readOnly stripping ──────────

  describe('PATCH /Users - readOnly op stripping', () => {
    let endpointId: string;
    let basePath: string;

    beforeEach(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('should silently strip PATCH ops targeting readOnly attributes (path-based)', async () => {
      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const scimId = created.body.id;

      // Attempt to PATCH groups (readOnly) - should be silently dropped
      const patch = patchOp([
        { op: 'replace', path: 'groups', value: [{ value: 'fake-group' }] },
        { op: 'replace', path: 'displayName', value: 'NewName' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${scimId}`, token, patch).expect(200);

      // displayName update should have applied
      expect(res.body.displayName).toBe('NewName');
      // groups should not have been modified
      expect(res.body.groups ?? []).toHaveLength(0);
    });

    it('should strip readOnly keys from no-path PATCH value objects', async () => {
      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const scimId = created.body.id;

      const patch = patchOp([
        {
          op: 'replace',
          value: {
            displayName: 'PatchedName',
            groups: [{ value: 'injected-group' }],
          },
        },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${scimId}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('PatchedName');
      expect(res.body.groups ?? []).toHaveLength(0);
    });

    it('should return 400 when PATCH targets id (never stripped)', async () => {
      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const scimId = created.body.id;

      // Enable strict schema + keep G8c behavior (id PATCH always fails)
      const strictEndpoint = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: true,
      });
      const strictBase = scimBasePath(strictEndpoint);

      const u2 = validUser();
      const created2 = await scimPost(app, `${strictBase}/Users`, token, u2).expect(201);

      const patch = patchOp([{ op: 'replace', path: 'id', value: 'new-id' }]);
      await scimPatch(app, `${strictBase}/Users/${created2.body.id}`, token, patch).expect(400);
    });
  });

  // ────────── POST /Groups - readOnly stripping ──────────

  describe('POST /Groups - strip readOnly (id, meta)', () => {
    let endpointId: string;
    let basePath: string;

    beforeEach(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('should assign server UUID rather than client-supplied id', async () => {
      const group = validGroup({ id: 'client-group-id' } as any);
      const res = await scimPost(app, `${basePath}/Groups`, token, group).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.id).not.toBe('client-group-id');
    });
  });

  // ────────── Warning URN ──────────

  describe('Warning URN in responses', () => {
    it('should include warning URN when flag is enabled and readOnly attrs are stripped', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        IncludeWarningAboutIgnoredReadOnlyAttribute: true,
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser({
        id: 'client-id',
        groups: [{ value: 'injected' }],
      } as any);

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.schemas).toContain(SCIM_WARNING_URN);
      expect(res.body[SCIM_WARNING_URN]).toBeDefined();
      expect(res.body[SCIM_WARNING_URN].warnings).toBeDefined();
      expect(res.body[SCIM_WARNING_URN].warnings.length).toBeGreaterThan(0);
    });

    it('should NOT include warning URN when flag is disabled', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = validUser({
        id: 'client-id',
        groups: [{ value: 'injected' }],
      } as any);

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.schemas).not.toContain(SCIM_WARNING_URN);
      expect(res.body[SCIM_WARNING_URN]).toBeUndefined();
    });

    it('should NOT include warning URN when no readOnly attrs were in payload', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        IncludeWarningAboutIgnoredReadOnlyAttribute: true,
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser(); // no readOnly attrs
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // No readOnly attrs supplied, so no warnings
      expect(res.body[SCIM_WARNING_URN]).toBeUndefined();
    });

    it('should include warning URN on PUT when readOnly attrs stripped', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        IncludeWarningAboutIgnoredReadOnlyAttribute: true,
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const putBody = {
        ...user,
        id: 'override-id',
        groups: [{ value: 'injected' }],
      };

      const res = await scimPut(app, `${basePath}/Users/${created.body.id}`, token, putBody).expect(200);

      expect(res.body.schemas).toContain(SCIM_WARNING_URN);
      expect(res.body[SCIM_WARNING_URN].warnings.length).toBeGreaterThan(0);
    });

    it('should include warning URN on PATCH when readOnly ops stripped', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        IncludeWarningAboutIgnoredReadOnlyAttribute: true,
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const patch = patchOp([
        { op: 'replace', path: 'groups', value: [{ value: 'injected' }] },
        { op: 'replace', path: 'displayName', value: 'Updated' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${created.body.id}`, token, patch).expect(200);

      expect(res.body.schemas).toContain(SCIM_WARNING_URN);
      expect(res.body[SCIM_WARNING_URN].warnings.length).toBeGreaterThan(0);
      expect(res.body.displayName).toBe('Updated');
    });
  });

  // ────────── PATCH behavior matrix ──────────

  describe('PATCH readOnly behavior matrix', () => {
    it('strict ON + IgnorePatchRO OFF → should reject readOnly PATCH with 400', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: true,
        IgnoreReadOnlyAttributesInPatch: false,
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const patch = patchOp([
        { op: 'replace', path: 'groups', value: [{ value: 'g1' }] },
      ]);

      // With strict ON and ignorePatch OFF, readOnly ops are NOT stripped - G8c rejects them
      const res = await scimPatch(app, `${basePath}/Users/${created.body.id}`, token, patch).expect(400);
      expect(res.body.status).toBe('400');
    });

    it('strict ON + IgnorePatchRO ON → should strip and succeed', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: true,
        IgnoreReadOnlyAttributesInPatch: true,
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const patch = patchOp([
        { op: 'replace', path: 'groups', value: [{ value: 'g1' }] },
        { op: 'replace', path: 'displayName', value: 'OK' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${created.body.id}`, token, patch).expect(200);
      expect(res.body.displayName).toBe('OK');
      expect(res.body.groups ?? []).toHaveLength(0);
    });

    it('strict OFF → should strip readOnly PATCH ops silently', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      const created = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const patch = patchOp([
        { op: 'replace', path: 'groups', value: [{ value: 'g1' }] },
        { op: 'replace', path: 'displayName', value: 'Silent' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${created.body.id}`, token, patch).expect(200);
      expect(res.body.displayName).toBe('Silent');
    });
  });
});
