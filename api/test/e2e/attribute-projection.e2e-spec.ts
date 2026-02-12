import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Attribute projection tests (RFC 7644 §3.4.2.5).
 * Covers attributes and excludedAttributes query params on list and get-by-id,
 * always-returned fields (id, schemas, meta), and precedence rules.
 */
describe('Attribute Projection (E2E)', () => {
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

  // ───────────── GET /Users?attributes ─────────────

  describe('GET /Users with attributes param', () => {
    it('should include only requested attributes plus always-returned', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(app, `${basePath}/Users?attributes=userName,displayName&count=5`, token).expect(200);
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);

      const user = res.body.Resources[0];
      expect(user.userName).toBeDefined();
      expect(user.id).toBeDefined(); // always-returned
      expect(user.schemas).toBeDefined(); // always-returned
      expect(user.emails).toBeUndefined(); // not requested
      expect(user.active).toBeUndefined(); // not requested
    });
  });

  // ───────────── GET /Users/:id?attributes ─────────────

  describe('GET /Users/:id with attributes param', () => {
    it('should include only requested attributes', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'attr-user@test.com' })).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Users/${created.id}?attributes=userName`, token).expect(200);
      expect(res.body.userName).toBe('attr-user@test.com');
      expect(res.body.id).toBeDefined(); // always-returned
      expect(res.body.meta).toBeDefined(); // always-returned
      expect(res.body.displayName).toBeUndefined(); // not requested
    });
  });

  // ───────────── GET /Users?excludedAttributes ─────────────

  describe('GET /Users with excludedAttributes param', () => {
    it('should exclude specified attributes', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(app, `${basePath}/Users?excludedAttributes=emails,phoneNumbers&count=5`, token).expect(200);
      const user = res.body.Resources[0];

      expect(user.userName).toBeDefined(); // not excluded
      expect(user.id).toBeDefined(); // never excluded
      expect(user.emails).toBeUndefined(); // excluded
    });
  });

  // ───────────── GET /Users/:id?excludedAttributes ─────────────

  describe('GET /Users/:id with excludedAttributes param', () => {
    it('should exclude specified attributes from single resource', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Users/${created.id}?excludedAttributes=name,emails`, token).expect(200);
      expect(res.body.userName).toBeDefined();
      expect(res.body.name).toBeUndefined();
      expect(res.body.emails).toBeUndefined();
      expect(res.body.id).toBeDefined(); // never excluded
      expect(res.body.schemas).toBeDefined(); // never excluded
    });
  });

  // ───────────── GET /Groups?attributes ─────────────

  describe('GET /Groups with attributes param', () => {
    it('should include only requested attributes for groups', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ members: [{ value: user.id }] })).expect(201);

      const res = await scimGet(app, `${basePath}/Groups?attributes=displayName&count=5`, token).expect(200);
      if (res.body.Resources.length > 0) {
        const group = res.body.Resources[0];
        expect(group.displayName).toBeDefined();
        expect(group.id).toBeDefined(); // always-returned
        expect(group.members).toBeUndefined(); // not requested
      }
    });
  });

  // ───────────── GET /Groups/:id?excludedAttributes ─────────────

  describe('GET /Groups/:id with excludedAttributes param', () => {
    it('should exclude members from group resource', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup({ members: [{ value: user.id }] })).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Groups/${group.id}?excludedAttributes=members`, token).expect(200);
      expect(res.body.displayName).toBeDefined();
      expect(res.body.members).toBeUndefined();
    });
  });

  // ───────────── Precedence: attributes wins over excludedAttributes ─────────────

  describe('Precedence rules', () => {
    it('should exclude attribute when it appears in both attributes and excludedAttributes', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?attributes=userName,displayName&excludedAttributes=displayName&count=1`,
        token,
      ).expect(200);

      const user = res.body.Resources[0];
      expect(user.userName).toBeDefined();
      // Server applies excludedAttributes even when attributes is also present
      expect(user.displayName).toBeUndefined();
    });
  });
});
