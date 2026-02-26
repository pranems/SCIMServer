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
      // Guard: group was created above — must appear in results
      expect(res.body.Resources.length).toBeGreaterThan(0);
      const group = res.body.Resources[0];
      expect(group.displayName).toBeDefined();
      expect(group.id).toBeDefined(); // always-returned
      expect(group.members).toBeUndefined(); // not requested
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

  // ───────────── G8g: Write-Response Attribute Projection (RFC 7644 §3.9) ─────────────

  describe('G8g — Write-response attributes/excludedAttributes projection', () => {

    describe('POST /Users with projection params', () => {
      it('should return only requested attributes on POST create', async () => {
        const res = await scimPost(
          app,
          `${basePath}/Users?attributes=userName`,
          token,
          validUser({ userName: 'g8g-post-proj@test.com' }),
        ).expect(201);

        expect(res.body.userName).toBe('g8g-post-proj@test.com');
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.schemas).toBeDefined(); // always-returned
        expect(res.body.meta).toBeDefined(); // always-returned
        expect(res.body.displayName).toBeUndefined(); // not requested
        expect(res.body.emails).toBeUndefined(); // not requested
      });

      it('should exclude specified attributes on POST create', async () => {
        const res = await scimPost(
          app,
          `${basePath}/Users?excludedAttributes=emails,name`,
          token,
          validUser(),
        ).expect(201);

        expect(res.body.userName).toBeDefined();
        expect(res.body.emails).toBeUndefined(); // excluded
        expect(res.body.name).toBeUndefined(); // excluded
        expect(res.body.id).toBeDefined(); // never excluded
      });
    });

    describe('PUT /Users/:id with projection params', () => {
      it('should return only requested attributes on PUT replace', async () => {
        const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'g8g-put@test.com' })).expect(201)).body;

        const res = await scimPut(
          app,
          `${basePath}/Users/${created.id}?attributes=userName,active`,
          token,
          validUser({ userName: 'g8g-put@test.com', active: true }),
        ).expect(200);

        expect(res.body.userName).toBe('g8g-put@test.com');
        expect(res.body.active).toBe(true);
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.displayName).toBeUndefined(); // not requested
        expect(res.body.emails).toBeUndefined(); // not requested
      });
    });

    describe('PATCH /Users/:id with projection params', () => {
      it('should return only requested attributes on PATCH update', async () => {
        const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'g8g-patch@test.com' })).expect(201)).body;

        const res = await scimPatch(
          app,
          `${basePath}/Users/${created.id}?attributes=userName`,
          token,
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', value: { displayName: 'Patched' } }],
          },
        ).expect(200);

        expect(res.body.userName).toBe('g8g-patch@test.com');
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.displayName).toBeUndefined(); // not requested (even though we patched it)
      });

      it('should exclude specified attributes on PATCH update', async () => {
        const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

        const res = await scimPatch(
          app,
          `${basePath}/Users/${created.id}?excludedAttributes=emails,name`,
          token,
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', value: { active: false } }],
          },
        ).expect(200);

        expect(res.body.userName).toBeDefined();
        expect(res.body.emails).toBeUndefined(); // excluded
        expect(res.body.name).toBeUndefined(); // excluded
      });
    });

    describe('POST /Groups with projection params', () => {
      it('should return only requested attributes on POST create', async () => {
        const res = await scimPost(
          app,
          `${basePath}/Groups?attributes=displayName`,
          token,
          validGroup(),
        ).expect(201);

        expect(res.body.displayName).toBeDefined();
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.schemas).toBeDefined(); // always-returned
        expect(res.body.members).toBeUndefined(); // not requested
      });
    });

    describe('PUT /Groups/:id with projection params', () => {
      it('should return only requested attributes on PUT replace', async () => {
        const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

        const res = await scimPut(
          app,
          `${basePath}/Groups/${group.id}?attributes=displayName`,
          token,
          validGroup({ displayName: 'G8g PUT Group' }),
        ).expect(200);

        expect(res.body.displayName).toBe('G8g PUT Group');
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.members).toBeUndefined(); // not requested
      });
    });

    describe('PATCH /Groups/:id with projection params', () => {
      it('should exclude specified attributes on PATCH update', async () => {
        const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

        const res = await scimPatch(
          app,
          `${basePath}/Groups/${group.id}?excludedAttributes=members`,
          token,
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', value: { displayName: 'G8g Patched' } }],
          },
        ).expect(200);

        expect(res.body.displayName).toBe('G8g Patched');
        expect(res.body.members).toBeUndefined(); // excluded
      });

      it('should return only requested attributes on PATCH with ?attributes=', async () => {
        const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

        const res = await scimPatch(
          app,
          `${basePath}/Groups/${group.id}?attributes=displayName`,
          token,
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', value: { displayName: 'G8g Attr Patched' } }],
          },
        ).expect(200);

        expect(res.body.displayName).toBe('G8g Attr Patched');
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.schemas).toBeDefined(); // always-returned
        expect(res.body.members).toBeUndefined(); // not requested
        expect(res.body.externalId).toBeUndefined(); // not requested
      });
    });

    describe('PUT /Users/:id with excludedAttributes', () => {
      it('should exclude specified attributes on PUT replace', async () => {
        const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'g8g-put-excl@test.com' })).expect(201)).body;

        const res = await scimPut(
          app,
          `${basePath}/Users/${created.id}?excludedAttributes=emails,name`,
          token,
          validUser({ userName: 'g8g-put-excl@test.com', active: true }),
        ).expect(200);

        expect(res.body.userName).toBe('g8g-put-excl@test.com');
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.emails).toBeUndefined(); // excluded
        expect(res.body.name).toBeUndefined(); // excluded
        expect(res.body.active).toBe(true); // not excluded
      });
    });

    describe('POST /Groups with excludedAttributes', () => {
      it('should exclude specified attributes on POST create', async () => {
        const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

        const res = await scimPost(
          app,
          `${basePath}/Groups?excludedAttributes=members`,
          token,
          validGroup({ members: [{ value: user.id }] }),
        ).expect(201);

        expect(res.body.displayName).toBeDefined();
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.members).toBeUndefined(); // excluded
      });
    });

    describe('Precedence: both attributes + excludedAttributes on write', () => {
      it('attributes should take precedence over excludedAttributes', async () => {
        const res = await scimPost(
          app,
          `${basePath}/Users?attributes=userName,name&excludedAttributes=name`,
          token,
          validUser({ userName: 'g8g-precedence@test.com' }),
        ).expect(201);

        // attributes wins: userName and name are in the include list
        expect(res.body.userName).toBe('g8g-precedence@test.com');
        expect(res.body.name).toBeDefined(); // attributes takes precedence over excludedAttributes
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.emails).toBeUndefined(); // not in attributes list
      });
    });

    describe('Always-returned protection on write responses', () => {
      it('excludedAttributes=id,schemas,meta should NOT remove always-returned fields', async () => {
        const res = await scimPost(
          app,
          `${basePath}/Users?excludedAttributes=id,schemas,meta`,
          token,
          validUser({ userName: 'g8g-always@test.com' }),
        ).expect(201);

        // Always-returned fields cannot be excluded
        expect(res.body.id).toBeDefined();
        expect(res.body.schemas).toBeDefined();
        expect(res.body.meta).toBeDefined();
        expect(res.body.userName).toBeDefined(); // userName is always-returned for Users
      });
    });

    describe('Dotted sub-attribute path on write response', () => {
      it('attributes=name.givenName should return only that sub-attr', async () => {
        const res = await scimPost(
          app,
          `${basePath}/Users?attributes=name.givenName`,
          token,
          validUser({ userName: 'g8g-dotted@test.com', name: { givenName: 'Dotted', familyName: 'Test' } }),
        ).expect(201);

        expect(res.body.name).toBeDefined();
        expect(res.body.name.givenName).toBe('Dotted');
        expect(res.body.name.familyName).toBeUndefined(); // not requested
        expect(res.body.id).toBeDefined(); // always-returned
        expect(res.body.emails).toBeUndefined(); // not requested
      });
    });
  });
});
