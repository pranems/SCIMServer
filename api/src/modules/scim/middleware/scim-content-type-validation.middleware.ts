/**
 * SCIM Content-Type Validation Middleware
 *
 * RFC 7644 §3.1: Clients that include a request body MUST specify the
 * Content-Type as "application/scim+json" (or for backwards compatibility,
 * "application/json").
 *
 * Returns 415 Unsupported Media Type when a POST, PUT, or PATCH request
 * has a Content-Type that is NOT application/json or application/scim+json.
 *
 * Scope: Applied only to SCIM endpoint routes (endpoints/*), NOT to:
 * - OAuth token endpoint (/scim/oauth/token)  
 * - Admin endpoints (/scim/admin/*)
 * - GET, DELETE, HEAD, OPTIONS (no body)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.1
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { createScimError } from '../common/scim-errors';

/** HTTP methods that carry a request body and require Content-Type validation */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** Accepted SCIM Content-Types (checked via includes for charset tolerance) */
const ACCEPTED_TYPES = ['application/json', 'application/scim+json'];

@Injectable()
export class ScimContentTypeValidationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // Only validate body-carrying methods
    if (!BODY_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    const contentType = (req.headers['content-type'] ?? '').toLowerCase();

    // Allow if Content-Type includes an accepted type
    // This handles charset suffixes like "application/json; charset=utf-8"
    if (ACCEPTED_TYPES.some(t => contentType.includes(t))) {
      return next();
    }

    // If no Content-Type header at all and body is empty, allow through
    // (some clients omit Content-Type on truly empty bodies)
    if (!req.headers['content-type'] && (!req.body || Object.keys(req.body).length === 0)) {
      return next();
    }

    // Reject with 415 Unsupported Media Type (RFC 7644 §3.1)
    throw createScimError({
      status: 415,
      detail: `Unsupported Media Type: "${req.headers['content-type'] ?? '(none)'}"` +
              `. SCIM requests MUST use Content-Type "application/scim+json" or "application/json" (RFC 7644 \u00a73.1).`,
      scimType: 'invalidValue',
      diagnostics: { errorCode: 'CONTENT_TYPE_UNSUPPORTED' },
    });
  }
}
