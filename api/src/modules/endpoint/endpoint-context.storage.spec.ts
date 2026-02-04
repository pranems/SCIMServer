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
});
