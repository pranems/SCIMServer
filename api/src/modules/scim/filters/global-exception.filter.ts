import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import type { Response, Request } from 'express';

import { SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN } from '../common/scim-constants';
import { ScimLogger, getCorrelationContext } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { LoggingService } from '../../logging/logging.service';
import { REQUEST_LOGGING_META_KEY, RequestLoggingMeta } from '../../logging/request-logging.interceptor';

/**
 * Global catch-all exception filter for unhandled non-HttpException errors.
 *
 * NestJS's built-in exception handler and the existing ScimExceptionFilter only
 * catch HttpException subclasses. Raw errors from repositories (e.g., InMemory
 * `throw new Error(...)`), PatchEngine TypeErrors, and PrismaClientKnownRequestError
 * bypass both and produce a non-SCIM response:
 *
 *   { "statusCode": 500, "message": "Internal Server Error" }
 *
 * This filter catches EVERYTHING that ScimExceptionFilter does not, logs it at
 * ERROR level, and returns a proper SCIM-compliant 500 response.
 *
 * Registration: Must be registered BEFORE ScimExceptionFilter in the providers
 * array (NestJS applies filters in reverse registration order, so the last
 * registered filter runs first for matching exceptions).
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.12
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: ScimLogger,
    private readonly loggingService: LoggingService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // HttpException subclasses are handled by ScimExceptionFilter - re-throw
    // so NestJS routes them to the more specific filter.
    if (exception instanceof HttpException) {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const url = request?.originalUrl ?? request?.url ?? '';
    const method = request?.method ?? 'UNKNOWN';

    // Non-SCIM routes: use NestJS-style JSON error (not SCIM format)
    if (!url.startsWith('/scim')) {
      const message = exception instanceof Error ? exception.message : 'Internal Server Error';
      this.logger.error(LogCategory.HTTP, `Unhandled exception on ${method} ${url}`, exception, {
        status: 500,
      });
      response.status(500).json({ statusCode: 500, message });
      return;
    }

    // ── SCIM routes: log + return RFC 7644 §3.12 compliant error ────────

    const errorName = exception instanceof Error ? exception.constructor.name : typeof exception;
    const errorMessage = exception instanceof Error ? exception.message : String(exception);

    this.logger.error(
      LogCategory.HTTP,
      `Unhandled ${errorName} on ${method} ${url}`,
      exception instanceof Error ? exception : undefined,
      {
        status: 500,
        errorType: errorName,
        errorMessage,
      },
    );

    const body: Record<string, unknown> = {
      schemas: [SCIM_ERROR_SCHEMA],
      detail: 'Internal server error',
      status: '500',
    };

    // P2: Auto-enrich with diagnostics extension from correlation context
    const corrCtx = getCorrelationContext();
    if (corrCtx) {
      const diag: Record<string, unknown> = {};
      if (corrCtx.requestId) diag.requestId = corrCtx.requestId;
      if (corrCtx.endpointId) diag.endpointId = corrCtx.endpointId;
      if (corrCtx.requestId) {
        diag.logsUrl = corrCtx.endpointId
          ? `/scim/endpoints/${corrCtx.endpointId}/logs/recent?requestId=${corrCtx.requestId}`
          : `/scim/admin/log-config/recent?requestId=${corrCtx.requestId}`;
      }
      if (Object.keys(diag).length > 0) {
        body[SCIM_DIAGNOSTICS_URN] = diag;
      }
    }

    response
      .status(500)
      .setHeader('Content-Type', 'application/scim+json; charset=utf-8')
      .json(body);

    // Persist the error request log with the EXACT response body the client receives
    this.persistErrorLog(request, response, body, exception);
  }

  /**
   * Persist the error request to the request log database.
   * Reads timing metadata stashed by RequestLoggingInterceptor.
   */
  private persistErrorLog(
    request: Request,
    response: Response,
    responseBody: Record<string, unknown>,
    error: unknown,
  ): void {
    const meta: RequestLoggingMeta | undefined = (request as any)[REQUEST_LOGGING_META_KEY];
    const durationMs = meta ? Date.now() - meta.startedAt : undefined;

    void this.loggingService.recordRequest({
      method: request?.method ?? 'UNKNOWN',
      url: request?.originalUrl ?? request?.url ?? '',
      status: 500,
      durationMs,
      requestHeaders: meta?.requestHeaders ?? { ...(request?.headers ?? {}) },
      requestBody: meta?.requestBody ?? request?.body,
      responseHeaders: response.getHeaders() as Record<string, unknown>,
      responseBody,
      error,
      endpointId: meta?.endpointId,
    });
  }
}
