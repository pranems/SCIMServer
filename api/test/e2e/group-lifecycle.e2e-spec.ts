import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
  scimDelete,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  addMemberPatch,
  removeMemberPatch,
  replaceDisplayNamePatch,
  resetFixtureCounter,
} from './helpers/fixtures';

describe('Group Lifecycle (E2E)', () => {
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

  // ───────────── CREATE ─────────────

  describe('POST /Groups', () => {
    it('should create a group and return 201', async () => {
      const group = validGroup();
      const res = await scimPost(app, `${basePath}/Groups`, token, group).expect(201);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
      expect(res.body.id).toBeDefined();
      expect(res.body.displayName).toBe(group.displayName);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('Group');
      expect(res.body.meta.location).toContain(`/Groups/${res.body.id}`);
    });

    it('should create a group with initial members', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const group = validGroup({ members: [{ value: user.id }] });
      const res = await scimPost(app, `${basePath}/Groups`, token, group).expect(201);

      expect(res.body.members).toBeDefined();
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].value).toBe(user.id);
    });

    it('should return 409 when displayName already exists in same endpoint', async () => {
      const group = validGroup({ displayName: 'UniqueGroup' });
      await scimPost(app, `${basePath}/Groups`, token, group).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, group).expect(409);
    });
  });

  // ───────────── READ ─────────────

  describe('GET /Groups/:id', () => {
    it('should retrieve a group by id', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Groups/${created.id}`, token).expect(200);
      expect(res.body.id).toBe(created.id);
      expect(res.body.displayName).toBe(created.displayName);
    });

    it('should return 404 for non-existent group', async () => {
      await scimGet(app, `${basePath}/Groups/does-not-exist`, token).expect(404);
    });
  });

  // ───────────── LIST ─────────────

  describe('GET /Groups', () => {
    it('should return a list response', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);

      const res = await scimGet(app, `${basePath}/Groups`, token).expect(200);
      expect(res.body.totalResults).toBe(2);
      expect(res.body.Resources).toHaveLength(2);
    });

    it('should filter by displayName eq', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      const target = validGroup({ displayName: 'FindThisGroup' });
      await scimPost(app, `${basePath}/Groups`, token, target).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=displayName eq "FindThisGroup"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].displayName).toBe('FindThisGroup');
    });
  });

  // ───────────── REPLACE ─────────────

  describe('PUT /Groups/:id', () => {
    it('should replace a group preserving id', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const replacement = validGroup({ displayName: created.displayName });
      const res = await scimPut(app, `${basePath}/Groups/${created.id}`, token, replacement).expect(200);

      expect(res.body.id).toBe(created.id);
    });
  });

  // ───────────── PATCH: Membership ─────────────

  describe('PATCH /Groups/:id (membership)', () => {
    it('should add a member to a group', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const res = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        addMemberPatch(user.id),
      ).expect(200);

      expect(res.body.members).toBeDefined();
      expect(res.body.members.some((m: { value: string }) => m.value === user.id)).toBe(true);
    });

    it('should remove a member from a group', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (
        await scimPost(app, `${basePath}/Groups`, token, validGroup({ members: [{ value: user.id }] })).expect(201)
      ).body;

      expect(group.members).toHaveLength(1);

      const res = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        removeMemberPatch(user.id),
      ).expect(200);

      expect(res.body.members ?? []).toHaveLength(0);
    });

    it('should replace displayName via PATCH', async () => {
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const res = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        replaceDisplayNamePatch('Renamed Group'),
      ).expect(200);

      expect(res.body.displayName).toBe('Renamed Group');
    });
  });

  // ───────────── DELETE ─────────────

  describe('DELETE /Groups/:id', () => {
    it('should delete a group and return 204', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimDelete(app, `${basePath}/Groups/${created.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Groups/${created.id}`, token).expect(404);
    });
  });
});
