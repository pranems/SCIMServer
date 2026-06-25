import 'reflect-metadata';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './modules/app/app.module';
import { parseCorsOrigin } from './security/cors-origin';
import { buildHelmetMiddleware, PERMISSIONS_POLICY_HEADER_VALUE } from './security/helmet-config';
import { applySpaFallback } from './bootstrap/spa-fallback';
import { OAUTH_METADATA_PATH } from './oauth/oauth.constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true
  });

  // Trust reverse proxy (Azure Container Apps, NGINX, etc.) so that
  // req.protocol, req.hostname and req.ip reflect the original client request
  // rather than the internal HTTP connection between the proxy and the container.
  app.set('trust proxy', true);

  // Disable Express's automatic content-hash ETag. SCIM defines its own
  // meta.version-based weak ETag (RFC 7644 §3.14), set by ScimEtagInterceptor.
  // The Express content hash is meaningless for SCIM versioning, is applied to
  // list/error/discovery responses where it does not belong, and (Gap 10) would
  // re-add an ETag header on resources whose endpoint sets etag.supported=false.
  app.set('etag', false);

  // Enable NestJS lifecycle hooks so OnModuleDestroy (e.g. Prisma $disconnect) fires on SIGTERM/SIGINT
  app.enableShutdownHooks();

  // RFC 7644 §1.3 URL rewrite: SCIM endpoints are published at /scim/v2/* (spec-aligned)
  // but controllers are mounted at the /scim global prefix. This middleware rewrites
  // incoming /scim/v2/* → /scim/* so that both URL forms work. This is intentional
  // permanent behavior - Entra ID, setup scripts, and live tests all use /scim/v2 URLs.
  // Changing the global prefix to 'scim/v2' is not feasible because it would break
  // admin routes (/scim/admin/*) and endpoint routes (/scim/endpoints/*).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Normalize double slashes just in case
    if (req.url.startsWith('//')) {
      req.url = req.url.replace(/\/\/+/, '/');
    }
    if (req.url.startsWith('/scim/v2')) {
      // Remove the /v2 segment
      req.url = req.url.replace('/scim/v2', '/scim');
    }
    next();
  });

  // Early X-Request-Id middleware - runs before guards and interceptors so that
  // 401/403/415 error responses also carry the correlation header.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // Phase N3a (2026-05-18): helmet middleware - locks in the standard
  // browser-enforced defense-in-depth response headers (CSP, X-Frame-Options,
  // X-Content-Type-Options, Referrer-Policy, COOP/CORP, Origin-Agent-Cluster,
  // X-Permitted-Cross-Domain-Policies, X-DNS-Prefetch-Control, X-Download-Options
  // and, in production only, Strict-Transport-Security). See
  // api/src/security/helmet-config.ts for the full design rationale and
  // api/test/e2e/security-headers.e2e-spec.ts for the contract.
  // Inserted EARLY so the headers are set on every response, including
  // 401/403/415 short-circuits from guards.
  app.use(buildHelmetMiddleware(process.env.NODE_ENV));

  // Permissions-Policy is NOT set by helmet by default. Emit the locked-down
  // value alongside helmet so XSS attempts to use camera/mic/geo/payment are
  // blocked at the browser layer even if they bypass CSP.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY_HEADER_VALUE);
    next();
  });

  // S-4: CORS origin is configurable via the CORS_ORIGIN env var.
  // Unset/empty defaults to `true` (allow-all) to preserve backward
  // compatibility with the previous unconditional `origin: true`.
  // Set CORS_ORIGIN=https://app.example.com,https://other.example.com to
  // restrict in production. CORS_ORIGIN=false disables CORS entirely.
  // See api/src/security/cors-origin.ts for the full behavior matrix.
  const corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN);
  const corsCredentials = corsOrigin !== true;
  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: corsCredentials,
  });

  // Serve static files (web client) from /public directory
  app.useStaticAssets(join(__dirname, '..', 'public'), {
    index: false, // Don't serve index.html automatically
  });

  // Serve the SPA index.html for every URL prefix the TanStack Router
  // owns (/admin legacy, /endpoints, /logs, /settings). Express middleware
  // runs before NestJS routing, bypassing the global prefix, guards, and
  // filters - so a deep link or hard refresh on /endpoints/abc/users
  // returns the SPA shell instead of a NestJS 404. The list lives in
  // src/bootstrap/spa-fallback.ts and is locked in by
  // api/test/e2e/spa-fallback.e2e-spec.ts (Phase A5).
  applySpaFallback(app);

  const globalPrefix = process.env.API_PREFIX ?? 'scim'; // still mounting at /scim internally
  app.setGlobalPrefix(globalPrefix, {
    exclude: [
      { path: '/', method: RequestMethod.ALL },
      // RFC 8414 - authorization-server metadata is served at the deployment root.
      { path: OAUTH_METADATA_PATH, method: RequestMethod.GET },
    ]
  });

  app.useLogger(new Logger('SCIMEndpointServer'));
  // Accept both standard JSON and SCIM media type payloads
  app.use(
    json({
      limit: '5mb',
      type: (req) => {
        const ct = req.headers['content-type']?.toLowerCase() ?? '';
        return ct.includes('application/json') || ct.includes('application/scim+json');
      }
    })
  );
  // S-5: enableImplicitConversion is intentionally enabled.
  // Risk acknowledged and mitigated by mandatory class-validator decorators on
  // every DTO field, the parseSimpleFilter length cap (DTO-1), and a regression
  // guard in api/src/security/forbidden-source-patterns.spec.ts that locks in
  // this literal. Any change requires updating docs/adr/ADR-004-enable-implicit-conversion.md.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    })
  );

  const port = Number(process.env.PORT ?? 3000);
  const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 120_000;
  await app.listen(port);

  // Set HTTP server request timeout - prevents any single request from blocking
  // the event loop indefinitely (e.g., slow DB queries, N+1 bugs).
  // Default: 120 seconds (Node.js default). Override with REQUEST_TIMEOUT_MS env var.
  const httpServer = app.getHttpServer();
  httpServer.setTimeout(requestTimeoutMs);
  httpServer.keepAliveTimeout = requestTimeoutMs;

  Logger.log(`🚀 SCIM Endpoint Server API is running on http://localhost:${port}/${globalPrefix}`);
  Logger.log(`⏱️ Request timeout: ${requestTimeoutMs}ms (REQUEST_TIMEOUT_MS)`);
  Logger.log(`🔎 Log API quick access: http://localhost:${port}/scim/admin/log-config/recent?limit=25`);
  Logger.log(`🔎 Log stream (SSE): http://localhost:${port}/scim/admin/log-config/stream?level=INFO`);
  Logger.log(`🔎 Log download (JSON): http://localhost:${port}/scim/admin/log-config/download?format=json`);

  // Settings v8: StrictSchemaValidation now defaults to true (RFC 7643 compliance).
  // Log the new default so operators are aware.
  Logger.log(
    '✅ StrictSchemaValidation is ON by default for all endpoints. ' +
    'SCIM payloads are type-checked against schema definitions (RFC 7643 §2). ' +
    'Disable per-endpoint for Entra ID compatibility: { "StrictSchemaValidation": "False" }',
    'SchemaValidation',
  );
}

void bootstrap();
