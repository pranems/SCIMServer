import { EndpointContextStorage } from './endpoint-context.storage';

describe('EndpointContextStorage', () => {
  let storage: EndpointContextStorage;

  beforeEach(() => {
    storage = new EndpointContextStorage();
  });

  describe('setContext and getContext', () => {
    it('should set and retrieve context', () => {
      const context = {
        endpointId: 'endpoint-1',
        baseUrl: 'http://localhost:3000/scim/endpoints/endpoint-1',
        config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' as const },
      };

      storage.setContext(context);
      const result = storage.getContext();

      expect(result).toEqual(context);
    });

    it('should return undefined when no context is set', () => {
      const result = storage.getContext();

      expect(result).toBeUndefined();
    });

    it('should overwrite previous context', () => {
      const context1 = {
        endpointId: 'endpoint-1',
        baseUrl: 'http://localhost:3000/scim/endpoints/endpoint-1',
      };
      const context2 = {
        endpointId: 'endpoint-2',
        baseUrl: 'http://localhost:3000/scim/endpoints/endpoint-2',
      };

      storage.setContext(context1);
      storage.setContext(context2);
      const result = storage.getContext();

      expect(result?.endpointId).toBe('endpoint-2');
    });
  });

  describe('getEndpointId', () => {
    it('should return endpointId from context', () => {
      storage.setContext({
        endpointId: 'endpoint-1',
        baseUrl: 'http://localhost:3000',
      });

      expect(storage.getEndpointId()).toBe('endpoint-1');
    });

    it('should return undefined when no context is set', () => {
      expect(storage.getEndpointId()).toBeUndefined();
    });
  });

  describe('getBaseUrl', () => {
    it('should return baseUrl from context', () => {
      storage.setContext({
        endpointId: 'endpoint-1',
        baseUrl: 'http://localhost:3000/scim/endpoints/endpoint-1',
      });

      expect(storage.getBaseUrl()).toBe('http://localhost:3000/scim/endpoints/endpoint-1');
    });

    it('should return undefined when no context is set', () => {
      expect(storage.getBaseUrl()).toBeUndefined();
    });
  });

  describe('getConfig', () => {
    it('should return config from context', () => {
      const config = { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' as const };
      storage.setContext({
        endpointId: 'endpoint-1',
        baseUrl: 'http://localhost:3000',
        config,
      });

      expect(storage.getConfig()).toEqual(config);
    });

    it('should return undefined when no context is set', () => {
      expect(storage.getConfig()).toBeUndefined();
    });

    it('should return undefined when context has no config', () => {
      storage.setContext({
        endpointId: 'endpoint-1',
        baseUrl: 'http://localhost:3000',
      });

      expect(storage.getConfig()).toBeUndefined();
    });
  });

  // ─── Warnings ─────────────────────────────────────────────────────

  describe('addWarnings / getWarnings', () => {
    it('should return empty array when no context exists', () => {
      expect(storage.getWarnings()).toEqual([]);
    });

    it('should return empty array when no warnings added', () => {
      storage.setContext({ endpointId: 'ep', baseUrl: 'http://x' });
      expect(storage.getWarnings()).toEqual([]);
    });

    it('should accumulate warnings', () => {
      storage.setContext({ endpointId: 'ep', baseUrl: 'http://x' });
      storage.addWarnings(['id']);
      storage.addWarnings(['groups', 'meta']);
      expect(storage.getWarnings()).toEqual(['id', 'groups', 'meta']);
    });

    it('should not add when warning array is empty', () => {
      storage.setContext({ endpointId: 'ep', baseUrl: 'http://x' });
      storage.addWarnings([]);
      expect(storage.getWarnings()).toEqual([]);
    });

    it('should silently ignore addWarnings when no store exists', () => {
      // No setContext called - addWarnings should not throw
      storage.addWarnings(['id']);
      expect(storage.getWarnings()).toEqual([]);
    });
  });

  // ─── Middleware (storage.run) ─────────────────────────────────────

  describe('createMiddleware', () => {
    it('should create a function that wraps next() in a storage run', (done) => {
      const mw = storage.createMiddleware();

      mw({} as any, {} as any, () => {
        // Inside the middleware callback, the store should exist
        expect(storage.getContext()).toBeDefined();
        expect(storage.getContext()!.endpointId).toBe('');
        done();
      });
    });

    it('should allow setContext to mutate the store created by middleware', (done) => {
      const mw = storage.createMiddleware();

      mw({} as any, {} as any, () => {
        storage.setContext({ endpointId: 'ep-1', baseUrl: 'http://x', config: {} });
        expect(storage.getEndpointId()).toBe('ep-1');
        done();
      });
    });

    it('should propagate warnings through middleware + setContext flow', (done) => {
      const mw = storage.createMiddleware();

      mw({} as any, {} as any, () => {
        // Simulate controller → service → controller flow
        storage.setContext({ endpointId: 'ep-1', baseUrl: 'http://x' });
        storage.addWarnings(['id', 'groups']);
        expect(storage.getWarnings()).toEqual(['id', 'groups']);
        done();
      });
    });

    it('should preserve warnings across setContext calls within same middleware scope', (done) => {
      const mw = storage.createMiddleware();

      mw({} as any, {} as any, () => {
        // Warnings added before setContext
        storage.addWarnings(['early-warning']);
        // setContext mutates existing store - warnings should persist
        storage.setContext({ endpointId: 'ep-1', baseUrl: 'http://x' });
        storage.addWarnings(['late-warning']);
        expect(storage.getWarnings()).toEqual(['early-warning', 'late-warning']);
        done();
      });
    });
  });

  // ─── run() scoped context ────────────────────────────────────────

  describe('run', () => {
    it('should scope context to the callback', () => {
      const result = storage.run({ endpointId: 'ep-run', baseUrl: 'http://x' }, () => {
        return storage.getEndpointId();
      });
      expect(result).toBe('ep-run');
      expect(storage.getEndpointId()).toBeUndefined();
    });

    it('should support warnings inside run scope', () => {
      storage.run({ endpointId: 'ep', baseUrl: 'http://x' }, () => {
        storage.addWarnings(['stripped-attr']);
        expect(storage.getWarnings()).toEqual(['stripped-attr']);
      });
    });
  });

  // ─── Profile support (Phase 14.1) ──────────────────────────────────

  describe('profile support', () => {
    const mockProfile = {
      schemas: [{ id: 'urn:test', name: 'Test', description: 'Test', attributes: [] }],
      resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:test', schemaExtensions: [] }],
      serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
      settings: { SoftDeleteEnabled: 'True', StrictSchemaValidation: 'False' },
    } as any;

    it('should store profile via setContext', () => {
      storage.setContext({ endpointId: 'ep-1', baseUrl: 'http://x', profile: mockProfile });
      expect(storage.getContext()?.profile).toBe(mockProfile);
    });

    it('getProfile() should return stored profile', () => {
      storage.setContext({ endpointId: 'ep-1', baseUrl: 'http://x', profile: mockProfile });
      expect(storage.getProfile()).toBe(mockProfile);
    });

    it('getProfile() should return undefined when no profile set', () => {
      storage.setContext({ endpointId: 'ep-1', baseUrl: 'http://x' });
      expect(storage.getProfile()).toBeUndefined();
    });

    it('getConfig() should fall back to profile.settings when config not provided', () => {
      storage.setContext({ endpointId: 'ep-1', baseUrl: 'http://x', profile: mockProfile });
      const config = storage.getConfig();
      expect(config).toBeDefined();
      expect((config as any).SoftDeleteEnabled).toBe('True');
    });

    it('getConfig() should prefer explicit config over profile.settings', () => {
      const explicitConfig = { RequireIfMatch: 'True' };
      storage.setContext({
        endpointId: 'ep-1',
        baseUrl: 'http://x',
        profile: mockProfile,
        config: explicitConfig as any,
      });
      expect(storage.getConfig()).toBe(explicitConfig);
    });

    it('should propagate profile through middleware → setContext flow', () => {
      const middleware = storage.createMiddleware();
      middleware({} as any, {} as any, () => {
        storage.setContext({ endpointId: 'ep-m', baseUrl: 'http://x', profile: mockProfile });
        expect(storage.getProfile()).toBe(mockProfile);
      });
    });
  });
});
