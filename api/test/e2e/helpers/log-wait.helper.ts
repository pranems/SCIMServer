import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Wait for a RequestLog row to become QUERYABLE.
 *
 * WHY THIS EXISTS
 * ---------------
 * `LoggingService` buffers RequestLog rows and flushes them on a timer (default
 * 3 s) or when the buffer fills (default 50 entries). Against the InMemory
 * backend the write is effectively synchronous, so tests that read a log row
 * straight after the request pass. Against **Prisma** they race, and two specs
 * had encoded that race in two different ways:
 *
 *   - `request-body-capture.e2e-spec.ts` slept a fixed 300 ms and then queried
 *     once. 300 ms is far below the 3 s flush interval, so the row was usually
 *     absent and the test failed deterministically.
 *   - `log-config.e2e-spec.ts` called the force-flush endpoint and then queried
 *     once. That looks safe but is not: a request's log row is enqueued
 *     ASYNCHRONOUSLY after its response has been sent, so the flush can run
 *     BEFORE the row it is meant to flush was ever buffered.
 *
 * Both are the same mistake - treating an eventually-durable write as an
 * immediately-durable one. A fixed sleep can only ever be "long enough for
 * today's machine"; the correct shape is to POLL until the row appears or a
 * deadline passes, forcing a flush on each attempt so we never simply wait out
 * the timer.
 *
 * This helper is the single place that pattern lives, so a future log-reading
 * spec cannot reinvent either bug.
 */
export interface WaitForLogRowOptions {
  /** Give up after this long. Generous by default - it exits as soon as it finds the row. */
  timeoutMs?: number;
  /** Delay between attempts. */
  intervalMs?: number;
}

/**
 * Poll `/scim/admin/logs?<query>` until `predicate` matches a row, forcing a
 * buffer flush before each attempt.
 *
 * @returns the matching row, or `undefined` if the deadline passed.
 */
export async function waitForLogRow(
  app: INestApplication,
  token: string,
  query: string,
  predicate: (row: Record<string, unknown>) => boolean,
  options: WaitForLogRowOptions = {},
): Promise<Record<string, unknown> | undefined> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const intervalMs = options.intervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;

  do {
    // Force whatever is buffered to become durable. Ignore failures - the
    // endpoint is admin-only and always available, but a transient error here
    // must not mask the real assertion in the caller.
    await request(app.getHttpServer())
      .post('/scim/admin/logs/flush')
      .set('Authorization', `Bearer ${token}`)
      .catch(() => undefined);

    const list = await request(app.getHttpServer())
      .get(`/scim/admin/logs?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .catch(() => undefined);

    const items = (list?.body?.items ?? list?.body?.data ?? []) as Array<Record<string, unknown>>;
    const found = items.find(predicate);
    if (found) return found;

    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);

  return undefined;
}

/** Convenience wrapper: wait for the row carrying a given `requestId`. */
export async function waitForLogRowByRequestId(
  app: INestApplication,
  token: string,
  requestId: string,
  options: WaitForLogRowOptions = {},
): Promise<Record<string, unknown> | undefined> {
  // Use the DEDICATED `requestId` filter, not the free-text `search` filter.
  // `search` matches on the URL/body text, so a correlation id that appears only
  // in a header is invisible to it - which is exactly why the first cut of this
  // helper still could not find the log-config flush row.
  return waitForLogRow(
    app,
    token,
    `requestId=${encodeURIComponent(requestId)}&includeAdmin=true&pageSize=25`,
    (row) => row.requestId === requestId,
    options,
  );
}
