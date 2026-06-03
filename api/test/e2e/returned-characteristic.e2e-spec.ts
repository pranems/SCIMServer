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
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * G8e - RFC 7643 §2.4 `returned` attribute characteristic E2E tests.
 *
 * Verifies that attributes with `returned: 'never'` (e.g. password) are
 * stripped from ALL SCIM responses: POST (create), GET (read), PUT (replace),
 * PATCH (update), and LIST operations.
 */
describe('Returned Attribute Characteristic (G8e E2E)', () => {
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

  // ───────────── returned:'never' - password never in responses ─────────────

  describe('returned:never - password stripped from all responses', () => {
    it('POST /Users should NOT return password in the 201 response', async () => {
      const res = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser({ password: 'SuperSecret123!' }),
      ).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBeDefined();
      expect(res.body.password).toBeUndefined();
    });

    it('GET /Users/:id should NOT return password', async () => {
      const created = (
        await scimPost(
          app,
          `${basePath}/Users`,
          token,
          validUser({ password: 'SuperSecret123!' }),
        ).expect(201)
      ).body;

      const res = await scimGet(
        app,
        `${basePath}/Users/${created.id}`,
        token,
      ).expect(200);

      expect(res.body.userName).toBeDefined();
      expect(res.body.password).toBeUndefined();
    });

    it('GET /Users (list) should NOT return password in any resource', async () => {
      await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser({ password: 'ListSecret1!' }),
      ).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?count=10`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const user of res.body.Resources) {
        expect(user.password).toBeUndefined();
      }
    });

    it('PUT /Users/:id should NOT return password in the response', async () => {
      const created = (
        await scimPost(
          app,
          `${basePath}/Users`,
          token,
          validUser({ password: 'PutSecret1!' }),
        ).expect(201)
      ).body;

      const res = await scimPut(
        app,
        `${basePath}/Users/${created.id}`,
        token,
        validUser({
          userName: created.userName,
          password: 'NewPutSecret2!',
        }),
      ).expect(200);

      expect(res.body.userName).toBeDefined();
      expect(res.body.password).toBeUndefined();
    });

    it('PATCH /Users/:id should NOT return password in the response', async () => {
      const created = (
        await scimPost(
          app,
          `${basePath}/Users`,
          token,
          validUser({ password: 'PatchSecret1!' }),
        ).expect(201)
      ).body;

      const res = await scimPatch(
        app,
        `${basePath}/Users/${created.id}`,
        token,
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'displayName', value: 'Updated' },
          ],
        },
      ).expect(200);

      expect(res.body.displayName).toBe('Updated');
      expect(res.body.password).toBeUndefined();
    });

    it('POST /Users/.search should NOT return password', async () => {
      const created = (
        await scimPost(
          app,
          `${basePath}/Users`,
          token,
          validUser({ password: 'SearchSecret1!' }),
        ).expect(201)
      ).body;

      const res = await scimPost(
        app,
        `${basePath}/Users/.search`,
        token,
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
          filter: `userName eq "${created.userName}"`,
        },
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const user of res.body.Resources) {
        expect(user.password).toBeUndefined();
      }
    });

    it('GET /Users?attributes=password should still NOT include password', async () => {
      await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser({ password: 'AttrReqSecret!' }),
      ).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?attributes=password,userName&count=1`,
        token,
      ).expect(200);

      const user = res.body.Resources[0];
      expect(user.userName).toBeDefined();
      // password is returned:'never' - MUST NOT be in response even if requested
      expect(user.password).toBeUndefined();
    });
  });

  // ───────────── password field in schema discovery ─────────────

  describe('password in schema discovery', () => {
    it('should show password with returned:never in /Schemas', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Schemas`,
        token,
      ).expect(200);

      const userSchema = res.body.Resources?.find(
        (s: Record<string, unknown>) =>
          s.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect(userSchema).toBeDefined();

      const passwordAttr = userSchema.attributes?.find(
        (a: Record<string, unknown>) =>
          (a.name as string)?.toLowerCase() === 'password',
      );
      expect(passwordAttr).toBeDefined();
      expect(passwordAttr.returned).toBe('never');
      expect(passwordAttr.mutability).toBe('writeOnly');
    });
  });
});
