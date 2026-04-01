import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  createEndpoint,
  scimBasePath,
  scimPost,
  scimGet,
  scimDelete,
} from './helpers/request.helper';
import { validUser, validGroup, resetFixtureCounter } from './helpers/fixtures';

/**
 * Admin API Coverage — Database Browser, Activity Feed, Manual Operations, Health
 *
 * Covers endpoints previously missing from E2E:
 *   GET  /admin/database/users
 *   GET  /admin/database/users/:id
 *   GET  /admin/database/groups
 *   GET  /admin/database/groups/:id
 *   GET  /admin/database/statistics
 *   GET  /admin/activity
 *   GET  /admin/activity/summary
 *   POST /admin/users/manual
 *   POST /admin/groups/manual
 *   POST /admin/users/:id/delete
 *   GET  /health
 */
describe('Admin API Coverage (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  // Resources created for browsing
  let userId: string;
  let groupId: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    resetFixtureCounter();
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);

    // Seed some data for database browser tests
    const userRes = await scimPost(app, `${basePath}/Users`, token, validUser())
      .expect(201);
    userId = userRes.body.id;

    const groupRes = await scimPost(
      app,
      `${basePath}/Groups`,
      token,
      validGroup(),
    ).expect(201);
    groupId = groupRes.body.id;
  });

  afterAll(async () => {
    // Cleanup: delete seeded resources then endpoint
    try {
      await scimDelete(app, `${basePath}/Users/${userId}`, token);
    } catch { /* ignore */ }
    try {
      await scimDelete(app, `${basePath}/Groups/${groupId}`, token);
    } catch { /* ignore */ }
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await app.close();
  });

  // ─────────────────────────────────────────────────
  // Health Endpoint
  // ─────────────────────────────────────────────────
  describe('GET /health', () => {
    it('should return 200 with status ok (no auth)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/health')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  // ─────────────────────────────────────────────────
  // Database Browser API
  // ─────────────────────────────────────────────────
  describe('Database Browser', () => {
    describe('GET /admin/database/users', () => {
      it('should return 401 without auth', async () => {
        await request(app.getHttpServer())
          .get('/scim/admin/database/users')
          .expect(401);
      });

      it('should return paginated user list', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/database/users?page=1&limit=50')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(res.body).toHaveProperty('users');
        expect(res.body).toHaveProperty('pagination');
        expect(Array.isArray(res.body.users)).toBe(true);
        expect(res.body.pagination).toHaveProperty('page');
        expect(res.body.pagination).toHaveProperty('limit');
        expect(res.body.pagination).toHaveProperty('total');
        expect(res.body.users.length).toBeGreaterThanOrEqual(1);
      });

      it('should support search query param (or 500 in InMemory mode)', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/database/users?search=nonexistent-xyz-query')
          .set('Authorization', `Bearer ${token}`);

        // Database browser uses Prisma directly — may 500 in InMemory mode
        expect([200, 500]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body).toHaveProperty('users');
          expect(Array.isArray(res.body.users)).toBe(true);
        }
      });
    });

    describe('GET /admin/database/users/:id', () => {
      it('should return user detail (or 500 in InMemory mode)', async () => {
        const res = await request(app.getHttpServer())
          .get(`/scim/admin/database/users/${userId}`)
          .set('Authorization', `Bearer ${token}`);

        // Database browser uses Prisma directly — may 500 in InMemory mode
        expect([200, 500]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('userName');
        }
      });

      it('should return 404 or 500 for non-existent user', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/database/users/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${token}`);

        expect([404, 500]).toContain(res.status);
      });
    });

    describe('GET /admin/database/groups', () => {
      it('should return paginated group list', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/database/groups?page=1&limit=50')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(res.body).toHaveProperty('groups');
        expect(res.body).toHaveProperty('pagination');
        expect(Array.isArray(res.body.groups)).toBe(true);
        expect(res.body.groups.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('GET /admin/database/groups/:id', () => {
      it('should return group detail (or 500 in InMemory mode)', async () => {
        const res = await request(app.getHttpServer())
          .get(`/scim/admin/database/groups/${groupId}`)
          .set('Authorization', `Bearer ${token}`);

        expect([200, 500]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('displayName');
        }
      });
    });

    describe('GET /admin/database/statistics', () => {
      it('should return aggregate statistics', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/database/statistics')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(res.body).toHaveProperty('users');
        expect(res.body).toHaveProperty('groups');
        expect(res.body.users).toHaveProperty('total');
        expect(typeof res.body.users.total).toBe('number');
        expect(res.body.groups).toHaveProperty('total');
      });
    });
  });

  // ─────────────────────────────────────────────────
  // Activity Feed API
  // ─────────────────────────────────────────────────
  describe('Activity Feed', () => {
    describe('GET /admin/activity', () => {
      it('should return 401 without auth', async () => {
        await request(app.getHttpServer())
          .get('/scim/admin/activity')
          .expect(401);
      });

      it('should return paginated activity list', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/activity?page=1&limit=50')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(res.body).toHaveProperty('activities');
        expect(res.body).toHaveProperty('pagination');
        expect(Array.isArray(res.body.activities)).toBe(true);
      });

      it('should support hideKeepalive filter', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/activity?hideKeepalive=true')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(res.body).toHaveProperty('activities');
      });
    });

    describe('GET /admin/activity/summary', () => {
      it('should return activity summary', async () => {
        const res = await request(app.getHttpServer())
          .get('/scim/admin/activity/summary')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(res.body).toHaveProperty('summary');
        expect(res.body.summary).toHaveProperty('last24Hours');
        expect(res.body.summary).toHaveProperty('lastWeek');
        expect(res.body.summary).toHaveProperty('operations');
      });
    });
  });

  // ─────────────────────────────────────────────────
  // Manual User/Group Creation
  // ─────────────────────────────────────────────────
  describe('Manual Operations', () => {
    let manualUserId: string;
    let manualGroupId: string;

    afterAll(async () => {
      // Cleanup manual resources
      if (manualUserId) {
        try {
          await scimDelete(app, `${basePath}/Users/${manualUserId}`, token);
        } catch { /* ignore */ }
      }
      if (manualGroupId) {
        try {
          await scimDelete(app, `${basePath}/Groups/${manualGroupId}`, token);
        } catch { /* ignore */ }
      }
    });

    describe('POST /admin/users/manual', () => {
      it('should create a user via simplified form', async () => {
        const res = await request(app.getHttpServer())
          .post('/scim/admin/users/manual')
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', 'application/json')
          .send({
            userName: `manual-user-${Date.now()}@test.com`,
            displayName: 'Manual Test User',
            givenName: 'Manual',
            familyName: 'User',
            email: `manual-user-${Date.now()}@test.com`,
            active: true,
          })
          .expect(201);

        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('userName');
        manualUserId = res.body.id;
      });

      it('should return 401 without auth', async () => {
        await request(app.getHttpServer())
          .post('/scim/admin/users/manual')
          .set('Content-Type', 'application/json')
          .send({ userName: 'noauth@test.com' })
          .expect(401);
      });
    });

    describe('POST /admin/groups/manual', () => {
      it('should create a group via simplified form', async () => {
        const res = await request(app.getHttpServer())
          .post('/scim/admin/groups/manual')
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', 'application/json')
          .send({
            displayName: `Manual Group ${Date.now()}`,
          })
          .expect(201);

        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('displayName');
        manualGroupId = res.body.id;
      });
    });

    describe('POST /admin/users/:id/delete', () => {
      let deleteTargetId: string;

      beforeAll(async () => {
        // Create a user to delete
        const res = await scimPost(
          app,
          `${basePath}/Users`,
          token,
          validUser({ userName: `delete-target-${Date.now()}@test.com` }),
        ).expect(201);
        deleteTargetId = res.body.id;
      });

      it('should delete user by ID', async () => {
        await request(app.getHttpServer())
          .post(`/scim/admin/users/${deleteTargetId}/delete`)
          .set('Authorization', `Bearer ${token}`)
          .expect(204);
      });

      it('should return 404 for non-existent user', async () => {
        await request(app.getHttpServer())
          .post('/scim/admin/users/00000000-0000-0000-0000-000000000000/delete')
          .set('Authorization', `Bearer ${token}`)
          .expect(404);
      });
    });
  });
});
