import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import * as fs from 'fs';

import { AppModule } from '@app/modules/app/app.module';
import { applySpaFallback } from '@app/bootstrap/spa-fallback';
import { buildHelmetMiddleware, PERMISSIONS_POLICY_HEADER_VALUE } from '@app/security/helmet-config';
import { OAUTH_METADATA_PATH } from '@app/oauth/oauth.constants';

/**
 * Bootstraps a full NestJS application for E2E testing.
 *
 * - When PERSISTENCE_BACKEND=inmemory, uses InMemory SCIM storage
 * - When using Prisma backend, points at the PostgreSQL URL from marker file
 * - Applies the same middleware stack as production
 * - Sets known auth credentials so test helpers can acquire tokens deterministically
 *
 * Call `app.close()` in your `afterAll()` to shut down cleanly.
 */
export async function createTestApp(): Promise<INestApplication> {
  // Read the database URL from the marker file written by global-setup
  const markerPath = path.resolve(__dirname, '..', '.test-db-path');
  const backend = process.env.PERSISTENCE_BACKEND?.toLowerCase() ?? 'prisma';

  if (backend !== 'inmemory') {
    let dbUrl: string;
    if (fs.existsSync(markerPath)) {
      dbUrl = fs.readFileSync(markerPath, 'utf-8').trim();
    } else {
      dbUrl = process.env.DATABASE_URL ?? 'postgresql://scim:scim@localhost:5432/scimdb';
    }
    process.env.DATABASE_URL = dbUrl;
  }

  // Deterministic auth credentials for E2E tests
  process.env.SCIM_SHARED_SECRET = 'e2e-test-secret';
  process.env.JWT_SECRET = 'e2e-test-jwt-secret';
  process.env.OAUTH_CLIENT_ID = 'e2e-client';
  process.env.OAUTH_CLIENT_SECRET = 'e2e-client-secret';
  process.env.NODE_ENV = 'test';

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();

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

  // Phase N3a (2026-05-18): mirror the production helmet middleware so
  // the security-headers E2E spec sees what production sees. See
  // api/src/security/helmet-config.ts for design rationale.
  app.use(buildHelmetMiddleware(process.env.NODE_ENV));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY_HEADER_VALUE);
    next();
  });

  // Serve static files + SPA fallback (matches main.ts). Required by
  // spa-fallback.e2e-spec.ts and by any test that hits a SPA URL.
  app.useStaticAssets(path.join(__dirname, '..', '..', '..', 'public'), {
    index: false,
  });
  applySpaFallback(app);

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
    exclude: ['/', OAUTH_METADATA_PATH],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  // Bind the underlying http server to an ephemeral port BEFORE any test
  // makes a request. Otherwise supertest's request(app.getHttpServer()) lazy-
  // listens on each call and closes after the response. Concurrent
  // Promise.all([req1, req2, ...]) then races multiple listen/close cycles
  // on the SAME http.Server instance, which on a 2-core CI runner
  // intermittently produces 'read ECONNRESET' (worker A closes the socket
  // before worker B's response is fully flushed). Pre-listening keeps the
  // server bound for the lifetime of the suite and makes supertest reuse
  // the live socket. app.close() in afterAll() tears it down cleanly.
  await app.listen(0);
  return app;
}
