import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

/**
 * Interceptor to set SCIM-required HTTP headers for all successful responses.
 * 
 * Per RFC 7644 Section 3.1:
 * - Content-Type MUST be 'application/scim+json' for all SCIM responses.
 * - 201 Created responses SHALL include an HTTP Location header with the resource URI.
 * 
 * Non-SCIM routes (web UI, static assets) are skipped so they keep their
 * native Content-Type (text/html, text/css, etc.).
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.1
 */
@Injectable()
export class ScimContentTypeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const url = request.originalUrl ?? request.url ?? '';

    // Only apply SCIM content type to /scim/* routes
    const isScimRoute = url.startsWith('/scim');

    return next.handle().pipe(
      tap((data: any) => {
        if (!isScimRoute) return;

        const response = context.switchToHttp().getResponse<Response>();
        if (!response.headersSent) {
          response.setHeader('Content-Type', 'application/scim+json; charset=utf-8');

          // RFC 7644 §3.1: "the server SHALL set the Location header"
          // on 201 Created responses with the new resource's URI.
          if (response.statusCode === 201 && data?.meta?.location) {
            response.setHeader('Location', data.meta.location);
          }
        }
      })
    );
  }
}
