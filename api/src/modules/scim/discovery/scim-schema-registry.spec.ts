import { ScimSchemaRegistry } from './scim-schema-registry';
import { ScimLogger } from '../../logging/scim-logger.service';

const mockScimLogger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  isEnabled: jest.fn().mockReturnValue(true),
  getConfig: jest.fn().mockReturnValue({}),
  runWithContext: jest.fn((ctx, fn) => fn()),
  getContext: jest.fn(),
  enrichContext: jest.fn(),
} as unknown as ScimLogger;

describe('ScimSchemaRegistry (minimal - Phase 14.4)', () => {
  let registry: ScimSchemaRegistry;

  beforeEach(() => {
    registry = new ScimSchemaRegistry(mockScimLogger);
  });

  describe('before onModuleInit', () => {
    it('should return empty schemas before init', () => {
      expect(registry.getAllSchemas()).toHaveLength(0);
    });

    it('should return empty resource types before init', () => {
      expect(registry.getAllResourceTypes()).toHaveLength(0);
    });

    it('should return default SPC before init', () => {
      const spc = registry.getServiceProviderConfig();
      expect(spc).toBeDefined();
      expect(spc.patch).toBeDefined();
    });
  });

  describe('after onModuleInit', () => {
    beforeEach(async () => {
      await registry.onModuleInit();
    });

    it('should have schemas from rfc-standard preset', () => {
      const schemas = registry.getAllSchemas();
      expect(schemas.length).toBeGreaterThanOrEqual(3);
      const ids = schemas.map(s => s.id);
      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
    });

    it('should have resource types from rfc-standard preset', () => {
      const rts = registry.getAllResourceTypes();
      expect(rts.length).toBeGreaterThanOrEqual(2);
      const names = rts.map(r => r.name);
      expect(names).toContain('User');
      expect(names).toContain('Group');
    });

    it('should have SPC with all capabilities from rfc-standard', () => {
      const spc = registry.getServiceProviderConfig();
      expect(spc.patch.supported).toBe(true);
      expect(spc.bulk.supported).toBe(true);
      expect(spc.sort.supported).toBe(true);
      expect(spc.etag.supported).toBe(true);
    });

    it('getSchema should find User schema by URN', () => {
      const schema = registry.getSchema('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(schema).toBeDefined();
      expect(schema!.name).toBe('User');
    });

    it('getSchema should return undefined for unknown URN', () => {
      expect(registry.getSchema('urn:unknown')).toBeUndefined();
    });

    it('getResourceType should find User by id', () => {
      const rt = registry.getResourceType('User');
      expect(rt).toBeDefined();
      expect(rt!.endpoint).toBe('/Users');
    });

    it('getResourceType should return undefined for unknown id', () => {
      expect(registry.getResourceType('Unknown')).toBeUndefined();
    });

    it('getExtensionUrns should include EnterpriseUser', () => {
      const urns = registry.getExtensionUrns();
      expect(urns).toContain('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
    });
  });
});
