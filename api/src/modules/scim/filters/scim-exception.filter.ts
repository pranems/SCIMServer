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
 * Global exception filter for SCIM endpoints.
 *
 * Per RFC 7644 §3.12, SCIM error responses MUST:
 * - Use Content-Type: application/scim+json
 * - Include the "status" field as a **string** (the HTTP status code as text)
 * - Include the Error schema URN in "schemas"
 *
 * NestJS's built-in exception handler sends `application/json` by default.
 * This filter intercepts all HttpExceptions thrown by SCIM controllers and
 * ensures the response conforms to the SCIM error format.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.12
 */
@Catch(HttpException)
export class ScimExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: ScimLogger,
    private readonly loggingService: LoggingService,
  ) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const url = request?.originalUrl ?? request?.url ?? '';

    // Non-SCIM routes (web UI, static assets): let NestJS default error handling apply
    if (!url.startsWith('/scim')) {
      response.status(status).json(
        typeof exceptionResponse === 'object' ? exceptionResponse : { statusCode: status, message: exception.message }
      );
      return;
    }

    // Log the exception - level varies by status class:
    //   5xx → ERROR (server fault, operator should investigate)
    //   401/403 → WARN (potential security event)
    //   404 → DEBUG (routine probe, especially from Entra ID)
    //   other 4xx → INFO (client error, logged for traceability)
    if (status >= 500) {
      this.logger.error(LogCategory.HTTP, `Exception ${status} on ${request?.method} ${request?.originalUrl}`, exception, {
        status,
      });
    } else if (status === 401 || status === 403) {
      this.logger.warn(LogCategory.HTTP, `Auth error ${status} on ${request?.method} ${request?.originalUrl}`, {
        status,
        detail: typeof exceptionResponse === 'object' ? (exceptionResponse as Record<string, unknown>).detail : exceptionResponse,
      });
    } else if (status === 404) {
      this.logger.debug(LogCategory.HTTP, `Not found ${status} on ${request?.method} ${request?.originalUrl}`, {
        status,
        detail: typeof exceptionResponse === 'object' ? (exceptionResponse as Record<string, unknown>).detail : exceptionResponse,
      });
    } else if (status >= 400) {
      this.logger.info(LogCategory.HTTP, `Client error ${status} on ${request?.method} ${request?.originalUrl}`, {
        status,
        detail: typeof exceptionResponse === 'object' ? (exceptionResponse as Record<string, unknown>).detail : exceptionResponse,
      });
    }

    // Build SCIM-compliant error body
    let body: Record<string, unknown>;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const raw = exceptionResponse as Record<string, unknown>;

      // If the exception already carries a SCIM-formatted body (thrown via createScimError),
      // use it directly, otherwise wrap it in the standard SCIM error envelope.
      if (Array.isArray(raw.schemas) && (raw.schemas as string[]).includes(SCIM_ERROR_SCHEMA)) {
        body = raw;
      } else {
        body = {
          schemas: [SCIM_ERROR_SCHEMA],
          detail: raw.message ?? raw.error ?? exception.message,
          status: String(status),
        };
      }
    } else {
      body = {
        schemas: [SCIM_ERROR_SCHEMA],
        detail: typeof exceptionResponse === 'string' ? exceptionResponse : exception.message,
        status: String(status),
      };
    }

    // Ensure "status" is always a string per RFC 7644 §3.12
    if (body.status !== undefined && typeof body.status !== 'string') {
      body.status = String(body.status);
    }

    // G.4: Auto-enrich with diagnostics extension when not already present
    if (!body[SCIM_DIAGNOSTICS_URN]) {
      const ctx = getCorrelationContext();
      if (ctx) {
        const diag: Record<string, unknown> = {};
        if (ctx.requestId) diag.requestId = ctx.requestId;
        if (ctx.endpointId) diag.endpointId = ctx.endpointId;
        if (ctx.requestId) {
          diag.logsUrl = ctx.endpointId
            ? `/scim/endpoints/${ctx.endpointId}/logs/recent?requestId=${ctx.requestId}`
            : `/scim/admin/log-config/recent?requestId=${ctx.requestId}`;
        }
        if (Object.keys(diag).length > 0) {
          body[SCIM_DIAGNOSTICS_URN] = diag;
        }
      }
    }

    response
      .status(status)
      .setHeader('Content-Type', 'application/scim+json; charset=utf-8')
      .json(body);

    // Persist the error request log with the EXACT response body the client receives
    this.persistErrorLog(request, response, status, body, exception);
  }

  /**
   * Persist the error request to the request log database.
   * Reads timing metadata stashed by RequestLoggingInterceptor.
   */
  private persistErrorLog(
    request: Request,
    response: Response,
    status: number,
    responseBody: Record<string, unknown>,
    error: HttpException,
  ): void {
    const meta: RequestLoggingMeta | undefined = (request as any)[REQUEST_LOGGING_META_KEY];
    const durationMs = meta ? Date.now() - meta.startedAt : undefined;

    void this.loggingService.recordRequest({
      method: request?.method ?? 'UNKNOWN',
      url: request?.originalUrl ?? request?.url ?? '',
      status,
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
