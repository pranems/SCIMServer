import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import type { Response, Request } from 'express';

import { SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN } from '../common/scim-constants';
import { ScimLogger, getCorrelationContext } from '../../logging/scim-logger.service';
import { wireDescriptionFor } from '../../../oauth/auth-reason-catalog';
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

    // WI-D1: OAuth token endpoints (`*/oauth/token`) return the native,
    // RFC-6749-conformant error as `application/json` - NOT wrapped in a SCIM
    // envelope. The token endpoint is an OAuth surface, not a SCIM resource, so
    // flattening its `{ error, error_description }` into a SCIM `detail` both
    // mislabels the content-type and destroys the specific reason. We pass the
    // OAuth body through and enrich it with a `correlation_id` + `timestamp`
    // (RFC 6749 section 5.2 permits `error_description` / `error_uri`; Entra's
    // reference implementation adds correlation_id + timestamp the same way).
    if (this.isOAuthTokenEndpoint(url) && this.isOAuthErrorBody(exceptionResponse)) {
      const oauthBody = this.buildOAuthErrorBody(exceptionResponse as Record<string, unknown>, exception.message, response);
      // Keep the same auth-error logging as the SCIM path (WARN for 401/403).
      if (status === 401 || status === 403) {
        this.logger.warn(LogCategory.OAUTH, `OAuth token error ${status} on ${request?.method} ${request?.originalUrl}`, {
          status,
          error: oauthBody.error,
          reason_code: oauthBody.reason_code,
          correlation_id: oauthBody.correlation_id,
        });
      } else if (status >= 500) {
        this.logger.error(LogCategory.OAUTH, `OAuth token error ${status} on ${request?.method} ${request?.originalUrl}`, exception, { status });
      } else {
        this.logger.info(LogCategory.OAUTH, `OAuth token error ${status} on ${request?.method} ${request?.originalUrl}`, {
          status,
          error: oauthBody.error,
          reason_code: oauthBody.reason_code,
        });
      }
      response
        .status(status)
        .setHeader('Content-Type', 'application/json; charset=utf-8')
        .json(oauthBody);
      this.persistErrorLog(request, response, status, oauthBody, exception);
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

    // G.4: Auto-enrich the diagnostics extension. MERGE into any existing block
    // (e.g. the resource-plane guard sets `reason_code`) so requestId/endpointId/
    // logsUrl are added alongside it rather than being skipped.
    {
      const ctx = getCorrelationContext();
      const diag: Record<string, unknown> =
        (body[SCIM_DIAGNOSTICS_URN] as Record<string, unknown> | undefined) ?? {};
      if (ctx) {
        if (ctx.requestId && diag.requestId === undefined) diag.requestId = ctx.requestId;
        if (ctx.endpointId && diag.endpointId === undefined) diag.endpointId = ctx.endpointId;
        if (ctx.requestId && diag.logsUrl === undefined) {
          diag.logsUrl = ctx.endpointId
            ? `/scim/endpoints/${ctx.endpointId}/logs/recent?requestId=${ctx.requestId}`
            : `/scim/admin/log-config/recent?requestId=${ctx.requestId}`;
        }
      }
      if (Object.keys(diag).length > 0) {
        body[SCIM_DIAGNOSTICS_URN] = diag;
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
      requestId: meta?.requestId,
    });
  }

  /** WI-D1: is this an OAuth token endpoint (global or per-endpoint)? */
  private isOAuthTokenEndpoint(url: string): boolean {
    // Strip any query string, then match the two token-endpoint shapes:
    //   /scim/oauth/token                         (global)
    //   /scim/endpoints/{id}/oauth/token          (per-endpoint)
    const path = url.split('?')[0];
    return /\/oauth\/token\/?$/.test(path);
  }

  /** WI-D1: does the thrown body look like an RFC-6749 OAuth error (has `error`)? */
  private isOAuthErrorBody(exceptionResponse: unknown): boolean {
    return (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      typeof (exceptionResponse as Record<string, unknown>).error === 'string'
    );
  }

  /**
   * WI-D1: build the RFC-6749 token-error body, passing through the OAuth
   * fields the controller set and enriching with correlation_id + timestamp.
   * Only known OAuth keys are emitted (no SCIM envelope, no internal fields).
   */
  private buildOAuthErrorBody(raw: Record<string, unknown>, fallbackMessage: string, response?: Response): Record<string, unknown> {
    const body: Record<string, unknown> = {
      error: typeof raw.error === 'string' ? raw.error : 'invalid_request',
    };
    // When a curated reason_code is present (WI-D2/D3), the catalog is the
    // source of truth for the tier-safe actor description - fall back to it so
    // the wire text can never drift from the catalog.
    const reasonCode = typeof raw.reason_code === 'string' ? raw.reason_code : undefined;
    const catalogDescription = wireDescriptionFor(reasonCode);
    const description =
      typeof raw.error_description === 'string'
        ? raw.error_description
        : catalogDescription
          ? catalogDescription
          : typeof raw.message === 'string'
            ? raw.message
            : fallbackMessage;
    if (description) body.error_description = description;
    // Pass through the curated diagnostics fields when present (WI-D2/D3 set these).
    if (reasonCode) body.reason_code = reasonCode;
    if (typeof raw.error_uri === 'string') body.error_uri = raw.error_uri;

    // Enrich with the correlation id (== X-Request-Id) + a timestamp so the
    // caller can find the matching log entry, mirroring Entra's token errors.
    // Prefer the ALS correlation context; fall back to the X-Request-Id header
    // the RequestLoggingInterceptor already stamped on the response (the ALS
    // context is not always in scope when the filter runs).
    const ctx = getCorrelationContext();
    const headerReqId = response?.getHeader('X-Request-Id');
    const correlationId = ctx?.requestId ?? (typeof headerReqId === 'string' ? headerReqId : undefined);
    if (correlationId) body.correlation_id = correlationId;
    body.timestamp = new Date().toISOString();
    return body;
  }
}
