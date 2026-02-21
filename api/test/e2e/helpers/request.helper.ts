import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { beginE2eFlowStep, finishE2eFlowStep } from './flow-trace.helper';

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
  const req = request(app.getHttpServer())
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);
  const trace = beginE2eFlowStep({
    method: 'POST',
    url: path,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/scim+json',
    },
    body,
  });
  req.on('response', (res: any) => {
    finishE2eFlowStep(trace, {
      status: res.status,
      headers: res.headers,
      body: res.body ?? res.text,
    });
  });
  req.on('error', (err: Error) => {
    finishE2eFlowStep(trace, {
      errorMessage: err.message,
    });
  });
  return req;
}

// ────────────────────── GET ──────────────────────

export function scimGet(
  app: INestApplication,
  path: string,
  token: string,
): request.Test {
  const req = request(app.getHttpServer())
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/scim+json');
  const trace = beginE2eFlowStep({
    method: 'GET',
    url: path,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/scim+json',
    },
  });
  req.on('response', (res: any) => {
    finishE2eFlowStep(trace, {
      status: res.status,
      headers: res.headers,
      body: res.body ?? res.text,
    });
  });
  req.on('error', (err: Error) => {
    finishE2eFlowStep(trace, {
      errorMessage: err.message,
    });
  });
  return req;
}

// ────────────────────── PUT ──────────────────────

export function scimPut(
  app: INestApplication,
  path: string,
  token: string,
  body: object,
): request.Test {
  const req = request(app.getHttpServer())
    .put(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);
  const trace = beginE2eFlowStep({
    method: 'PUT',
    url: path,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/scim+json',
    },
    body,
  });
  req.on('response', (res: any) => {
    finishE2eFlowStep(trace, {
      status: res.status,
      headers: res.headers,
      body: res.body ?? res.text,
    });
  });
  req.on('error', (err: Error) => {
    finishE2eFlowStep(trace, {
      errorMessage: err.message,
    });
  });
  return req;
}

// ────────────────────── PATCH ──────────────────────

export function scimPatch(
  app: INestApplication,
  path: string,
  token: string,
  body: object,
): request.Test {
  const req = request(app.getHttpServer())
    .patch(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);
  const trace = beginE2eFlowStep({
    method: 'PATCH',
    url: path,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/scim+json',
    },
    body,
  });
  req.on('response', (res: any) => {
    finishE2eFlowStep(trace, {
      status: res.status,
      headers: res.headers,
      body: res.body ?? res.text,
    });
  });
  req.on('error', (err: Error) => {
    finishE2eFlowStep(trace, {
      errorMessage: err.message,
    });
  });
  return req;
}

// ────────────────────── DELETE ──────────────────────

export function scimDelete(
  app: INestApplication,
  path: string,
  token: string,
): request.Test {
  const req = request(app.getHttpServer())
    .delete(path)
    .set('Authorization', `Bearer ${token}`);
  const trace = beginE2eFlowStep({
    method: 'DELETE',
    url: path,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  req.on('response', (res: any) => {
    finishE2eFlowStep(trace, {
      status: res.status,
      headers: res.headers,
      body: res.body ?? res.text,
    });
  });
  req.on('error', (err: Error) => {
    finishE2eFlowStep(trace, {
      errorMessage: err.message,
    });
  });
  return req;
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
  const requestBody = { name: endpointName };
  const trace = beginE2eFlowStep({
    method: 'POST',
    url: '/scim/admin/endpoints',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });
  const res: Response = await request(app.getHttpServer())
    .post('/scim/admin/endpoints')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(requestBody)
    .expect(201);

  finishE2eFlowStep(trace, {
    status: res.status,
    headers: res.headers as Record<string, string | string[]>,
    body: res.body,
  });

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
  const requestBody = { name: endpointName, config };
  const trace = beginE2eFlowStep({
    method: 'POST',
    url: '/scim/admin/endpoints',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });
  const res: Response = await request(app.getHttpServer())
    .post('/scim/admin/endpoints')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(requestBody)
    .expect(201);

  finishE2eFlowStep(trace, {
    status: res.status,
    headers: res.headers as Record<string, string | string[]>,
    body: res.body,
  });

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
  const trace = beginE2eFlowStep({
    method: 'PATCH',
    url: `/scim/admin/endpoints/${endpointId}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: { active: false },
  });
  const res = await request(app.getHttpServer())
    .patch(`/scim/admin/endpoints/${endpointId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ active: false })
    .expect(200);

  finishE2eFlowStep(trace, {
    status: res.status,
    headers: res.headers as Record<string, string | string[]>,
    body: res.body,
  });
}

/**
 * Returns the SCIM base path for a given endpoint.
 * Example: `/scim/endpoints/abc123`
 */
export function scimBasePath(endpointId: string): string {
  return `/scim/endpoints/${endpointId}`;
}
