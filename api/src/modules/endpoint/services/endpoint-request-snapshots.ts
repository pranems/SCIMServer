import { AsyncLocalStorage } from 'node:async_hooks';
import type { CachedEndpoint } from './endpoint.service';

interface RequestSnapshots {
  active: boolean;
  pending: Map<string, Promise<CachedEndpoint>>;
}

export class EndpointRequestSnapshots {
  private readonly storage = new AsyncLocalStorage<RequestSnapshots>();

  run<T>(work: () => T, registerEnd: (end: () => void) => void): T {
    const scope: RequestSnapshots = { active: true, pending: new Map() };
    registerEnd(() => {
      scope.active = false;
      scope.pending.clear();
    });
    return this.storage.run(scope, work);
  }

  async resolve(endpointId: string, load: () => Promise<CachedEndpoint>): Promise<CachedEndpoint> {
    const scope = this.storage.getStore();
    if (!scope?.active) return load();
    const key = endpointId.toLowerCase();
    const existing = scope.pending.get(key);
    if (existing) return existing;
    const pending = load();
    scope.pending.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (scope.pending.get(key) === pending) scope.pending.delete(key);
      throw error;
    }
  }
}
