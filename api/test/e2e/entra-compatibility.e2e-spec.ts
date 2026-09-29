import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

const { cases, runCase } = require('./corpus/entra-compatibility.cjs');

describe('P9 public Microsoft Entra compatibility corpus', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app.close(); });

  for (const test of cases) {
    if (test.integration && process.env.SCIM_P9_INTEGRATION !== '1') {
      it.todo(`${test.id}: ${test.title}`);
      continue;
    }
    it(`${test.id}: ${test.title}`, async () => {
      const result = await runCase(test, async (
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: object,
      ) => {
        const response = await request(app.getHttpServer())[method.toLowerCase() as 'get'](path)
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', 'application/scim+json')
          .send(body);
        return { status: response.status, body: response.body };
      });
      expect(result.assertions).toBeGreaterThan(10);
    });
  }
});
