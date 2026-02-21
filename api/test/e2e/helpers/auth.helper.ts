import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { beginE2eFlowStep, finishE2eFlowStep } from './flow-trace.helper';

/**
 * Acquires an OAuth access token using the deterministic E2E test credentials.
 */
export async function getAuthToken(app: INestApplication): Promise<string> {
  const requestBody = {
    grant_type: 'client_credentials',
    client_id: 'e2e-client',
    client_secret: 'e2e-client-secret',
  };
  const trace = beginE2eFlowStep({
    method: 'POST',
    url: '/scim/oauth/token',
    headers: {
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });

  const res = await request(app.getHttpServer())
    .post('/scim/oauth/token')
    .set('Content-Type', 'application/json')
    .send(requestBody)
    .expect(201);

  finishE2eFlowStep(trace, {
    status: res.status,
    headers: res.headers as Record<string, string | string[]>,
    body: res.body,
  });

  return res.body.access_token as string;
}

/**
 * Returns the legacy shared-secret bearer token for auth.
 * Simpler than OAuth — useful for quick tests.
 */
export function getLegacyToken(): string {
  return 'e2e-test-secret';
}
