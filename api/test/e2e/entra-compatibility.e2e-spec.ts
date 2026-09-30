import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface CorpusCase { id: string; title: string }
interface WireResponse { status: number; body: unknown }
const loadCorpus = createRequire(__filename);
const { cases, runCase } = loadCorpus('./corpus/entra-compatibility.cjs') as {
  cases: CorpusCase[];
  runCase(test: CorpusCase, send: (method: Method, path: string, body?: object) => Promise<WireResponse>):
    Promise<{ id: string; assertions: number }>;
};

describe('P9 public Microsoft Entra compatibility corpus', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app.close(); });

  for (const test of cases) {
    it(`${test.id}: ${test.title}`, async () => {
      const result = await runCase(test, async (
        method: Method, path: string, body?: object,
      ) => {
        const response = await request(app.getHttpServer() as Server)[method.toLowerCase() as 'get'](path)
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', 'application/scim+json')
          .send(body);
        const payload: unknown = response.body;
        return { status: response.status, body: payload };
      });
      expect(result.assertions).toBeGreaterThan(10);
    });
  }
});
