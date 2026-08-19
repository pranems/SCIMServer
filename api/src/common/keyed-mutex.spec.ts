/**
 * D - serialization primitive for read-modify-write sections (RED first).
 *
 * The auth-method admin API loads the whole `authentication` block, appends to
 * it, and writes it back. Two concurrent calls both read the same block and the
 * second write erases the first - and both callers get a success response, so
 * nothing anywhere reports the loss.
 */
import { KeyedMutex } from './keyed-mutex';

describe('KeyedMutex', () => {
  it('D-T1: concurrent work on the SAME key does not interleave', async () => {
    const mutex = new KeyedMutex();
    let shared: string[] = [];

    // Models the load -> compute -> persist shape exactly: the await between the
    // read and the write is where the lost update happens.
    const appendSlowly = (value: string) =>
      mutex.runExclusive('endpoint-1', async () => {
        const snapshot = shared;
        await new Promise((r) => setTimeout(r, 5));
        shared = [...snapshot, value];
      });

    await Promise.all([appendSlowly('a'), appendSlowly('b'), appendSlowly('c')]);

    expect(shared.sort()).toEqual(['a', 'b', 'c']);
  });

  it('D-T2: different keys still run concurrently', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    // A per-key lock that serialized everything would be a correctness fix that
    // quietly became a throughput bug, so the independence is worth asserting.
    await Promise.all([
      mutex.runExclusive('endpoint-1', async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('slow');
      }),
      mutex.runExclusive('endpoint-2', async () => {
        order.push('fast');
      }),
    ]);

    expect(order).toEqual(['fast', 'slow']);
  });

  it('D-T3: a rejected holder still releases the lock', async () => {
    const mutex = new KeyedMutex();

    const failed = mutex.runExclusive('endpoint-1', async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');

    // Without this the first failed admin call would wedge the endpoint forever.
    await expect(mutex.runExclusive('endpoint-1', async () => 'ok')).resolves.toBe('ok');
  });

  it('D-T4: the caller keeps the return value and the rejection', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.runExclusive('k', async () => 42)).resolves.toBe(42);
    await expect(mutex.runExclusive('k', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
  });

  it('D-T5: keys are released, so a long-lived server does not leak one entry per endpoint', async () => {
    const mutex = new KeyedMutex();
    for (let i = 0; i < 50; i++) {
      await mutex.runExclusive(`endpoint-${i}`, async () => undefined);
    }
    expect(mutex.size).toBe(0);
  });
});
