import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';

/**
 * SCIM-aware HTTP request helpers.
 *
 * Every helper sets the `Authorization` and `Content-Type` headers
 * automatically so individual tests stay concise and DRY.
 */

// ────────────────────── POST ──────────────────────

export function scimPost(
  app: INestApplication,
  path: string,
  token: string,
  body: object,
): request.Test {
  return request(app.getHttpServer())
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);
}

// ────────────────────── GET ──────────────────────

export function scimGet(
  app: INestApplication,
  path: string,
  token: string,
): request.Test {
  return request(app.getHttpServer())
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/scim+json');
}

// ────────────────────── PUT ──────────────────────

export function scimPut(
  app: INestApplication,
  path: string,
  token: string,
  body: object,
): request.Test {
  return request(app.getHttpServer())
    .put(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);
}

// ────────────────────── PATCH ──────────────────────

export function scimPatch(
  app: INestApplication,
  path: string,
  token: string,
  body: object,
): request.Test {
  return request(app.getHttpServer())
    .patch(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);
}

// ────────────────────── DELETE ──────────────────────

export function scimDelete(
  app: INestApplication,
  path: string,
  token: string,
): request.Test {
  return request(app.getHttpServer())
    .delete(path)
    .set('Authorization', `Bearer ${token}`);
}

// ────────────────────── Endpoint helpers ──────────────────────

/**
 * Creates a new SCIM endpoint and returns its `id`.
 * This is required before any SCIM User/Group operations.
 */
export async function createEndpoint(
  app: INestApplication,
  token: string,
  name?: string,
): Promise<string> {
  const endpointName = name ?? `e2e-${Date.now()}`;
  const res: Response = await request(app.getHttpServer())
    .post('/scim/admin/endpoints')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ name: endpointName })
    .expect(201);

  return res.body.id as string;
}

/**
 * Creates a new SCIM endpoint with configuration flags and returns its `id`.
 * Use this to test config-dependent behaviors like multi-member PATCH,
 * PatchOpAllowRemoveAllMembers, VerbosePatchSupported, etc.
 */
export async function createEndpointWithConfig(
  app: INestApplication,
  token: string,
  config: Record<string, string | boolean>,
  name?: string,
): Promise<string> {
  const endpointName = name ?? `e2e-cfg-${Date.now()}`;
  const res: Response = await request(app.getHttpServer())
    .post('/scim/admin/endpoints')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ name: endpointName, config })
    .expect(201);

  return res.body.id as string;
}

/**
 * Deactivates an endpoint via the admin API.
 */
export async function deactivateEndpoint(
  app: INestApplication,
  token: string,
  endpointId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .patch(`/scim/admin/endpoints/${endpointId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ active: false })
    .expect(200);
}

/**
 * Returns the SCIM base path for a given endpoint.
 * Example: `/scim/endpoints/abc123`
 */
export function scimBasePath(endpointId: string): string {
  return `/scim/endpoints/${endpointId}`;
}
