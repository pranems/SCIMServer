import { isUuid } from '../../shared/uuid';

/**
 * Coerce a correlation id into something the `RequestLog.requestId` column can
 * actually hold.
 *
 * `requestId` is `@db.Uuid`. The correlation middleware deliberately propagates
 * the client's `X-Request-Id` VERBATIM (that echo is a documented contract, and
 * tracing ids are not required to be UUIDs), and it runs BEFORE guards - so an
 * arbitrary, attacker-chosen string can reach this point.
 *
 * Writing that straight into the column is a log-INTEGRITY defect, not a
 * cosmetic one. Rows are flushed in batches of up to 50 via a single
 * `createMany`, and the batch is drained from the in-memory buffer BEFORE the
 * insert is attempted; if the insert throws, the catch block only logs, so the
 * whole batch is discarded. A single poisoned row therefore destroys up to 49
 * unrelated audit-log rows - and any caller could trigger that deliberately to
 * erase the record of their own requests.
 *
 * Storing `null` for a non-UUID id loses the correlation for that one row, which
 * is a far better outcome than losing the batch. It is also applied to BOTH
 * persistence backends so InMemory cannot find rows Prisma would miss - that
 * divergence is what let this go unnoticed.
 */
export function toStorableRequestId(requestId: string | undefined | null): string | null {
  return isUuid(requestId) ? (requestId as string) : null;
}
