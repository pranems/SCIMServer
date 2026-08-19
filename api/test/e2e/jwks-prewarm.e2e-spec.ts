/**
 * W1.2 - boot-time JWKS prewarm (E2E).
 *
 * The prewarm runs once during `onModuleInit`, so it cannot be triggered from a
 * request. What CAN be asserted end-to-end is that it ran at all, which is the
 * thing that silently breaks: the service takes the credential repository as an
 * `@Optional()` token, so a missing module import would leave it `undefined`
 * and the feature would ship completely inert while every unit test still
 * passed.
 *
 * This spec is therefore also the wiring test for that token, and it exercises
 * the PRISMA implementation of `findAllActiveByType` (the in-memory sibling is
 * covered by its own unit spec).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

describe('JWKS boot prewarm (E2E) - W1.2', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    adminToken = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('W1.2-E1: the prewarm runs at boot and reports what it found', async () => {
    const recent = await request(app.getHttpServer())
      .get('/scim/admin/log-config/recent?category=auth&limit=500')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entries = recent.body.entries as Array<Record<string, unknown>>;
    const prewarm = entries.find((e) => e.message === 'JWKS prewarm complete');

    // If this is undefined the service never ran - almost certainly because the
    // credential repository token did not resolve.
    expect(prewarm).toBeDefined();

    const data = prewarm!.data as Record<string, unknown>;
    expect(typeof data.trusts).toBe('number');
    expect(typeof data.distinctJwksUris).toBe('number');
    // Never more distinct URIs than trusts - they are deduplicated, not invented.
    expect(data.distinctJwksUris as number).toBeLessThanOrEqual(data.trusts as number);
  });

  it('W1.2-E2: the prewarm did not fail its trust lookup', async () => {
    const recent = await request(app.getHttpServer())
      .get('/scim/admin/log-config/recent?category=auth&limit=500')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entries = recent.body.entries as Array<Record<string, unknown>>;
    const skipped = entries.find((e) => e.message === 'JWKS prewarm skipped (trust lookup failed at boot)');

    expect(skipped).toBeUndefined();
  });
});
