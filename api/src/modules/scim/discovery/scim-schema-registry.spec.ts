import { BadRequestException } from '@nestjs/common';
import { ScimSchemaRegistry, ScimSchemaDefinition } from './scim-schema-registry';
import type { IEndpointSchemaRepository } from '../../../domain/repositories/endpoint-schema.repository.interface';
import type { EndpointSchemaRecord } from '../../../domain/models/endpoint-schema.model';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_SP_CONFIG_SCHEMA,
} from '../common/scim-constants';

describe('ScimSchemaRegistry', () => {
  let registry: ScimSchemaRegistry;

  beforeEach(() => {
    registry = new ScimSchemaRegistry();
  });

  // ─── Built-in initialization ────────────────────────────────────────────

  describe('built-in schemas', () => {
    it('should initialize with 3 schemas (User, EnterpriseUser, Group)', () => {
      const schemas = registry.getAllSchemas();
      expect(schemas).toHaveLength(3);
      const ids = schemas.map((s) => s.id);
      expect(ids).toContain(SCIM_CORE_USER_SCHEMA);
      expect(ids).toContain(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(ids).toContain(SCIM_CORE_GROUP_SCHEMA);
    });

    it('should initialize with 2 resource types (User, Group)', () => {
      const types = registry.getAllResourceTypes();
      expect(types).toHaveLength(2);
      const ids = types.map((t) => t.id);
      expect(ids).toContain('User');
      expect(ids).toContain('Group');
    });

    it('should have Enterprise User extension on User resource type', () => {
      const userRT = registry.getResourceType('User');
      expect(userRT).toBeDefined();
      expect(userRT!.schemaExtensions).toHaveLength(1);
      expect(userRT!.schemaExtensions[0].schema).toBe(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(userRT!.schemaExtensions[0].required).toBe(false);
    });

    it('should have no extensions on Group resource type', () => {
      const groupRT = registry.getResourceType('Group');
      expect(groupRT!.schemaExtensions).toHaveLength(0);
    });

    it('should return Enterprise User as extension URN', () => {
      const urns = registry.getExtensionUrns();
      expect(urns).toContain(SCIM_ENTERPRISE_USER_SCHEMA);
    });

    it('should mark User and Group as core schemas', () => {
      expect(registry.isCoreSchema(SCIM_CORE_USER_SCHEMA)).toBe(true);
      expect(registry.isCoreSchema(SCIM_CORE_GROUP_SCHEMA)).toBe(true);
      expect(registry.isCoreSchema(SCIM_ENTERPRISE_USER_SCHEMA)).toBe(false);
    });
  });

  // ─── registerExtension ─────────────────────────────────────────────────

  describe('registerExtension', () => {
    const customSchema: ScimSchemaDefinition = {
      id: 'urn:example:custom:2.0:User',
      name: 'CustomExtension',
      description: 'Custom attributes for testing',
      attributes: [
        {
          name: 'badgeNumber',
          type: 'string',
          multiValued: false,
          required: false,
          description: 'Employee badge number',
        },
        {
          name: 'floor',
          type: 'integer',
          multiValued: false,
          required: false,
          description: 'Office floor number',
        },
      ],
    };

    it('should register a custom extension schema', () => {
      registry.registerExtension(customSchema);

      expect(registry.hasSchema(customSchema.id)).toBe(true);
      const schemas = registry.getAllSchemas();
      expect(schemas).toHaveLength(4);
    });

    it('should return the registered schema via getSchema()', () => {
      registry.registerExtension(customSchema);

      const retrieved = registry.getSchema(customSchema.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('CustomExtension');
      expect(retrieved!.attributes).toHaveLength(2);
    });

    it('should auto-populate meta if not provided', () => {
      registry.registerExtension(customSchema);

      const retrieved = registry.getSchema(customSchema.id)!;
      expect(retrieved.meta).toBeDefined();
      expect(retrieved.meta!.resourceType).toBe('Schema');
      expect(retrieved.meta!.location).toBe(`/Schemas/${customSchema.id}`);
    });

    it('should preserve custom meta if provided', () => {
      const withMeta: ScimSchemaDefinition = {
        ...customSchema,
        meta: { resourceType: 'Schema', location: '/custom/location' },
      };
      registry.registerExtension(withMeta);

      expect(registry.getSchema(customSchema.id)!.meta!.location).toBe('/custom/location');
    });

    it('should attach extension to a resource type', () => {
      registry.registerExtension(customSchema, 'User');

      const userRT = registry.getResourceType('User')!;
      expect(userRT.schemaExtensions).toHaveLength(2); // Enterprise + Custom
      expect(userRT.schemaExtensions[1].schema).toBe(customSchema.id);
      expect(userRT.schemaExtensions[1].required).toBe(false);
    });

    it('should respect the required parameter', () => {
      registry.registerExtension(customSchema, 'User', true);

      const userRT = registry.getResourceType('User')!;
      const ext = userRT.schemaExtensions.find((e) => e.schema === customSchema.id);
      expect(ext!.required).toBe(true);
    });

    it('should include extension URN in getExtensionUrns()', () => {
      registry.registerExtension(customSchema, 'User');

      const urns = registry.getExtensionUrns();
      expect(urns).toContain(customSchema.id);
      expect(urns).toContain(SCIM_ENTERPRISE_USER_SCHEMA);
    });

    it('should include extension URN in getExtensionUrnsForResourceType()', () => {
      registry.registerExtension(customSchema, 'Group');

      const urns = registry.getExtensionUrnsForResourceType('Group');
      expect(urns).toContain(customSchema.id);
    });

    it('should not duplicate extension on repeated registration', () => {
      registry.registerExtension(customSchema, 'User');
      registry.registerExtension(customSchema, 'User');

      const userRT = registry.getResourceType('User')!;
      const matches = userRT.schemaExtensions.filter((e) => e.schema === customSchema.id);
      expect(matches).toHaveLength(1);
    });

    it('should allow registration without attaching to resource type', () => {
      registry.registerExtension(customSchema);

      // Schema exists
      expect(registry.hasSchema(customSchema.id)).toBe(true);

      // But not attached to any resource type
      const userRT = registry.getResourceType('User')!;
      expect(userRT.schemaExtensions).toHaveLength(1); // only Enterprise
    });

    it('should register multiple extensions on same resource type', () => {
      const secondSchema: ScimSchemaDefinition = {
        id: 'urn:example:second:2.0:User',
        name: 'SecondExtension',
        description: 'Another extension',
        attributes: [{ name: 'field', type: 'string', multiValued: false, required: false }],
      };

      registry.registerExtension(customSchema, 'User');
      registry.registerExtension(secondSchema, 'User');

      const userRT = registry.getResourceType('User')!;
      expect(userRT.schemaExtensions).toHaveLength(3); // Enterprise + 2 custom
    });

    it('should register extension on Group resource type', () => {
      const groupExt: ScimSchemaDefinition = {
        id: 'urn:example:group-ext:2.0:Group',
        name: 'GroupExtension',
        description: 'Group extension',
        attributes: [{ name: 'department', type: 'string', multiValued: false, required: false }],
      };

      registry.registerExtension(groupExt, 'Group');

      const groupRT = registry.getResourceType('Group')!;
      expect(groupRT.schemaExtensions).toHaveLength(1);
      expect(groupRT.schemaExtensions[0].schema).toBe(groupExt.id);
    });

    // ─── Validation errors ────────────────────────────────────────────────

    it('should throw if schema id is missing', () => {
      const noId = { ...customSchema, id: '' } as ScimSchemaDefinition;

      expect(() => registry.registerExtension(noId)).toThrow(BadRequestException);
      expect(() => registry.registerExtension(noId)).toThrow('must have an "id"');
    });

    it('should throw if trying to overwrite a core schema', () => {
      const coreOverwrite: ScimSchemaDefinition = {
        ...customSchema,
        id: SCIM_CORE_USER_SCHEMA,
      };

      expect(() => registry.registerExtension(coreOverwrite)).toThrow(BadRequestException);
      expect(() => registry.registerExtension(coreOverwrite)).toThrow('core schema');
    });

    it('should throw if resource type does not exist', () => {
      expect(() => registry.registerExtension(customSchema, 'Device')).toThrow(
        BadRequestException,
      );
      expect(() => registry.registerExtension(customSchema, 'Device')).toThrow(
        'Resource type "Device" not found',
      );
    });
  });

  // ─── unregisterExtension ───────────────────────────────────────────────

  describe('unregisterExtension', () => {
    const customSchema: ScimSchemaDefinition = {
      id: 'urn:example:removable:2.0:User',
      name: 'Removable',
      description: 'Extension that will be removed',
      attributes: [{ name: 'temp', type: 'string', multiValued: false, required: false }],
    };

    it('should remove a custom extension schema', () => {
      registry.registerExtension(customSchema, 'User');
      expect(registry.hasSchema(customSchema.id)).toBe(true);

      const removed = registry.unregisterExtension(customSchema.id);
      expect(removed).toBe(true);
      expect(registry.hasSchema(customSchema.id)).toBe(false);
    });

    it('should remove extension from resource type', () => {
      registry.registerExtension(customSchema, 'User');
      registry.unregisterExtension(customSchema.id);

      const userRT = registry.getResourceType('User')!;
      const match = userRT.schemaExtensions.find((e) => e.schema === customSchema.id);
      expect(match).toBeUndefined();
    });

    it('should remove extension URN from getExtensionUrns()', () => {
      registry.registerExtension(customSchema, 'User');
      registry.unregisterExtension(customSchema.id);

      const urns = registry.getExtensionUrns();
      expect(urns).not.toContain(customSchema.id);
      expect(urns).toContain(SCIM_ENTERPRISE_USER_SCHEMA); // still there
    });

    it('should return false for non-existent schema', () => {
      const removed = registry.unregisterExtension('urn:does:not:exist');
      expect(removed).toBe(false);
    });

    it('should throw if trying to unregister a core schema', () => {
      expect(() => registry.unregisterExtension(SCIM_CORE_USER_SCHEMA)).toThrow(
        BadRequestException,
      );
      expect(() => registry.unregisterExtension(SCIM_CORE_USER_SCHEMA)).toThrow(
        'core schema',
      );
    });
  });

  // ─── Query methods ─────────────────────────────────────────────────────

  describe('query methods', () => {
    it('getSchema returns undefined for unknown URN', () => {
      expect(registry.getSchema('urn:unknown')).toBeUndefined();
    });

    it('getResourceType returns undefined for unknown id', () => {
      expect(registry.getResourceType('Device')).toBeUndefined();
    });

    it('hasSchema returns true for registered, false for unknown', () => {
      expect(registry.hasSchema(SCIM_CORE_USER_SCHEMA)).toBe(true);
      expect(registry.hasSchema('urn:unknown')).toBe(false);
    });

    it('getExtensionUrnsForResourceType returns empty for no extensions', () => {
      const urns = registry.getExtensionUrnsForResourceType('Group');
      expect(urns).toHaveLength(0);
    });

    it('getServiceProviderConfig returns a copy', () => {
      const c1 = registry.getServiceProviderConfig();
      const c2 = registry.getServiceProviderConfig();
      expect(c1).not.toBe(c2);
      expect(c1).toEqual(c2);
      expect(c1.schemas).toEqual([SCIM_SP_CONFIG_SCHEMA]);
    });
  });

  // ─── Per-endpoint extensions ────────────────────────────────────────────

  describe('per-endpoint extensions', () => {
    const epSchema: ScimSchemaDefinition = {
      id: 'urn:example:ep:2.0:User',
      name: 'EndpointExtension',
      description: 'Endpoint-specific extension',
      attributes: [{ name: 'division', type: 'string', multiValued: false, required: false }],
    };

    // ─── Registration scoped to an endpoint ─────────────────────────────

    it('should register an extension scoped to a specific endpoint', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      // Visible to ep-1
      expect(registry.hasSchema(epSchema.id, 'ep-1')).toBe(true);
      expect(registry.getAllSchemas('ep-1')).toHaveLength(4);

      // NOT visible globally
      expect(registry.hasSchema(epSchema.id)).toBe(false);
      expect(registry.getAllSchemas()).toHaveLength(3);
    });

    it('should not affect other endpoints', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      // ep-2 does not see ep-1's extension
      expect(registry.hasSchema(epSchema.id, 'ep-2')).toBe(false);
      expect(registry.getAllSchemas('ep-2')).toHaveLength(3);
    });

    it('should merge global + endpoint schemas in getAllSchemas(endpointId)', () => {
      const globalExt: ScimSchemaDefinition = {
        id: 'urn:example:global:2.0:User',
        name: 'GlobalExt',
        description: 'Global extension',
        attributes: [],
      };
      registry.registerExtension(globalExt, 'User');
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      // ep-1 sees: 3 built-in + 1 global + 1 endpoint = 5
      expect(registry.getAllSchemas('ep-1')).toHaveLength(5);

      // ep-2 sees: 3 built-in + 1 global = 4
      expect(registry.getAllSchemas('ep-2')).toHaveLength(4);
    });

    it('should include endpoint extension URNs in getExtensionUrns(endpointId)', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      const ep1Urns = registry.getExtensionUrns('ep-1');
      expect(ep1Urns).toContain(epSchema.id);
      expect(ep1Urns).toContain(SCIM_ENTERPRISE_USER_SCHEMA);

      // Global does not include endpoint-specific
      const globalUrns = registry.getExtensionUrns();
      expect(globalUrns).not.toContain(epSchema.id);
    });

    it('should merge endpoint extensions into resource type', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      // ep-1 User RT has 2 extensions (Enterprise + endpoint)
      const ep1UserRT = registry.getResourceType('User', 'ep-1')!;
      expect(ep1UserRT.schemaExtensions).toHaveLength(2);

      // Global User RT has only Enterprise
      const globalUserRT = registry.getResourceType('User')!;
      expect(globalUserRT.schemaExtensions).toHaveLength(1);
    });

    it('should merge endpoint extensions in getAllResourceTypes(endpointId)', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      const rts = registry.getAllResourceTypes('ep-1');
      const userRT = rts.find((r) => r.id === 'User')!;
      expect(userRT.schemaExtensions).toHaveLength(2);

      // Group RT is unaffected
      const groupRT = rts.find((r) => r.id === 'Group')!;
      expect(groupRT.schemaExtensions).toHaveLength(0);
    });

    it('should include endpoint URNs in getExtensionUrnsForResourceType(rt, endpointId)', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      const ep1Urns = registry.getExtensionUrnsForResourceType('User', 'ep-1');
      expect(ep1Urns).toContain(epSchema.id);
      expect(ep1Urns).toContain(SCIM_ENTERPRISE_USER_SCHEMA);

      // Global has only Enterprise
      const globalUrns = registry.getExtensionUrnsForResourceType('User');
      expect(globalUrns).not.toContain(epSchema.id);
    });

    it('should return endpoint-specific schema via getSchema(urn, endpointId)', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      expect(registry.getSchema(epSchema.id, 'ep-1')).toBeDefined();
      expect(registry.getSchema(epSchema.id, 'ep-1')!.name).toBe('EndpointExtension');

      // Not visible globally
      expect(registry.getSchema(epSchema.id)).toBeUndefined();
    });

    // ─── Unregistration scoped to endpoint ──────────────────────────────

    it('should unregister endpoint-specific extension without affecting global', () => {
      const globalExt: ScimSchemaDefinition = {
        id: 'urn:example:shared:2.0:User',
        name: 'SharedExt',
        description: 'registered globally',
        attributes: [],
      };
      registry.registerExtension(globalExt, 'User');
      registry.registerExtension(epSchema, 'User', false, 'ep-1');

      // Remove only ep-1's extension
      const removed = registry.unregisterExtension(epSchema.id, 'ep-1');
      expect(removed).toBe(true);
      expect(registry.hasSchema(epSchema.id, 'ep-1')).toBe(false);

      // Global extension still exists
      expect(registry.hasSchema(globalExt.id)).toBe(true);
    });

    it('should return false when unregistering non-existent endpoint extension', () => {
      expect(registry.unregisterExtension('urn:nope', 'ep-1')).toBe(false);
    });

    it('should return false when endpoint has no overlay', () => {
      expect(registry.unregisterExtension('urn:nope', 'ep-999')).toBe(false);
    });

    // ─── clearEndpointOverlay ───────────────────────────────────────────

    it('should clear all endpoint-specific extensions', () => {
      registry.registerExtension(epSchema, 'User', false, 'ep-1');
      registry.registerExtension({
        id: 'urn:example:ep2:2.0:User',
        name: 'EpExt2',
        description: 'Second',
        attributes: [],
      }, 'User', false, 'ep-1');

      expect(registry.getAllSchemas('ep-1')).toHaveLength(5); // 3 + 2

      registry.clearEndpointOverlay('ep-1');

      expect(registry.getAllSchemas('ep-1')).toHaveLength(3); // back to defaults
    });

    // ─── getEndpointIds ─────────────────────────────────────────────────

    it('should list endpoint IDs with custom overrides', () => {
      expect(registry.getEndpointIds()).toHaveLength(0);

      registry.registerExtension(epSchema, 'User', false, 'ep-1');
      registry.registerExtension(epSchema, 'User', false, 'ep-2');

      const ids = registry.getEndpointIds();
      expect(ids).toContain('ep-1');
      expect(ids).toContain('ep-2');
      expect(ids).toHaveLength(2);
    });

    // ─── Validation in per-endpoint context ─────────────────────────────

    it('should throw if resource type does not exist (endpoint-scoped)', () => {
      expect(() => registry.registerExtension(epSchema, 'Device', false, 'ep-1')).toThrow(
        BadRequestException,
      );
    });

    it('should throw if schema id is empty (endpoint-scoped)', () => {
      const noId = { ...epSchema, id: '' };
      expect(() => registry.registerExtension(noId, 'User', false, 'ep-1')).toThrow(
        'must have an "id"',
      );
    });

    it('should throw if trying to overwrite core schema (endpoint-scoped)', () => {
      const core = { ...epSchema, id: SCIM_CORE_USER_SCHEMA };
      expect(() => registry.registerExtension(core, 'User', false, 'ep-1')).toThrow(
        'core schema',
      );
    });

    // ─── Isolation between endpoints ────────────────────────────────────

    it('should allow different endpoints to have different extensions', () => {
      const ext1: ScimSchemaDefinition = {
        id: 'urn:example:ep1-only:2.0:User',
        name: 'Ep1Only',
        description: 'Only for ep-1',
        attributes: [],
      };
      const ext2: ScimSchemaDefinition = {
        id: 'urn:example:ep2-only:2.0:User',
        name: 'Ep2Only',
        description: 'Only for ep-2',
        attributes: [],
      };

      registry.registerExtension(ext1, 'User', false, 'ep-1');
      registry.registerExtension(ext2, 'User', false, 'ep-2');

      // ep-1 sees ext1 but not ext2
      const ep1Schemas = registry.getAllSchemas('ep-1').map((s) => s.id);
      expect(ep1Schemas).toContain(ext1.id);
      expect(ep1Schemas).not.toContain(ext2.id);

      // ep-2 sees ext2 but not ext1
      const ep2Schemas = registry.getAllSchemas('ep-2').map((s) => s.id);
      expect(ep2Schemas).toContain(ext2.id);
      expect(ep2Schemas).not.toContain(ext1.id);
    });
  });

  // ─── onModuleInit — DB hydration ────────────────────────────────────────

  describe('onModuleInit (DB hydration)', () => {
    function fakeRecord(overrides: Partial<EndpointSchemaRecord> = {}): EndpointSchemaRecord {
      return {
        id: 'rec-1',
        endpointId: 'ep-db-1',
        schemaUrn: 'urn:example:db:2.0:User',
        name: 'DB Extension',
        description: 'From database',
        resourceTypeId: 'User',
        required: false,
        attributes: [
          { name: 'dbField', type: 'string', multiValued: false, required: false },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    function createMockRepo(rows: EndpointSchemaRecord[]): IEndpointSchemaRepository {
      return {
        findAll: jest.fn().mockResolvedValue(rows),
        create: jest.fn(),
        findByEndpointId: jest.fn(),
        findByEndpointAndUrn: jest.fn(),
        deleteByEndpointAndUrn: jest.fn(),
        deleteByEndpointId: jest.fn(),
      };
    }

    it('should hydrate extensions from database on startup', async () => {
      const mockRepo = createMockRepo([fakeRecord()]);
      const reg = new ScimSchemaRegistry(mockRepo);

      await reg.onModuleInit();

      // The schema should now be visible for the endpoint
      const schemas = reg.getAllSchemas('ep-db-1');
      const dbExt = schemas.find((s) => s.id === 'urn:example:db:2.0:User');
      expect(dbExt).toBeDefined();
      expect(dbExt!.name).toBe('DB Extension');
    });

    it('should attach extensions to the correct resource type', async () => {
      const mockRepo = createMockRepo([fakeRecord({ resourceTypeId: 'User' })]);
      const reg = new ScimSchemaRegistry(mockRepo);

      await reg.onModuleInit();

      const urns = reg.getExtensionUrns('ep-db-1');
      expect(urns).toContain('urn:example:db:2.0:User');
    });

    it('should hydrate multiple extensions across multiple endpoints', async () => {
      const rows = [
        fakeRecord({ endpointId: 'ep-a', schemaUrn: 'urn:ext:a' }),
        fakeRecord({ endpointId: 'ep-b', schemaUrn: 'urn:ext:b' }),
        fakeRecord({ endpointId: 'ep-a', schemaUrn: 'urn:ext:a2', id: 'rec-3' }),
      ];
      const mockRepo = createMockRepo(rows);
      const reg = new ScimSchemaRegistry(mockRepo);

      await reg.onModuleInit();

      const epASchemas = reg.getAllSchemas('ep-a');
      expect(epASchemas.find((s) => s.id === 'urn:ext:a')).toBeDefined();
      expect(epASchemas.find((s) => s.id === 'urn:ext:a2')).toBeDefined();

      const epBSchemas = reg.getAllSchemas('ep-b');
      expect(epBSchemas.find((s) => s.id === 'urn:ext:b')).toBeDefined();
      expect(epBSchemas.find((s) => s.id === 'urn:ext:a')).toBeUndefined();
    });

    it('should skip hydration when no repository is injected', async () => {
      const reg = new ScimSchemaRegistry(); // no repo

      // Should not throw
      await expect(reg.onModuleInit()).resolves.toBeUndefined();

      // Should still have only built-in schemas
      expect(reg.getAllSchemas()).toHaveLength(3);
    });

    it('should handle empty database (no persisted extensions)', async () => {
      const mockRepo = createMockRepo([]);
      const reg = new ScimSchemaRegistry(mockRepo);

      await reg.onModuleInit();

      expect(mockRepo.findAll).toHaveBeenCalled();
      // Only built-in schemas
      expect(reg.getAllSchemas()).toHaveLength(3);
    });

    it('should handle database errors gracefully (log and continue)', async () => {
      const mockRepo = createMockRepo([]);
      (mockRepo.findAll as jest.Mock).mockRejectedValue(new Error('DB connection failed'));
      const reg = new ScimSchemaRegistry(mockRepo);

      // Should not throw
      await expect(reg.onModuleInit()).resolves.toBeUndefined();

      // Built-in schemas should still be intact
      expect(reg.getAllSchemas()).toHaveLength(3);
    });

    it('should handle records with null description and resourceTypeId', async () => {
      const row = fakeRecord({
        description: null,
        resourceTypeId: null,
      });
      const mockRepo = createMockRepo([row]);
      const reg = new ScimSchemaRegistry(mockRepo);

      await reg.onModuleInit();

      const schemas = reg.getAllSchemas('ep-db-1');
      const ext = schemas.find((s) => s.id === row.schemaUrn);
      expect(ext).toBeDefined();
      expect(ext!.description).toBe('');
    });

    it('should handle non-array attributes gracefully', async () => {
      const row = fakeRecord({ attributes: 'not-an-array' as any });
      const mockRepo = createMockRepo([row]);
      const reg = new ScimSchemaRegistry(mockRepo);

      await reg.onModuleInit();

      const schemas = reg.getAllSchemas('ep-db-1');
      const ext = schemas.find((s) => s.id === row.schemaUrn);
      expect(ext).toBeDefined();
      // Non-array attributes should become empty array
      expect(ext!.attributes).toEqual([]);
    });
  });
});
