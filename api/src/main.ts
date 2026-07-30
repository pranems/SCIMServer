import 'reflect-metadata';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import { join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './modules/app/app.module';
import { parseCorsOrigin } from './security/cors-origin';
import { buildHelmetMiddleware, PERMISSIONS_POLICY_HEADER_VALUE } from './security/helmet-config';
import { applySpaFallback } from './bootstrap/spa-fallback';
import { OAUTH_METADATA_PATH } from './oauth/oauth.constants';
import { applyCorrelationMiddleware } from './bootstrap/correlation-middleware';
import { applyBodyParsers } from './bootstrap/body-parsers';
import { resolveRuntimeConfig, formatRuntimeConfigLines } from './bootstrap/runtime-config';

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

  // Early correlation middleware - runs BEFORE guards + interceptors + body
  // parsing so that EVERY response (including 401/403/415 short-circuits thrown
  // by guards) carries the X-Request-Id header, runs inside a correlation
  // context, and stashes a base RequestLoggingMeta the exception filters read
  // (so a guard-rejected request is still fully traceable). Shared with the E2E
  // harness via applyCorrelationMiddleware.
  applyCorrelationMiddleware(app);

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
  // Accept both standard JSON and SCIM media type payloads. The shared parser
  // bootstrap also stashes the raw request buffer (req.rawBody) so a body that
  // fails to parse (malformed JSON -> 400) can still surface its bytes on the
  // RequestLog. Shared with the E2E harness via applyBodyParsers.
  applyBodyParsers(app);
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
  const runtimeConfig = resolveRuntimeConfig((k) => process.env[k]);
  const http = runtimeConfig.groups.http;
  await app.listen(port);

  // ── HTTP server timeouts (X15-F2) ──
  // Node's http.Server has FOUR distinct timeouts and we used to set one and a
  // half of them. `setTimeout()` is SOCKET INACTIVITY, not request duration - a
  // slow client that dribbles a byte every 60 s never trips it - so an operator
  // setting REQUEST_TIMEOUT_MS believed requests were bounded when they were
  // actually bounded by Node's implicit 300 s `requestTimeout`. All four are now
  // set explicitly; the Node docs call `headersTimeout`/`requestTimeout` a
  // denial-of-service protection when there is no reverse proxy in front.
  //
  // keepAliveTimeout is deliberately DECOUPLED from the request timeout: its
  // correct value is a function of the UPSTREAM ingress idle timeout, not of how
  // long a request may take. If it is shorter than the proxy's idle timeout the
  // proxy reuses a socket the server is closing and the client sees a 502 /
  // ECONNRESET. REQUEST_TIMEOUT_MS still drives it as a legacy alias so existing
  // deployments keep exactly today's behaviour.
  const httpServer = app.getHttpServer();
  const requestTimeoutMs = http.requestTimeoutMs.effective as number;
  httpServer.setTimeout(requestTimeoutMs);
  httpServer.requestTimeout = requestTimeoutMs;
  httpServer.headersTimeout = http.headersTimeoutMs.effective as number;
  httpServer.keepAliveTimeout = http.keepAliveTimeoutMs.effective as number;
  // Added in recent Node; closes the socket slightly before the advertised
  // keep-alive to shave the ECONNRESET race window. Guarded because older
  // runtimes do not have it.
  if ('keepAliveTimeoutBuffer' in httpServer) {
    (httpServer as { keepAliveTimeoutBuffer: number }).keepAliveTimeoutBuffer =
      http.keepAliveTimeoutBufferMs.effective as number;
  }

  Logger.log(`🚀 SCIM Endpoint Server API is running on http://localhost:${port}/${globalPrefix}`);
  // Emit what ACTUALLY took effect, with provenance. A configurable system
  // without this is strictly harder to operate than a hardcoded one.
  for (const line of formatRuntimeConfigLines(runtimeConfig)) Logger.log(line);
  for (const warning of runtimeConfig.warnings) Logger.warn(`[Config] ${warning}`);
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
