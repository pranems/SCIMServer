import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
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

  // TEMP/Compatibility: Support both /scim/* (legacy) and /scim/v2/* (spec-aligned) paths.
  // Current controllers are mounted under the global prefix (default 'scim').
  // We rewrite any incoming /scim/v2/* request to /scim/* so that the setup script's
  // printed SCIM Endpoint (which uses /scim/v2) works without changing all controllers yet.
  // Later we can flip the global prefix to 'scim/v2' and optionally redirect the old path.
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

  const globalPrefix = process.env.API_PREFIX ?? 'scim'; // still mounting at /scim internally
  app.setGlobalPrefix(globalPrefix, {
    exclude: ['/'] // Exclude root path from API prefix to serve web app
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
}

void bootstrap();
