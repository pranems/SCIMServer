import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { ScimLogger } from '../modules/logging/scim-logger.service';
import { REQUEST_LOGGING_META_KEY, type RequestLoggingMeta } from '../modules/logging/request-logging.interceptor';

/**
 * Apply the early correlation middleware.
 *
 * Registered via `app.use()` so it runs BEFORE NestJS guards + interceptors +
 * body parsing. It is the single source of the request id:
 *   1. reads/generates the `X-Request-Id` and sets it on the response, so EVERY
 *      response (including 401/403/415 short-circuits thrown by guards) carries it;
 *   2. establishes the `AsyncLocalStorage` correlation context (requestId,
 *      method, path, endpointId, startTime) so services + exception filters can
 *      read it; and
 *   3. stashes a base `RequestLoggingMeta` on the request so a GUARD-rejected
 *      request - which throws before the `RequestLoggingInterceptor` runs -
 *      still persists a RequestLog row and a diagnostics block carrying the
 *      requestId. The interceptor (which runs after guards) only enriches this
 *      meta with the parsed request body.
 *
 * Shared by production bootstrap (main.ts) and the E2E harness (app.helper.ts)
 * so both behave identically.
 */
export function applyCorrelationMiddleware(app: NestExpressApplication): void {
  const scimLogger = app.get(ScimLogger);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const endpointId = req.originalUrl?.match(/\/endpoints\/([^/]+)/)?.[1];
    const startedAt = Date.now();
    // Base meta (no requestBody yet - body parsing runs later). Read by the
    // exception filters' diagnostics enrichment + persistErrorLog even when a
    // guard rejects early, outside the interceptor + ALS context.
    (req as unknown as Record<string, RequestLoggingMeta>)[REQUEST_LOGGING_META_KEY] = {
      startedAt,
      requestId,
      requestHeaders: { ...req.headers },
      endpointId,
    };
    scimLogger.runWithContext(
      { requestId, method: req.method, path: req.originalUrl ?? req.url, endpointId, startTime: startedAt },
      () => next(),
    );
  });
}
