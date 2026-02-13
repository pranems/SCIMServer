import type { Request } from 'express';

/**
 * Build the canonical SCIM base URL from the incoming request.
 *
 * NestJS's `setGlobalPrefix('scim')` does NOT populate `request.baseUrl` the
 * way a mounted Express sub-app would, so we reconstruct the prefix ourselves.
 * We advertise the RFC 7644 §3.13 versioned path (`/scim/v2`) even though the
 * internal global prefix is just `scim` (a rewrite middleware in main.ts maps
 * `/scim/v2/*` → `/scim/*`).
 */
export function buildBaseUrl(request: Request): string {
  const protocol = request.headers['x-forwarded-proto']?.toString() ?? request.protocol;
  const host = request.headers['x-forwarded-host']?.toString() ?? request.get('host');
  const prefix = process.env.API_PREFIX ?? 'scim';

  return `${protocol}://${host}/${prefix}/v2`;
}
