import { createHash } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { EndpointResponse } from '../services/endpoint.service';

/**
 * A9 - optimistic concurrency for endpoint profile writes.
 *
 * Two operators editing one endpoint could silently clobber each other: the
 * write path is last-write-wins and the loser got a `200` with no indication
 * their change had been overwritten.
 *
 * The token is a **content hash**, not a row version or a timestamp:
 *
 * - No migration is required, so this works identically on both backends.
 * - A timestamp at millisecond resolution can collide under rapid writes; a
 *   content hash cannot.
 * - Re-submitting **identical** content is not a lost update, and a content
 *   hash correctly treats it as a match rather than a conflict.
 */

/** Fields a caller can actually change - the only ones a lost update can affect. */
function concurrencyRelevantState(endpoint: EndpointResponse): string {
  const e = endpoint as unknown as Record<string, unknown>;
  return JSON.stringify({
    displayName: e.displayName ?? null,
    description: e.description ?? null,
    active: e.active ?? null,
    profile: e.profile ?? null,
  });
}

/**
 * The weak ETag for an endpoint's editable state. `id` and `name` are excluded
 * deliberately: `name` is immutable after create and `id` identifies the row,
 * so neither can participate in a lost update, and including them would only
 * manufacture spurious conflicts.
 */
export function endpointETag(endpoint: EndpointResponse): string {
  const digest = createHash('sha256').update(concurrencyRelevantState(endpoint)).digest('hex').slice(0, 32);
  return `W/"${digest}"`;
}

/**
 * Throws `412 Precondition Failed` when the caller's `If-Match` no longer
 * matches the endpoint's current state.
 *
 * Absent `If-Match` is allowed: this is opt-in, so existing callers keep
 * working unchanged and a client only gets concurrency protection when it asks
 * for it. `*` matches anything, per RFC 7232 section 3.1.
 */
export function assertEndpointIfMatch(endpoint: EndpointResponse, ifMatch?: string): void {
  if (!ifMatch) return;
  const current = endpointETag(endpoint);
  if (ifMatch === '*' || ifMatch === current) return;

  // Both sides are named so the caller can diff its stale copy against the
  // current one rather than blind-retrying and clobbering anyway.
  throw new HttpException(
    {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '412',
      scimType: 'versionMismatch',
      detail:
        `The endpoint has been modified by someone else. ` +
        `If-Match: ${ifMatch}, current: ${current}. ` +
        `Re-read the endpoint, re-apply your change, and retry.`,
      currentETag: current,
    },
    HttpStatus.PRECONDITION_FAILED,
  );
}
