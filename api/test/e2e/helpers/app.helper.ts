import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';

import { AppModule } from '@app/modules/app/app.module';

/**
 * Bootstraps a full NestJS application for E2E testing.
 *
 * - Points Prisma at the test SQLite database (created by global-setup.ts)
 * - Applies the same middleware stack as production (global prefix, JSON parsing, etc.)
 * - Sets known auth credentials so test helpers can acquire tokens deterministically
 *
 * Call `app.close()` in your `afterAll()` to shut down cleanly.
 */
export async function createTestApp(): Promise<INestApplication> {
  // Read the test DB path from the marker file written by global-setup
  const markerPath = path.resolve(__dirname, '..', '.test-db-path');
  let testDbPath: string;

  if (fs.existsSync(markerPath)) {
    testDbPath = fs.readFileSync(markerPath, 'utf-8').trim();
  } else {
    testDbPath = path.resolve(__dirname, '..', '..', 'prisma', 'test.db');
  }

  // Deterministic auth credentials for E2E tests
  process.env.DATABASE_URL = `file:${testDbPath}`;
  process.env.SCIM_SHARED_SECRET = 'e2e-test-secret';
  process.env.JWT_SECRET = 'e2e-test-jwt-secret';
  process.env.OAUTH_CLIENT_ID = 'e2e-client';
  process.env.OAUTH_CLIENT_SECRET = 'e2e-client-secret';
  process.env.NODE_ENV = 'test';

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Mirror production middleware from main.ts
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.url.startsWith('//')) {
      req.url = req.url.replace(/\/\/+/, '/');
    }
    if (req.url.startsWith('/scim/v2')) {
      req.url = req.url.replace('/scim/v2', '/scim');
    }
    next();
  });

  app.use(
    json({
      limit: '5mb',
      type: (req) => {
        const ct = req.headers['content-type']?.toLowerCase() ?? '';
        return ct.includes('application/json') || ct.includes('application/scim+json');
      },
    }),
  );

  app.setGlobalPrefix('scim', {
    exclude: ['/'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  return app;
}
