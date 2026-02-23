import { ScimDiscoveryService } from './scim-discovery.service';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_SP_CONFIG_SCHEMA,
  KNOWN_EXTENSION_URNS,
} from '../common/scim-constants';

describe('ScimDiscoveryService', () => {
  let service: ScimDiscoveryService;

  beforeEach(() => {
    service = new ScimDiscoveryService();
  });

  // ─── getSchemas ─────────────────────────────────────────────────────────

  describe('getSchemas', () => {
    it('should return a ListResponse with correct schema URI', () => {
      const result = service.getSchemas();
      expect(result.schemas).toEqual([SCIM_LIST_RESPONSE_SCHEMA]);
    });

    it('should include 3 schema definitions (User, EnterpriseUser, Group)', () => {
      const result = service.getSchemas();
      expect(result.totalResults).toBe(3);
      expect(result.Resources).toHaveLength(3);
    });

    it('should include Core User schema with correct id', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)!;
      expect(userSchema).toBeDefined();
      expect(userSchema.name).toBe('User');
      expect(userSchema.description).toBe('User Account');
      expect((userSchema as any).attributes.length).toBeGreaterThan(0);
    });

    it('should include Enterprise User Extension schema', () => {
      const result = service.getSchemas();
      const enterpriseSchema = result.Resources.find(
        (r: any) => r.id === SCIM_ENTERPRISE_USER_SCHEMA
      )!;
      expect(enterpriseSchema).toBeDefined();
      expect(enterpriseSchema.name).toBe('EnterpriseUser');
      expect(enterpriseSchema.description).toBe('Enterprise User Extension');
    });

    it('should include Enterprise User attributes: employeeNumber, department, manager, etc.', () => {
      const result = service.getSchemas();
      const enterpriseSchema = result.Resources.find(
        (r: any) => r.id === SCIM_ENTERPRISE_USER_SCHEMA
      )! as any;
      const attrNames = enterpriseSchema.attributes.map((a: any) => a.name);
      expect(attrNames).toContain('employeeNumber');
      expect(attrNames).toContain('department');
      expect(attrNames).toContain('costCenter');
      expect(attrNames).toContain('organization');
      expect(attrNames).toContain('division');
      expect(attrNames).toContain('manager');
    });

    it('should include Core Group schema with correct id', () => {
      const result = service.getSchemas();
      const groupSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_GROUP_SCHEMA)!;
      expect(groupSchema).toBeDefined();
      expect(groupSchema.name).toBe('Group');
    });

    it('should have meta.resourceType on each schema definition', () => {
      const result = service.getSchemas();
      for (const schema of result.Resources) {
        expect((schema as any).meta).toBeDefined();
        expect((schema as any).meta.resourceType).toBe('Schema');
      }
    });

    it('should set startIndex=1 and itemsPerPage matching totalResults', () => {
      const result = service.getSchemas();
      expect(result.startIndex).toBe(1);
      expect(result.itemsPerPage).toBe(result.totalResults);
    });

    it('should include User schema attributes with name subAttributes', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const nameAttr = userSchema.attributes.find((a: any) => a.name === 'name');
      expect(nameAttr).toBeDefined();
      expect(nameAttr!.type).toBe('complex');
      expect(nameAttr!.subAttributes).toBeDefined();
      const subNames = nameAttr!.subAttributes.map((s: any) => s.name);
      expect(subNames).toContain('givenName');
      expect(subNames).toContain('familyName');
      expect(subNames).toContain('formatted');
    });

    it('should include User schema userName attribute with uniqueness=server', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const userName = userSchema.attributes.find((a: any) => a.name === 'userName');
      expect(userName!.required).toBe(true);
      expect(userName!.uniqueness).toBe('server');
      expect(userName!.mutability).toBe('readWrite');
      expect(userName!.returned).toBe('always');
    });
  });

  // ─── getResourceTypes ───────────────────────────────────────────────────

  describe('getResourceTypes', () => {
    it('should return a ListResponse with 2 resource types', () => {
      const result = service.getResourceTypes();
      expect(result.schemas).toEqual([SCIM_LIST_RESPONSE_SCHEMA]);
      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
    });

    it('should include User resource type with Enterprise extension', () => {
      const result = service.getResourceTypes();
      const user = result.Resources.find((r: any) => r.id === 'User')! as any;
      expect(user).toBeDefined();
      expect(user.endpoint).toBe('/Users');
      expect(user.schema).toBe(SCIM_CORE_USER_SCHEMA);
      expect(user.schemaExtensions).toHaveLength(1);
      expect(user.schemaExtensions[0].schema).toBe(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(user.schemaExtensions[0].required).toBe(false);
    });

    it('should include Group resource type with no extensions', () => {
      const result = service.getResourceTypes();
      const group = result.Resources.find((r: any) => r.id === 'Group')! as any;
      expect(group).toBeDefined();
      expect(group.endpoint).toBe('/Groups');
      expect(group.schema).toBe(SCIM_CORE_GROUP_SCHEMA);
      expect(group.schemaExtensions).toHaveLength(0);
    });

    it('should have meta.resourceType on each resource type', () => {
      const result = service.getResourceTypes();
      for (const rt of result.Resources) {
        expect((rt as any).meta).toBeDefined();
        expect((rt as any).meta.resourceType).toBe('ResourceType');
      }
    });
  });

  // ─── getServiceProviderConfig ───────────────────────────────────────────

  describe('getServiceProviderConfig', () => {
    it('should return config with correct schema URI', () => {
      const result = service.getServiceProviderConfig();
      expect(result.schemas).toEqual([SCIM_SP_CONFIG_SCHEMA]);
    });

    it('should advertise patch as supported', () => {
      const result = service.getServiceProviderConfig();
      expect(result.patch.supported).toBe(true);
    });

    it('should advertise filter as supported with maxResults', () => {
      const result = service.getServiceProviderConfig();
      expect(result.filter.supported).toBe(true);
      expect(result.filter.maxResults).toBe(200);
    });

    it('should advertise etag as supported', () => {
      const result = service.getServiceProviderConfig();
      expect(result.etag.supported).toBe(true);
    });

    it('should advertise bulk as not supported with maxOperations=0', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(false);
      expect(result.bulk.maxOperations).toBe(0);
      expect(result.bulk.maxPayloadSize).toBe(0);
    });

    it('should include meta.resourceType (RFC 7644 §4 SHOULD)', () => {
      const result = service.getServiceProviderConfig();
      expect(result.meta).toBeDefined();
      expect(result.meta.resourceType).toBe('ServiceProviderConfig');
    });

    it('should include documentationUri', () => {
      const result = service.getServiceProviderConfig();
      expect(result.documentationUri).toBeDefined();
      expect(typeof result.documentationUri).toBe('string');
    });

    it('should include OAuth bearer token authentication scheme', () => {
      const result = service.getServiceProviderConfig();
      expect(result.authenticationSchemes).toHaveLength(1);
      expect(result.authenticationSchemes[0].type).toBe('oauthbearertoken');
    });

    it('should return a new object each call (not shared reference)', () => {
      const result1 = service.getServiceProviderConfig();
      const result2 = service.getServiceProviderConfig();
      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });
  });

  // ─── buildResourceSchemas ──────────────────────────────────────────────

  describe('buildResourceSchemas', () => {
    it('should return only core schema when no extensions in payload', () => {
      const payload = { userName: 'test@example.com', displayName: 'Test' };
      const schemas = service.buildResourceSchemas(
        payload,
        SCIM_CORE_USER_SCHEMA,
        KNOWN_EXTENSION_URNS
      );
      expect(schemas).toEqual([SCIM_CORE_USER_SCHEMA]);
    });

    it('should include enterprise extension when present in payload', () => {
      const payload = {
        userName: 'test@example.com',
        [SCIM_ENTERPRISE_USER_SCHEMA]: { department: 'Engineering' },
      };
      const schemas = service.buildResourceSchemas(
        payload,
        SCIM_CORE_USER_SCHEMA,
        KNOWN_EXTENSION_URNS
      );
      expect(schemas).toEqual([SCIM_CORE_USER_SCHEMA, SCIM_ENTERPRISE_USER_SCHEMA]);
    });

    it('should handle undefined payload gracefully', () => {
      const schemas = service.buildResourceSchemas(
        undefined,
        SCIM_CORE_USER_SCHEMA,
        KNOWN_EXTENSION_URNS
      );
      expect(schemas).toEqual([SCIM_CORE_USER_SCHEMA]);
    });

    it('should handle empty payload', () => {
      const schemas = service.buildResourceSchemas(
        {},
        SCIM_CORE_USER_SCHEMA,
        KNOWN_EXTENSION_URNS
      );
      expect(schemas).toEqual([SCIM_CORE_USER_SCHEMA]);
    });

    it('should handle multiple extension URNs', () => {
      const customUrns = [
        SCIM_ENTERPRISE_USER_SCHEMA,
        'urn:custom:extension',
      ];
      const payload = {
        userName: 'test',
        [SCIM_ENTERPRISE_USER_SCHEMA]: { department: 'Eng' },
        'urn:custom:extension': { custom: true },
      };
      const schemas = service.buildResourceSchemas(
        payload,
        SCIM_CORE_USER_SCHEMA,
        customUrns
      );
      expect(schemas).toEqual([
        SCIM_CORE_USER_SCHEMA,
        SCIM_ENTERPRISE_USER_SCHEMA,
        'urn:custom:extension',
      ]);
    });

    it('should not duplicate core schema', () => {
      const payload = { userName: 'test' };
      const schemas = service.buildResourceSchemas(
        payload,
        SCIM_CORE_USER_SCHEMA,
        KNOWN_EXTENSION_URNS
      );
      const coreCount = schemas.filter((s) => s === SCIM_CORE_USER_SCHEMA).length;
      expect(coreCount).toBe(1);
    });

    it('should work with Group schema and no extensions', () => {
      const payload = { displayName: 'TestGroup' };
      const schemas = service.buildResourceSchemas(payload, SCIM_CORE_GROUP_SCHEMA, []);
      expect(schemas).toEqual([SCIM_CORE_GROUP_SCHEMA]);
    });

    it('should only include extension URNs that are keys in payload', () => {
      const payload = {
        userName: 'test',
        [SCIM_ENTERPRISE_USER_SCHEMA]: { department: 'Eng' },
      };
      const urns = [SCIM_ENTERPRISE_USER_SCHEMA, 'urn:not:present'];
      const schemas = service.buildResourceSchemas(payload, SCIM_CORE_USER_SCHEMA, urns);
      expect(schemas).toContain(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(schemas).not.toContain('urn:not:present');
    });
  });
});
