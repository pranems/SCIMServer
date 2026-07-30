import { isUuid } from '../../shared/uuid';

/**
 * Coerce a caller-influenced value into something a `@db.Uuid` column on
 * `RequestLog` can actually hold.
 *
 * Two columns need this, for the same reason and with the same consequence:
 *
 * | Column       | Where the value comes from                                    |
 * |--------------|---------------------------------------------------------------|
 * | `requestId`  | the client's `X-Request-Id` header, propagated VERBATIM by the correlation middleware, which runs BEFORE guards |
 * | `endpointId` | `originalUrl.match(/\/endpoints\/([^/]+)/)` in the request-logging interceptor - a raw path segment, no validation |
 *
 * Writing either straight into the column is a log-INTEGRITY defect, not a
 * cosmetic one. Rows are flushed in batches of up to 50 via a single
 * `createMany`, and the batch is drained from the in-memory buffer BEFORE the
 * insert is attempted; if the insert throws, the catch block only logs, so the
 * whole batch is discarded. A single poisoned row therefore destroys up to 49
 * unrelated audit-log rows - and any caller could trigger that deliberately to
 * erase the record of their own requests. The interceptor also wraps
 * unauthenticated traffic (401s are logged), so this needs no credentials.
 *
 * Storing `null` for a non-UUID value loses the correlation for that one row,
 * which is a far better outcome than losing the batch. It is applied to BOTH
 * persistence backends so InMemory cannot find rows Prisma would miss - that
 * divergence is what let the requestId case go unnoticed for so long.
 */
function toStorableUuid(value: string | undefined | null): string | null {
  return isUuid(value) ? (value as string) : null;
}

/** Guard for `RequestLog.requestId` (client-supplied `X-Request-Id`). */
export function toStorableRequestId(requestId: string | undefined | null): string | null {
  return toStorableUuid(requestId);
}

/**
 * Guard for `RequestLog.endpointId` (a raw URL path segment).
 *
 * Live-observed poisoning values, neither of them exotic:
 * `by-name` (from `/scim/admin/endpoints/by-name/<name>`) and
 * `<uuid>?view=summary` (from a query string surviving the path match).
 */
export function toStorableEndpointId(endpointId: string | undefined | null): string | null {
  return toStorableUuid(endpointId);
}
