import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

describe('Admin Version API (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should require authentication', async () => {
    await request(app.getHttpServer())
      .get('/scim/admin/version')
      .expect(401);
  });

  it('should return full running instance metadata', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/version')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(typeof res.body.version).toBe('string');

    expect(res.body.service).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        environment: expect.any(String),
        apiPrefix: expect.any(String),
        scimBasePath: expect.stringMatching(/^\/.+\/v2$/),
        now: expect.any(String),
        startedAt: expect.any(String),
        uptimeSeconds: expect.any(Number),
        timezone: expect.any(String),
      }),
    );

    expect(res.body.runtime).toEqual(
      expect.objectContaining({
        node: expect.any(String),
        platform: expect.any(String),
        arch: expect.any(String),
        pid: expect.any(Number),
        hostname: expect.any(String),
        cpus: expect.any(Number),
        containerized: expect.any(Boolean),
        memory: expect.objectContaining({
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number),
          external: expect.any(Number),
          arrayBuffers: expect.any(Number),
        }),
      }),
    );

    expect(res.body.auth).toEqual(
      expect.objectContaining({
        oauthClientSecretConfigured: expect.any(Boolean),
        jwtSecretConfigured: expect.any(Boolean),
        scimSharedSecretConfigured: expect.any(Boolean),
      }),
    );

    expect(res.body.storage).toEqual(
      expect.objectContaining({
        databaseProvider: 'sqlite',
        blobBackupConfigured: expect.any(Boolean),
      }),
    );

    if (res.body.storage.databaseUrl) {
      expect(res.body.storage.databaseUrl).not.toMatch(/(token|secret|password)=/i);
      expect(res.body.storage.databaseUrl).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/i);
    }

    expect(res.body.deployment).toEqual(
      expect.objectContaining({
        backupMode: expect.any(String),
      }),
    );

    expect(['blob', 'azureFiles', 'none']).toContain(res.body.deployment.backupMode);
  });
});
