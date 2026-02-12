import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Acquires an OAuth access token using the deterministic E2E test credentials.
 */
export async function getAuthToken(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/scim/oauth/token')
    .set('Content-Type', 'application/json')
    .send({
      grant_type: 'client_credentials',
      client_id: 'e2e-client',
      client_secret: 'e2e-client-secret',
    })
    .expect(201);

  return res.body.access_token as string;
}

/**
 * Returns the legacy shared-secret bearer token for auth.
 * Simpler than OAuth — useful for quick tests.
 */
export function getLegacyToken(): string {
  return 'e2e-test-secret';
}
