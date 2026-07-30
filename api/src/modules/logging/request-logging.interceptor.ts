import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { randomUUID } from 'node:crypto';

import { LoggingService } from './logging.service';
import { ScimLogger } from './scim-logger.service';
import { LogCategory } from './log-levels';

/**
 * Metadata stashed on the request object by the interceptor so that
 * exception filters can call `recordRequest()` with full timing data
 * and the **actual** response body they build.
 */
export interface RequestLoggingMeta {
  startedAt: number;
  requestHeaders: Record<string, unknown>;
  /** The parsed request body. Set by the interceptor (after body parsing); the
   *  early correlation middleware stashes the base meta without it. */
  requestBody?: unknown;
  endpointId?: string;
  /** P3 - the X-Request-Id correlation id, for the auth-decision bridge. */
  requestId?: string;
}

/** Key used to stash RequestLoggingMeta on the Express request object. */
export const REQUEST_LOGGING_META_KEY = '__scim_logging_meta';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly scimLogger: ScimLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    const meta = (request as unknown as Record<string, RequestLoggingMeta | undefined>)[REQUEST_LOGGING_META_KEY];

    if (meta?.requestId) {
      // The early correlation middleware (main.ts) already established the
      // requestId + the AsyncLocalStorage context and set the X-Request-Id
      // header (this also covers guard rejections). Enrich the meta with the
      // now-parsed request body and log within the SAME context - do NOT
      // re-establish the context or re-generate the id.
      meta.requestBody = request.body;
      return this.attachLogging(request, response, meta.startedAt, meta.requestId, meta.endpointId, next);
    }

    // Fallback (unit tests, or any path the middleware did not cover):
    // establish the context + header + meta ourselves, exactly as before.
    const startedAt = Date.now();
    const requestId = (request.headers['x-request-id'] as string) || randomUUID();
    response.setHeader('X-Request-Id', requestId);
    const endpointId = request.originalUrl?.match(/\/endpoints\/([^/]+)/)?.[1];

    return new Observable(subscriber => {
      this.scimLogger.runWithContext(
        {
          requestId,
          method: request.method,
          path: request.originalUrl ?? request.url,
          endpointId,
          startTime: startedAt,
        },
        () => {
          (request as unknown as Record<string, RequestLoggingMeta>)[REQUEST_LOGGING_META_KEY] = {
            startedAt,
            requestHeaders: { ...request.headers },
            requestBody: request.body,
            endpointId,
            requestId,
          };
          this.attachLogging(request, response, startedAt, requestId, endpointId, next).subscribe(subscriber);
        }
      );
    });
  }

  /**
   * The shared request/response logging + persistence pipeline. Assumes the
   * correlation context is already active (established either by the early
   * middleware or by the fallback wrapper above).
   */
  private attachLogging(
    request: Request,
    response: Response,
    startedAt: number,
    requestId: string,
    endpointId: string | undefined,
    next: CallHandler,
  ): Observable<unknown> {
    // Log incoming request (DEBUG - operational detail, not business event)
    this.scimLogger.debug(LogCategory.HTTP, `→ ${request.method} ${request.originalUrl ?? request.url}`, {
      userAgent: request.headers['user-agent'] as string,
      contentType: request.headers['content-type'] as string,
      ip: request.ip || request.socket?.remoteAddress,
    });

    // Log request body at TRACE level (respects payload config)
    if (request.body && Object.keys(request.body).length > 0) {
      this.scimLogger.trace(LogCategory.HTTP, 'Request body', {
        body: request.body,
      });
    }

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        const durationMs = Date.now() - startedAt;

        // Structured response log (DEBUG - operational detail)
        this.scimLogger.debug(LogCategory.HTTP, `← ${response.statusCode} ${request.method} ${request.originalUrl ?? request.url}`, {
          status: response.statusCode,
          durationMs,
        });

        // Log response body at TRACE level
        if (responseBody) {
          this.scimLogger.trace(LogCategory.HTTP, 'Response body', {
            body: responseBody as Record<string, unknown>,
          });
        }

        // Log slow requests as warnings
        if (durationMs > this.scimLogger.getConfig().slowRequestThresholdMs) {
          this.scimLogger.warn(LogCategory.HTTP, `Slow request: ${durationMs}ms`, {
            status: response.statusCode,
            durationMs,
          });
        }

        // Persist to database (existing behavior)
        void this.loggingService.recordRequest({
          method: request.method,
          url: request.originalUrl ?? request.url,
          status: response.statusCode,
          durationMs,
          requestHeaders: { ...request.headers },
          requestBody: request.body,
          responseHeaders: response.getHeaders() as Record<string, unknown>,
          responseBody,
          endpointId,
          requestId,
        });
      }),
      catchError((error: unknown) => {
        // Error DB persistence + logging is handled by the exception filters
        // (ScimExceptionFilter / GlobalExceptionFilter) which have access to
        // the ACTUAL response body they build. The filters read timing metadata
        // from REQUEST_LOGGING_META_KEY.
        throw error;
      })
    );
  }

}
