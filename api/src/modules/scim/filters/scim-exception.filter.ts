import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

import { SCIM_ERROR_SCHEMA } from '../common/scim-constants';

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
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

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

    response
      .status(status)
      .setHeader('Content-Type', 'application/scim+json; charset=utf-8')
      .json(body);
  }
}
