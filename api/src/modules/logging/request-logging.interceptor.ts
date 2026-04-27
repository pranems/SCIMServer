import {
  CallHandler,
  ExecutionContext,
  HttpException,
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
import { SCIM_ERROR_SCHEMA } from '../scim/common/scim-constants';

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
    const startedAt = Date.now();

    // Generate or propagate correlation request ID
    const requestId = (request.headers['x-request-id'] as string) || randomUUID();
    response.setHeader('X-Request-Id', requestId);

    // Extract endpoint ID from URL if present
    const endpointIdMatch = request.originalUrl?.match(/\/endpoints\/([^/]+)/);
    const endpointId = endpointIdMatch?.[1];

    // Run the entire request pipeline within a correlation context
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

          next.handle().pipe(
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
              });
            }),
            catchError((error: unknown) => {
              const durationMs = Date.now() - startedAt;
              const status = this.extractStatusCode(error, response);
              const msg = `← ${status} ${request.method} ${request.originalUrl ?? request.url}`;
              const data = { status, durationMs };

              // Tiered log level matching ScimExceptionFilter (P9):
              //   5xx → ERROR, 401/403 → WARN, 404 → DEBUG, other 4xx → INFO, unknown → ERROR
              if (status && status >= 500) {
                this.scimLogger.error(LogCategory.HTTP, msg, error, data);
              } else if (status === 401 || status === 403) {
                this.scimLogger.warn(LogCategory.HTTP, msg, data);
              } else if (status === 404) {
                this.scimLogger.debug(LogCategory.HTTP, msg, data);
              } else if (status && status >= 400) {
                this.scimLogger.info(LogCategory.HTTP, msg, data);
              } else {
                this.scimLogger.error(LogCategory.HTTP, msg, error, data);
              }

              // Derive the response body that the exception filter will send
              const errorResponseBody = this.buildErrorResponseBody(error);

              // Persist to database
              void this.loggingService.recordRequest({
                method: request.method,
                url: request.originalUrl ?? request.url,
                status,
                durationMs,
                requestHeaders: { ...request.headers },
                requestBody: request.body,
                responseHeaders: response.getHeaders() as Record<string, unknown>,
                responseBody: errorResponseBody,
                error,
                endpointId,
              });
              throw error;
            })
          ).subscribe(subscriber);
        }
      );
    });
  }

  private extractStatusCode(error: unknown, response: Response): number | undefined {
    if (typeof (error as { status?: number })?.status === 'number') {
      return (error as { status?: number }).status;
    }

    return response.statusCode;
  }

  /**
   * Reconstruct the SCIM error response body that the exception filter will
   * send. This mirrors the logic in ScimExceptionFilter so that the log entry
   * contains the actual response payload the client receives.
   */
  private buildErrorResponseBody(error: unknown): Record<string, unknown> | undefined {
    if (!(error instanceof HttpException)) {
      // Non-HttpException errors - the GlobalExceptionFilter produces a generic body
      const msg = error instanceof Error ? error.message : String(error);
      return {
        schemas: [SCIM_ERROR_SCHEMA],
        detail: msg || 'Internal server error',
        status: '500',
      };
    }

    const status = error.getStatus();
    const exceptionResponse = error.getResponse();

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const raw = exceptionResponse as Record<string, unknown>;
      // If already a SCIM-formatted body, return as-is
      if (Array.isArray(raw.schemas) && (raw.schemas as string[]).includes(SCIM_ERROR_SCHEMA)) {
        return { ...raw, status: String(raw.status ?? status) };
      }
      return {
        schemas: [SCIM_ERROR_SCHEMA],
        detail: (raw.message ?? raw.error ?? error.message) as string,
        status: String(status),
      };
    }

    return {
      schemas: [SCIM_ERROR_SCHEMA],
      detail: typeof exceptionResponse === 'string' ? exceptionResponse : error.message,
      status: String(status),
    };
  }
}
