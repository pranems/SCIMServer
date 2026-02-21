import { ResourceTypesController } from './resource-types.controller';

describe('ResourceTypesController', () => {
  let controller: ResourceTypesController;

  beforeEach(() => {
    controller = new ResourceTypesController();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getResourceTypes', () => {
    it('should return ListResponse schema', () => {
      const result = controller.getResourceTypes();
      expect(result.schemas).toEqual([
        'urn:ietf:params:scim:schemas:core:2.0:ListResponse',
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

    it('should include Group resource type', () => {
      const result = controller.getResourceTypes();
      const groupType = result.Resources.find((r: any) => r.id === 'Group');
      expect(groupType).toBeDefined();
      expect(groupType!.name).toBe('Group');
      expect(groupType!.endpoint).toBe('/Groups');
      expect(groupType!.schema).toBe('urn:ietf:params:scim:schemas:core:2.0:Group');
    });

    it('should have correct pagination metadata', () => {
      const result = controller.getResourceTypes();
      expect(result.startIndex).toBe(1);
      expect(result.itemsPerPage).toBe(2);
    });
  });
});
