import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface CorpusCase { resource: string; strict: boolean; title: string }
const { cases, runCase } = createRequire(__filename)('./corpus/put-entry-preservation.cjs') as {
  cases: CorpusCase[];
  runCase(test: CorpusCase, send: (method: Method, path: string, body?: object) =>
    Promise<{ status: number; body: unknown }>): Promise<{ assertions: number }>;
};

describe('PUT retained-entry HTTP contract', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app.close(); });
  it.each(cases)('$title', async test => {
    const result = await runCase(test, async (method, path, body) => {
      const response = await request(app.getHttpServer() as Server)[method.toLowerCase() as 'get'](path)
        .set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/scim+json').send(body);
      const payload: unknown = response.body;
      return { status: response.status, body: payload };
    });
    expect(result.assertions).toBeGreaterThan(500);
  }, 60000);
});
