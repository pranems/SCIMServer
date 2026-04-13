/**
 * SCIM ETag Interceptor — RFC 7644 §3.14
 *
 * Sets the ETag response header from `meta.version` and handles
 * conditional GET via If-None-Match → 304 Not Modified.
 *
 * Phase 7: If-Match enforcement for PUT/PATCH/DELETE has been moved to the
 * service layer (pre-write check via `assertIfMatch()`). This interceptor
 * only handles read-side caching.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.14
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { Request, Response } from 'express';
import { createScimError } from '../common/scim-errors';

@Injectable()
export class ScimEtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        if (!data || typeof data !== 'object') return data;

        const body = data as Record<string, unknown>;
        const meta = body.meta as Record<string, unknown> | undefined;
        const etag = meta?.version as string | undefined;

        // ─── Set ETag header on single-resource responses ───
        if (etag) {
          res.setHeader('ETag', etag);
        }

        // ─── If-None-Match for GET (conditional retrieval → 304) ───
        if (req.method === 'GET' && etag) {
          const ifNoneMatch = req.headers['if-none-match'];
          if (ifNoneMatch && ifNoneMatch === etag) {
            res.status(304);
            return undefined;
          }
        }

        return data;
      }),
    );
  }
}

/**
 * Validate If-Match header against a resource's current version BEFORE
 * applying a mutation. Call this from services before PUT/PATCH/DELETE.
 *
 * @param currentVersion  The resource's current `meta.version` (weak ETag)
 * @param ifMatchHeader   The value of the If-Match header from the request
 * @throws 412 Precondition Failed if the ETag doesn't match
 */
export function assertIfMatch(
  currentVersion: string | undefined,
  ifMatchHeader: string | undefined,
): void {
  if (!ifMatchHeader) return; // no If-Match header → allow the operation
  if (!currentVersion) return; // resource has no version → allow (lenient)

  // Weak ETags: W/"..." — compare the full string including W/ prefix
  if (ifMatchHeader !== currentVersion && ifMatchHeader !== '*') {
    throw createScimError({
      status: 412,
      scimType: 'versionMismatch',
      detail: `ETag mismatch. Expected: ${ifMatchHeader}, current: ${currentVersion}. The resource has been modified.`,
      diagnostics: { errorCode: 'PRECONDITION_VERSION_MISMATCH' },
    });
  }
}
