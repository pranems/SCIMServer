import { HttpException } from '@nestjs/common';
import { ResourceTypesController } from './resource-types.controller';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
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

describe('ResourceTypesController', () => {
  let controller: ResourceTypesController;

  beforeEach(async () => {
    const registry = new ScimSchemaRegistry(mockScimLogger);
    await registry.onModuleInit();
    const discoveryService = new ScimDiscoveryService(registry);
    controller = new ResourceTypesController(discoveryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getResourceTypes', () => {
    it('should return ListResponse schema', () => {
      const result = controller.getResourceTypes();
      expect(result.schemas).toEqual([
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
      ]);
    });

    it('should return 2 resource types', () => {
      const result = controller.getResourceTypes();
      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
    });

    it('should include User resource type', () => {
      const result = controller.getResourceTypes();
      const userType = result.Resources.find((r: any) => r.id === 'User');
      expect(userType).toBeDefined();
      expect(userType!.name).toBe('User');
      expect(userType!.endpoint).toBe('/Users');
      expect(userType!.schema).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
    });

    it('should include Enterprise User extension on User resource type', () => {
      const result = controller.getResourceTypes();
      const userType = result.Resources.find((r: any) => r.id === 'User');
      expect(userType!.schemaExtensions).toHaveLength(1); // EnterpriseUser
      expect(userType!.schemaExtensions[0].schema).toBe(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      );
      expect(userType!.schemaExtensions[0].required).toBe(false);
    });

    it('should include Group resource type with msfttest extensions', () => {
      const result = controller.getResourceTypes();
      const groupType = result.Resources.find((r: any) => r.id === 'Group');
      expect(groupType).toBeDefined();
      expect(groupType!.name).toBe('Group');
      expect(groupType!.endpoint).toBe('/Groups');
      expect(groupType!.schema).toBe('urn:ietf:params:scim:schemas:core:2.0:Group');
      expect(groupType!.schemaExtensions).toHaveLength(0); // no extensions
    });

    it('should have correct pagination metadata', () => {
      const result = controller.getResourceTypes();
      expect(result.startIndex).toBe(1);
      expect(result.itemsPerPage).toBe(2);
    });

    // ─── D5: schemas[] on ResourceType resources (RFC 7644 §4) ────────

    it('should include schemas[] array on each resource type (D5)', () => {
      const result = controller.getResourceTypes();
      for (const rt of result.Resources) {
        expect((rt as any).schemas).toBeDefined();
        expect((rt as any).schemas).toEqual([
          'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
        ]);
      }
    });
  });

  // ─── getResourceTypeById (D3: Individual ResourceType lookup) ──────────

  describe('getResourceTypeById', () => {
    it('should return User resource type by id', () => {
      const result = controller.getResourceTypeById('User');
      expect(result).toBeDefined();
      expect(result.id).toBe('User');
      expect(result.name).toBe('User');
      expect(result.endpoint).toBe('/Users');
    });

    it('should return Group resource type by id', () => {
      const result = controller.getResourceTypeById('Group');
      expect(result).toBeDefined();
      expect(result.id).toBe('Group');
      expect(result.name).toBe('Group');
      expect(result.endpoint).toBe('/Groups');
    });

    it('should throw 404 SCIM error for unknown resource type id', () => {
      expect(() =>
        controller.getResourceTypeById('Unknown'),
      ).toThrow(HttpException);

      try {
        controller.getResourceTypeById('Unknown');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
        const body = (e as HttpException).getResponse() as any;
        expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
        expect(body.detail).toContain('Unknown');
        expect(body.status).toBe('404');
      }
    });

    it('should include schemas[] on individually retrieved resource type (D5)', () => {
      const result = controller.getResourceTypeById('User');
      expect((result as any).schemas).toEqual([
        'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
      ]);
    });

    it('should include schema extensions on individually retrieved User resource type', () => {
      const result = controller.getResourceTypeById('User');
      expect(result.schemaExtensions).toHaveLength(1); // EnterpriseUser
      expect(result.schemaExtensions[0].schema).toBe(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      );
    });
  });
});
