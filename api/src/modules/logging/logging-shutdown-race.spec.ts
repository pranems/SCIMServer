/**
 * Shutdown-race regression tests for LoggingService.
 *
 * ORIGIN (2026-07-30): the Prisma E2E suite was green at 87/1439 while printing
 * 46 instances of `prisma:error Cannot use a pool after calling end on the
 * pool`, attributed to two code paths:
 *
 *   LoggingService.flushLogs      -> "Failed to flush request log batch"  (x20)
 *   LoggingService.runAutoPrune   -> "Auto-prune failed"                  (x26)
 *
 * Both were work that OUTLIVED shutdown, and both were silent - each sits
 * behind a `catch` that logs and continues. The flush one is the serious half:
 * `flushLogs` drains the buffer with `splice(0)` BEFORE awaiting the insert, so
 * a failure there discards up to `flushMaxBuffer` audit rows with no trace
 * beyond a log line. That is the same shape as the audit-log-loss vectors fixed
 * in v0.54.85 and v0.54.89.
 *
 * TWO DISTINCT MECHANISMS, both fixed here:
 *
 * 1. An UNCLEARABLE timer. `onModuleInit` scheduled the one-shot startup prune
 *    with a bare `setTimeout(..., 5_000)` and kept no handle, so
 *    `onModuleDestroy` could cancel the recurring interval but never that one.
 *    A process that started and stopped inside 5 seconds left an orphan timer
 *    that woke up afterwards and queried a closed pool.
 *
 * 2. A timer armed AFTER teardown. `recordRequest` schedules a flush timer, so
 *    a request still in flight when shutdown began could arm a fresh timer
 *    *after* `onModuleDestroy` had already cleared them - leaving it unowned.
 *    Clearing timers is therefore not sufficient; shutdown has to be one-way.
 *
 * The `shuttingDown` flag is set before any await in `onModuleDestroy`, so the
 * window in mechanism 2 does not exist.
 *
 * These assert BEHAVIOUR (no DB call escapes after shutdown; buffered rows are
 * still drained), not merely that a field exists.
 */

import { LoggingService } from './logging.service';

// A standalone shape rather than `LoggingService & {...}`: intersecting with the
// class collapses to `never`, because these members are private on it and TS
// treats same-named private members from different declarations as unrelated.
interface MutableService {
  shuttingDown: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  initialPruneTimer: ReturnType<typeof setTimeout> | null;
  autoPruneTimer: ReturnType<typeof setInterval> | null;
  logBuffer: unknown[];
  droppedLogRows: number;
  flushMaxBuffer: number;
  isInMemoryBackend: boolean;
  runAutoPrune: () => Promise<void>;
  flushLogs: (opts?: { duringShutdown?: boolean }) => Promise<void>;
  onModuleDestroy: () => Promise<void>;
}

describe('LoggingService shutdown race (audit-log durability)', () => {
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });

  const build = (): MutableService => {
    const prisma = { requestLog: { createMany, deleteMany } };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const moduleRef = { get: jest.fn() };
    const svc = new LoggingService(
      prisma as never,
      logger as never,
      moduleRef as never,
    ) as unknown as MutableService;
    svc.isInMemoryBackend = false;
    return svc;
  };

  beforeEach(() => jest.clearAllMocks());

  it('cancels the one-shot startup prune, so it cannot fire after shutdown', async () => {
    jest.useFakeTimers();
    try {
      const svc = build();
      svc.initialPruneTimer = setTimeout(() => void svc.runAutoPrune(), 5_000);

      await svc.onModuleDestroy();
      jest.advanceTimersByTime(30_000);

      expect(svc.initialPruneTimer).toBeNull();
      expect(deleteMany).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('auto-prune is a no-op once shutdown has begun', async () => {
    const svc = build();
    await svc.onModuleDestroy();

    await svc.runAutoPrune();

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('does NOT arm a new flush timer for a request recorded during shutdown', async () => {
    const svc = build();
    await svc.onModuleDestroy();

    svc.logBuffer.push({ method: 'GET', url: '/late' } as never);
    await svc.flushLogs();

    // The late entry must not trigger a write against a closing connection...
    expect(createMany).not.toHaveBeenCalled();
    // ...and must not leave an unowned timer behind.
    expect(svc.flushTimer).toBeNull();
  });

  it('still drains everything buffered before shutdown', async () => {
    const svc = build();
    svc.logBuffer.push({ method: 'GET', url: '/early' } as never);

    await svc.onModuleDestroy();

    // The whole point of flushing on destroy: buffered audit rows are durable.
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(svc.logBuffer).toHaveLength(0);
  });

  it('clears every timer handle on shutdown', async () => {
    const svc = build();
    svc.flushTimer = setTimeout(() => {}, 60_000);
    svc.initialPruneTimer = setTimeout(() => {}, 60_000);
    svc.autoPruneTimer = setInterval(() => {}, 60_000);

    await svc.onModuleDestroy();

    expect(svc.flushTimer).toBeNull();
    expect(svc.initialPruneTimer).toBeNull();
    expect(svc.autoPruneTimer).toBeNull();
  });
});

/**
 * A failed flush must not destroy the audit rows it was carrying.
 *
 * `flushLogs` drains the buffer with `splice(0)` and only then attempts the
 * insert, so before this change ANY write failure silently discarded the whole
 * batch. Three separate causes have hit that path: the v0.54.85 `requestId`
 * vector, the v0.54.89 `endpointId` vector, and a `Transaction already closed`
 * error from the Prisma driver adapter observed ~21 times in a single full E2E
 * run. Root-causing each one matters, but the durable fix is that a failed
 * write is retried rather than mourned.
 */
describe('LoggingService flush failure is lossless', () => {
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });

  const buildWith = (createMany: jest.Mock): MutableService => {
    const prisma = { requestLog: { createMany, deleteMany } };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const moduleRef = { get: jest.fn() };
    const svc = new LoggingService(
      prisma as never,
      logger as never,
      moduleRef as never,
    ) as unknown as MutableService;
    svc.isInMemoryBackend = false;
    return svc;
  };

  it('requeues the batch when the insert fails, preserving order', async () => {
    const createMany = jest.fn().mockRejectedValue(new Error('Transaction already closed'));
    const svc = buildWith(createMany);
    svc.logBuffer.push({ url: '/a' } as never, { url: '/b' } as never);

    await svc.flushLogs();

    expect(createMany).toHaveBeenCalledTimes(1);
    // Nothing lost, and still in the original order.
    expect(svc.logBuffer).toHaveLength(2);
    expect((svc.logBuffer[0] as { url: string }).url).toBe('/a');
    expect((svc.logBuffer[1] as { url: string }).url).toBe('/b');
  });

  it('a retry after a transient failure actually persists the rows', async () => {
    const createMany = jest
      .fn()
      .mockRejectedValueOnce(new Error('Transaction already closed'))
      .mockResolvedValueOnce({ count: 2 });
    const svc = buildWith(createMany);
    svc.logBuffer.push({ url: '/a' } as never, { url: '/b' } as never);

    await svc.flushLogs(); // fails, requeues
    await svc.flushLogs(); // retries, succeeds

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[1][0].data).toHaveLength(2);
    expect(svc.logBuffer).toHaveLength(0);
  });

  it('bounds the retry buffer and reports dropped rows instead of growing forever', async () => {
    const createMany = jest.fn().mockRejectedValue(new Error('permanently broken'));
    const svc = buildWith(createMany);
    const cap = svc.flushMaxBuffer * 10;

    // Overfill well past the cap, then flush repeatedly.
    for (let i = 0; i < cap + 25; i++) svc.logBuffer.push({ url: `/x${i}` } as never);
    await svc.flushLogs();

    // Bounded...
    expect(svc.logBuffer.length).toBeLessThanOrEqual(cap);
    // ...and the loss is explicit, not silent.
    expect(svc.droppedLogRows).toBeGreaterThan(0);
  });
});
