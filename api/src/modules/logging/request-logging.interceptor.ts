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
import { LogLevel, LogCategory } from './log-levels';

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
          // Log incoming request
          this.scimLogger.info(LogCategory.HTTP, `→ ${request.method} ${request.originalUrl ?? request.url}`, {
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

              // Structured response log
              this.scimLogger.info(LogCategory.HTTP, `← ${response.statusCode} ${request.method} ${request.originalUrl ?? request.url}`, {
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
              if (durationMs > 2000) {
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
                responseBody
              });
            }),
            catchError((error: unknown) => {
              const durationMs = Date.now() - startedAt;
              const status = this.extractStatusCode(error, response);

              // Structured error log
              this.scimLogger.error(
                LogCategory.HTTP,
                `← ${status} ${request.method} ${request.originalUrl ?? request.url}`,
                error,
                { status, durationMs },
              );

              // Persist to database
              void this.loggingService.recordRequest({
                method: request.method,
                url: request.originalUrl ?? request.url,
                status,
                durationMs,
                requestHeaders: { ...request.headers },
                requestBody: request.body,
                responseHeaders: response.getHeaders() as Record<string, unknown>,
                error
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
}
