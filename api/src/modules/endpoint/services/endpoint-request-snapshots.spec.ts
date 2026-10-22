import { EndpointRequestSnapshots } from './endpoint-request-snapshots';
import type { CachedEndpoint } from './endpoint.service';
import { endpointProfileRevision } from '../../../domain/repositories/profile-revision';

describe('Request-bounded verified endpoint snapshots', () => {
  const snapshot: CachedEndpoint = {
    id: 'endpoint', name: 'original', active: true, scimBasePath: '/scim/endpoints/endpoint',
    profileRevision: endpointProfileRevision(null),
    createdAt: new Date('2026-10-20T00:00:00Z'), updatedAt: new Date('2026-10-20T00:00:00Z'),
  };
  const storage = new EndpointRequestSnapshots();

  it('coalesces concurrent same-endpoint reads but starts fresh in the next scope', async () => {
    const load = jest.fn(() => Promise.resolve(snapshot));
    await storage.run(async () => {
      const values = await Promise.all([storage.resolve('ENDPOINT', load), storage.resolve('endpoint', load)]);
      expect(values).toEqual([snapshot, snapshot]);
      expect(load).toHaveBeenCalledTimes(1);
    }, () => undefined);
    const changed = { ...snapshot, name: 'new request' };
    load.mockResolvedValue(changed);
    expect(await storage.run(() => storage.resolve('endpoint', load), () => undefined)).toBe(changed);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps calls outside a request independently authoritative', async () => {
    const load = jest.fn(() => Promise.resolve(snapshot));
    await storage.resolve('endpoint', load);
    await storage.resolve('endpoint', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('propagates a failed lookup and allows a later fresh lookup without a stale fallback', async () => {
    const error = new Error('database unavailable');
    const load = jest.fn(() => Promise.resolve(snapshot)).mockRejectedValueOnce(error);
    await storage.run(async () => {
      await expect(storage.resolve('endpoint', load)).rejects.toBe(error);
      expect(await storage.resolve('endpoint', load)).toBe(snapshot);
      expect(load).toHaveBeenCalledTimes(2);
    }, () => undefined);
  });

  it('ends reuse for inherited asynchronous work when the response ends', async () => {
    let end: () => void = () => { throw new Error('Response end was not registered'); };
    const load = jest.fn(() => Promise.resolve(snapshot));
    await storage.run(async () => {
      expect(await storage.resolve('endpoint', load)).toBe(snapshot);
      end();
      const changed = { ...snapshot, active: false };
      load.mockResolvedValue(changed);
      expect(await storage.resolve('endpoint', load)).toBe(changed);
      expect(load).toHaveBeenCalledTimes(2);
    }, close => { end = close; });
  });

  it('does not repopulate an ended scope when a pending observation arrives late', async () => {
    let end: () => void = () => { throw new Error('Response end was not registered'); };
    let release!: (value: CachedEndpoint) => void;
    const pending = new Promise<CachedEndpoint>(resolve => { release = resolve; });
    const changed = { ...snapshot, name: 'after completion' };
    const fresh = jest.fn(() => Promise.resolve(changed));
    await storage.run(async () => {
      const first = storage.resolve('endpoint', () => pending);
      end();
      expect(await storage.resolve('endpoint', fresh)).toBe(changed);
      release(snapshot);
      expect(await first).toBe(snapshot);
      expect(await storage.resolve('endpoint', fresh)).toBe(changed);
      expect(fresh).toHaveBeenCalledTimes(2);
    }, close => { end = close; });
  });

  it('does not share observations between overlapping requests or different endpoints', async () => {
    const changed = { ...snapshot, name: 'parallel request' };
    const first = jest.fn(() => Promise.resolve(snapshot));
    const second = jest.fn(() => Promise.resolve(changed));
    const values = await Promise.all([
      storage.run(() => storage.resolve('endpoint', first), () => undefined),
      storage.run(() => storage.resolve('endpoint', second), () => undefined),
    ]);
    expect(values).toEqual([snapshot, changed]);
    await storage.run(async () => {
      expect(await storage.resolve('one', first)).toBe(snapshot);
      expect(await storage.resolve('two', second)).toBe(changed);
    }, () => undefined);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
