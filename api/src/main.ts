import 'reflect-metadata';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './modules/app/app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true
  });

  // Trust reverse proxy (Azure Container Apps, NGINX, etc.) so that
  // req.protocol, req.hostname and req.ip reflect the original client request
  // rather than the internal HTTP connection between the proxy and the container.
  app.set('trust proxy', true);

  // Enable NestJS lifecycle hooks so OnModuleDestroy (e.g. Prisma $disconnect) fires on SIGTERM/SIGINT
  app.enableShutdownHooks();

  // RFC 7644 §1.3 URL rewrite: SCIM endpoints are published at /scim/v2/* (spec-aligned)
  // but controllers are mounted at the /scim global prefix. This middleware rewrites
  // incoming /scim/v2/* → /scim/* so that both URL forms work. This is intentional
  // permanent behavior — Entra ID, setup scripts, and live tests all use /scim/v2 URLs.
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

  // Enable CORS for web client access
  app.enableCors({
    origin: true,  // Allow all origins for now - web client is served from same container
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false  // Set to false since we're allowing all origins
  });

  // Serve static files (web client) from /public directory
  app.useStaticAssets(join(__dirname, '..', 'public'), {
    index: false, // Don't serve index.html automatically
  });

  // Serve the SPA index.html for all /admin* routes (client-side routing).
  // Express middleware runs before NestJS routing, bypassing global prefix, guards, and filters.
  const indexHtmlPath = join(__dirname, '..', 'public', 'index.html');
  app.use('/admin', (_req: Request, res: Response) => {
    res.sendFile(indexHtmlPath);
  });

  const globalPrefix = process.env.API_PREFIX ?? 'scim'; // still mounting at /scim internally
  app.setGlobalPrefix(globalPrefix, {
    exclude: [
      { path: '/', method: RequestMethod.ALL },
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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    })
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`🚀 SCIM Endpoint Server API is running on http://localhost:${port}/${globalPrefix}`);
  Logger.log(`🔎 Log API quick access: http://localhost:${port}/scim/admin/log-config/recent?limit=25`);
  Logger.log(`🔎 Log stream (SSE): http://localhost:${port}/scim/admin/log-config/stream?level=INFO`);
  Logger.log(`🔎 Log download (JSON): http://localhost:${port}/scim/admin/log-config/download?format=json`);

  // V1 awareness: Log a warning when schema validation is disabled (the default).
  // StrictSchemaValidation defaults to false for Entra compatibility, but this means
  // no attribute-level type/required/mutability checking runs on POST/PUT/PATCH.
  Logger.warn(
    '⚠️  StrictSchemaValidation is OFF by default for all endpoints. ' +
    'SCIM payloads will NOT be type-checked against schema definitions. ' +
    'Enable per-endpoint via config: { "StrictSchemaValidation": "True" }',
    'SchemaValidation',
  );
}

void bootstrap();
