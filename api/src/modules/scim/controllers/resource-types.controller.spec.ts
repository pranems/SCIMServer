import { ResourceTypesController } from './resource-types.controller';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';

describe('ResourceTypesController', () => {
  let controller: ResourceTypesController;

  beforeEach(() => {
    const registry = new ScimSchemaRegistry();
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
      expect(userType!.schemaExtensions).toHaveLength(3); // Enterprise + 2 msfttest User extensions
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
      expect(groupType!.schemaExtensions).toHaveLength(2); // 2 msfttest Group extensions
    });

    it('should have correct pagination metadata', () => {
      const result = controller.getResourceTypes();
      expect(result.startIndex).toBe(1);
      expect(result.itemsPerPage).toBe(2);
    });
  });
});
