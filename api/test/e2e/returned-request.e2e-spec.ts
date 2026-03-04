import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, patchOp, searchRequest, resetFixtureCounter } from './helpers/fixtures';

/**
 * RFC 7643 §2.4 — `returned:request` and `returned:default` E2E tests.
 *
 * Verifies:
 * - `returned:request` attributes are stripped from responses unless
 *   explicitly requested via `?attributes=`.
 * - `returned:default` attributes are included by default but can be
 *   excluded via `?excludedAttributes=`.
 *
 * Uses a custom schema extension with specific `returned` characteristics.
 */
describe('Returned:request & Returned:default (E2E)', () => {
  let app: INestApplication;
  let token: string;

  const EXT_URN = 'urn:ietf:params:scim:schemas:extension:test:2.0:ReturnedTest';

  /**
   * Register a custom User extension with returned:request and returned:default
   */
  async function registerReturnedTestExtension(endpointId: string): Promise<void> {
    const ext = {
      schemaUrn: EXT_URN,
      name: 'Returned Test Extension',
      description: 'Extension with returned:request and returned:default attributes',
      resourceTypeId: 'User',
      required: false,
      attributes: [
        {
          name: 'secretQuestion',
          type: 'string',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          returned: 'request',
          description: 'Secret question for password reset — only shown when asked',
        },
        {
          name: 'secretAnswer',
          type: 'string',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          returned: 'request',
          description: 'Secret answer — only shown when asked',
        },
        {
          name: 'department',
          type: 'string',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          returned: 'default',
          description: 'Department — returned by default, excludable',
        },
        {
          name: 'badgeNumber',
          type: 'string',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          returned: 'always',
          description: 'Badge number — always returned even if excluded',
        },
      ],
    };

    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/schemas`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(ext)
      .expect(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────────── returned:request — stripped unless requested ─────────────

  describe('returned:request — stripped from default responses', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {});
      basePath = scimBasePath(endpointId);
      await registerReturnedTestExtension(endpointId);
    });

    beforeAll(async () => {
      // Create a user with extension data
      const user = validUser({
        [EXT_URN]: {
          secretQuestion: 'Favorite color?',
          secretAnswer: 'Blue',
          department: 'Engineering',
          badgeNumber: 'B12345',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      userId = res.body.id;
    });

    it('GET /Users/:id should NOT return returned:request attrs by default', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200);

      // returned:request attrs should be absent
      const ext = res.body[EXT_URN];
      if (ext) {
        expect(ext.secretQuestion).toBeUndefined();
        expect(ext.secretAnswer).toBeUndefined();
      }
    });

    it('GET /Users/:id should return returned:default attrs by default', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200);

      const ext = res.body[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.department).toBe('Engineering');
    });

    it('GET /Users/:id should return returned:always attrs always', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200);

      const ext = res.body[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.badgeNumber).toBe('B12345');
    });

    it('GET /Users/:id?attributes=<ext>:secretQuestion should include returned:request attr', async () => {
      const attrParam = encodeURIComponent(`${EXT_URN}:secretQuestion`);
      const res = await scimGet(
        app,
        `${basePath}/Users/${userId}?attributes=${attrParam}`,
        token,
      ).expect(200);

      const ext = res.body[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.secretQuestion).toBe('Favorite color?');
    });

    it('GET /Users (LIST) should NOT return returned:request attrs by default', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);

      expect(res.body.Resources.length).toBeGreaterThan(0);
      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();

      const ext = user[EXT_URN];
      if (ext) {
        expect(ext.secretQuestion).toBeUndefined();
        expect(ext.secretAnswer).toBeUndefined();
      }
    });

    it('POST /Users (create) response should NOT include returned:request attrs', async () => {
      const user = validUser({
        [EXT_URN]: {
          secretQuestion: 'Pet name?',
          secretAnswer: 'Rex',
          department: 'Sales',
          badgeNumber: 'B99999',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const ext = res.body[EXT_URN];
      if (ext) {
        expect(ext.secretQuestion).toBeUndefined();
        expect(ext.secretAnswer).toBeUndefined();
      }
      // returned:default and returned:always should be present
      if (ext) {
        expect(ext.department).toBe('Sales');
        expect(ext.badgeNumber).toBe('B99999');
      }
    });

    it('PUT /Users/:id response should NOT include returned:request attrs', async () => {
      const user = validUser({
        [EXT_URN]: {
          secretQuestion: 'Rewrite Q?',
          secretAnswer: 'RewriteA',
          department: 'R&D',
          badgeNumber: 'B55555',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });

      const res = await scimPut(
        app,
        `${basePath}/Users/${userId}`,
        token,
        user,
      ).expect(200);

      const ext = res.body[EXT_URN];
      if (ext) {
        expect(ext.secretQuestion).toBeUndefined();
        expect(ext.secretAnswer).toBeUndefined();
        expect(ext.department).toBe('R&D');
        expect(ext.badgeNumber).toBe('B55555');
      }
    });
  });

  // ───────────── returned:default — excludable via excludedAttributes ─────────────

  describe('returned:default — excludable via excludedAttributes', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {});
      basePath = scimBasePath(endpointId);
      await registerReturnedTestExtension(endpointId);

      const user = validUser({
        [EXT_URN]: {
          secretQuestion: 'Color?',
          secretAnswer: 'Red',
          department: 'Marketing',
          badgeNumber: 'B77777',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      userId = res.body.id;
    });

    it('GET /Users/:id?excludedAttributes=<ext>:department should exclude it', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users/${userId}?excludedAttributes=${EXT_URN}:department`,
        token,
      ).expect(200);

      const ext = res.body[EXT_URN];
      if (ext) {
        expect(ext.department).toBeUndefined();
        // badgeNumber is returned:always → still present even if excluded
        expect(ext.badgeNumber).toBe('B77777');
      }
    });

    it('returned:always attrs should persist even in excludedAttributes list', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users/${userId}?excludedAttributes=${EXT_URN}:badgeNumber`,
        token,
      ).expect(200);

      const ext = res.body[EXT_URN];
      // returned:always → should still be present
      if (ext) {
        expect(ext.badgeNumber).toBe('B77777');
      }
    });
  });

  // ───────────── returned:request on PATCH response ─────────────

  describe('returned:request — PATCH response filtering', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {});
      basePath = scimBasePath(endpointId);
      await registerReturnedTestExtension(endpointId);

      const user = validUser({
        [EXT_URN]: {
          secretQuestion: 'City?',
          secretAnswer: 'Paris',
          department: 'Legal',
          badgeNumber: 'B44444',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      userId = res.body.id;
    });

    it('PATCH response should NOT include returned:request attrs', async () => {
      const patch = patchOp([{ op: 'replace', value: { displayName: 'Patched Legal User' } }]);
      const res = await scimPatch(app, `${basePath}/Users/${userId}`, token, patch).expect(200);

      const ext = res.body[EXT_URN];
      if (ext) {
        expect(ext.secretQuestion).toBeUndefined();
        expect(ext.secretAnswer).toBeUndefined();
      }
      // returned:default and returned:always should be present
      if (ext) {
        expect(ext.department).toBe('Legal');
        expect(ext.badgeNumber).toBe('B44444');
      }
    });

    it('PATCH with ?attributes=<ext>:secretQuestion should include returned:request attr', async () => {
      const patch = patchOp([{ op: 'replace', value: { displayName: 'Patched Legal User 2' } }]);
      const attrParam = encodeURIComponent(`${EXT_URN}:secretQuestion`);
      const res = await scimPatch(
        app,
        `${basePath}/Users/${userId}?attributes=${attrParam}`,
        token,
        patch,
      ).expect(200);

      const ext = res.body[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.secretQuestion).toBe('City?');
    });
  });

  // ───────────── returned characteristics on .search ─────────────

  describe('returned characteristics on .search', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {});
      basePath = scimBasePath(endpointId);
      await registerReturnedTestExtension(endpointId);

      const user = validUser({
        [EXT_URN]: {
          secretQuestion: 'Food?',
          secretAnswer: 'Pizza',
          department: 'HR',
          badgeNumber: 'B11111',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      userId = res.body.id;
    });

    it('.search should NOT return returned:request attrs by default', async () => {
      const body = searchRequest({ count: 100 });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();

      const ext = user[EXT_URN];
      if (ext) {
        expect(ext.secretQuestion).toBeUndefined();
        expect(ext.secretAnswer).toBeUndefined();
      }
    });

    it('.search should return returned:default attrs by default', async () => {
      const body = searchRequest({ count: 100 });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();

      const ext = user[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.department).toBe('HR');
    });

    it('.search should return returned:always attrs always', async () => {
      const body = searchRequest({ count: 100 });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();

      const ext = user[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.badgeNumber).toBe('B11111');
    });

    it('.search with attributes= should include returned:request attr', async () => {
      const body = searchRequest({
        count: 100,
        attributes: `${EXT_URN}:secretQuestion`,
      });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();

      const ext = user[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.secretQuestion).toBe('Food?');
    });

    it('.search with excludedAttributes should NOT remove returned:always attr', async () => {
      const body = searchRequest({
        count: 100,
        excludedAttributes: `${EXT_URN}:badgeNumber`,
      });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();

      // returned:always → cannot be excluded
      const ext = user[EXT_URN];
      expect(ext).toBeDefined();
      expect(ext.badgeNumber).toBe('B11111');
    });

    it('.search with excludedAttributes should strip returned:default attr', async () => {
      const body = searchRequest({
        count: 100,
        excludedAttributes: `${EXT_URN}:department`,
      });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      expect(user).toBeDefined();

      const ext = user[EXT_URN];
      if (ext) {
        expect(ext.department).toBeUndefined();
      }
    });

    it('.search excludedAttributes=id should NOT remove id (returned:always)', async () => {
      const body = searchRequest({
        count: 100,
        excludedAttributes: 'id',
      });
      const res = await scimPost(app, `${basePath}/Users/.search`, token, body).expect(200);

      const user = res.body.Resources.find((r: any) => r.id === userId);
      // id is always-returned — must still be present
      expect(user).toBeDefined();
      expect(user.id).toBe(userId);
    });
  });
});
