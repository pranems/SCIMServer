import { HttpException } from '@nestjs/common';
import { ScimDiscoveryService } from './scim-discovery.service';
import { ScimSchemaRegistry } from './scim-schema-registry';
import { ScimLogger } from '../../logging/scim-logger.service';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_SP_CONFIG_SCHEMA,
  KNOWN_EXTENSION_URNS,
} from '../common/scim-constants';

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

describe('ScimDiscoveryService', () => {
  let service: ScimDiscoveryService;
  let registry: ScimSchemaRegistry;

  beforeEach(async () => {
    registry = new ScimSchemaRegistry(mockScimLogger);
    await registry.onModuleInit();
    service = new ScimDiscoveryService(registry);
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

    // ─── P1: R-SUB-1 - caseExact:false on name sub-attributes ────────────

    it('should have caseExact:false on all name sub-attributes (R-SUB-1, RFC 7643 §4.1.1)', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const nameAttr = userSchema.attributes.find((a: any) => a.name === 'name');
      const expectedSubs = ['formatted', 'familyName', 'givenName', 'middleName', 'honorificPrefix', 'honorificSuffix'];
      for (const subName of expectedSubs) {
        const sub = nameAttr.subAttributes.find((s: any) => s.name === subName);
        expect(sub).toBeDefined();
        expect(sub.caseExact).toBe(false);
      }
    });

    // ─── P1: R-SUB-3 - caseExact:false on addresses sub-attributes ───────

    it('should have caseExact:false on all addresses sub-attributes (R-SUB-3, RFC 7643 §4.1.2)', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const addrAttr = userSchema.attributes.find((a: any) => a.name === 'addresses');
      const expectedSubs = ['formatted', 'streetAddress', 'locality', 'region', 'postalCode', 'country'];
      for (const subName of expectedSubs) {
        const sub = addrAttr.subAttributes.find((s: any) => s.name === subName);
        expect(sub).toBeDefined();
        expect(sub.caseExact).toBe(false);
      }
    });

    // ─── P1: R-UNIQ-1 - uniqueness on externalId attributes ──────────────

    it('should have uniqueness:none on User externalId (R-UNIQ-1, RFC 7643 §3.1)', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const extId = userSchema.attributes.find((a: any) => a.name === 'externalId');
      expect(extId).toBeDefined();
      expect(extId.uniqueness).toBe('none');
    });

    it('should include User schema userName attribute with uniqueness=server', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const userName = userSchema.attributes.find((a: any) => a.name === 'userName');
      expect(userName!.required).toBe(true);
      expect(userName!.uniqueness).toBe('server');
      expect(userName!.mutability).toBe('readWrite');
      expect(userName!.returned).toBe('default'); // RFC 7643 §8.7.1
    });

    // ─── RFC 7643 §3.1 Common Attributes ────────────────────────────────

    it('should include "id" common attribute in User schema (RFC 7643 §3.1)', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const idAttr = userSchema.attributes.find((a: any) => a.name === 'id');
      expect(idAttr).toBeDefined();
      expect(idAttr.type).toBe('string');
      expect(idAttr.mutability).toBe('readOnly');
      expect(idAttr.returned).toBe('always');
      expect(idAttr.caseExact).toBe(true);
      expect(idAttr.uniqueness).toBe('server');
    });

    it('should include "meta" common attribute in User schema (RFC 7643 §3.1)', () => {
      const result = service.getSchemas();
      const userSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_USER_SCHEMA)! as any;
      const metaAttr = userSchema.attributes.find((a: any) => a.name === 'meta');
      expect(metaAttr).toBeDefined();
      expect(metaAttr.type).toBe('complex');
      expect(metaAttr.mutability).toBe('readOnly');
      expect(metaAttr.subAttributes).toBeDefined();
      const subNames = metaAttr.subAttributes.map((s: any) => s.name);
      expect(subNames).toContain('resourceType');
      expect(subNames).toContain('created');
      expect(subNames).toContain('lastModified');
      expect(subNames).toContain('location');
      expect(subNames).toContain('version');
    });

    it('should include "id" common attribute in Group schema (RFC 7643 §3.1)', () => {
      const result = service.getSchemas();
      const groupSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_GROUP_SCHEMA)! as any;
      const idAttr = groupSchema.attributes.find((a: any) => a.name === 'id');
      expect(idAttr).toBeDefined();
      expect(idAttr.type).toBe('string');
      expect(idAttr.mutability).toBe('readOnly');
      expect(idAttr.returned).toBe('always');
      expect(idAttr.caseExact).toBe(true);
      expect(idAttr.uniqueness).toBe('server');
    });

    it('should include "meta" common attribute in Group schema (RFC 7643 §3.1)', () => {
      const result = service.getSchemas();
      const groupSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_GROUP_SCHEMA)! as any;
      const metaAttr = groupSchema.attributes.find((a: any) => a.name === 'meta');
      expect(metaAttr).toBeDefined();
      expect(metaAttr.type).toBe('complex');
      expect(metaAttr.mutability).toBe('readOnly');
      expect(metaAttr.subAttributes).toBeDefined();
      const subNames = metaAttr.subAttributes.map((s: any) => s.name);
      expect(subNames).toContain('resourceType');
      expect(subNames).toContain('created');
      expect(subNames).toContain('lastModified');
      expect(subNames).toContain('location');
      expect(subNames).toContain('version');
    });

    // ─── P1: R-REF-1 - $ref sub-attribute on Group members ───────────────

    it('should include $ref sub-attribute on Group members with referenceTypes (R-REF-1, RFC 7643 §4.2)', () => {
      const result = service.getSchemas();
      const groupSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_GROUP_SCHEMA)! as any;
      const membersAttr = groupSchema.attributes.find((a: any) => a.name === 'members');
      expect(membersAttr).toBeDefined();
      const refSub = membersAttr.subAttributes.find((s: any) => s.name === '$ref');
      expect(refSub).toBeDefined();
      expect(refSub.type).toBe('reference');
      expect(refSub.mutability).toBe('immutable');
      expect(refSub.referenceTypes).toEqual(['User', 'Group']);
    });

    it('should have 4 sub-attributes on Group members: value, $ref, display, type (R-REF-1)', () => {
      const result = service.getSchemas();
      const groupSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_GROUP_SCHEMA)! as any;
      const membersAttr = groupSchema.attributes.find((a: any) => a.name === 'members');
      const subNames = membersAttr.subAttributes.map((s: any) => s.name);
      expect(subNames).toEqual(['value', '$ref', 'display', 'type']);
    });

    // ─── P1: R-UNIQ-1 - uniqueness on Group attributes ───────────────────

    it('should have uniqueness:none on Group displayName (RFC 7643 §8.7.1 baseline)', () => {
      const result = service.getSchemas();
      const groupSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_GROUP_SCHEMA)! as any;
      const displayName = groupSchema.attributes.find((a: any) => a.name === 'displayName');
      expect(displayName).toBeDefined();
      expect(displayName.uniqueness).toBe('none'); // RFC 7643 §8.7.1 - presets may tighten to 'server'
    });

    it('should have uniqueness:none on Group externalId (R-UNIQ-1, RFC 7643 §3.1)', () => {
      const result = service.getSchemas();
      const groupSchema = result.Resources.find((r: any) => r.id === SCIM_CORE_GROUP_SCHEMA)! as any;
      const extId = groupSchema.attributes.find((a: any) => a.name === 'externalId');
      expect(extId).toBeDefined();
      expect(extId.uniqueness).toBe('none');
    });
  });

  // ─── getSchemaByUrn (D2: Individual Schema lookup) ─────────────────────

  describe('getSchemaByUrn', () => {
    it('should return User schema by URN', () => {
      const result = service.getSchemaByUrn(SCIM_CORE_USER_SCHEMA);
      expect(result).toBeDefined();
      expect(result.id).toBe(SCIM_CORE_USER_SCHEMA);
      expect(result.name).toBe('User');
    });

    it('should return Enterprise User schema by URN', () => {
      const result = service.getSchemaByUrn(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(result).toBeDefined();
      expect(result.name).toBe('EnterpriseUser');
    });

    it('should return Group schema by URN', () => {
      const result = service.getSchemaByUrn(SCIM_CORE_GROUP_SCHEMA);
      expect(result).toBeDefined();
      expect(result.name).toBe('Group');
    });

    it('should throw 404 HttpException for unknown URN', () => {
      expect(() => service.getSchemaByUrn('urn:unknown:schema')).toThrow(HttpException);
      try {
        service.getSchemaByUrn('urn:unknown:schema');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
        const body = (e as HttpException).getResponse() as any;
        expect(body.detail).toContain('urn:unknown:schema');
        expect(body.status).toBe('404');
      }
    });

    it('should include schemas[] on returned schema (D4)', () => {
      const result = service.getSchemaByUrn(SCIM_CORE_USER_SCHEMA) as any;
      expect(result.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:Schema']);
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
      expect(user.schemaExtensions).toHaveLength(1); // EnterpriseUser
      expect(user.schemaExtensions[0].schema).toBe(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(user.schemaExtensions[0].required).toBe(false);
    });

    it('should include Group resource type with msfttest extensions', () => {
      const result = service.getResourceTypes();
      const group = result.Resources.find((r: any) => r.id === 'Group')! as any;
      expect(group).toBeDefined();
      expect(group.endpoint).toBe('/Groups');
      expect(group.schema).toBe(SCIM_CORE_GROUP_SCHEMA);
      expect(group.schemaExtensions).toHaveLength(0); // no extensions
    });

    it('should have meta.resourceType on each resource type', () => {
      const result = service.getResourceTypes();
      for (const rt of result.Resources) {
        expect((rt as any).meta).toBeDefined();
        expect((rt as any).meta.resourceType).toBe('ResourceType');
      }
    });
  });

  // ─── getResourceTypeById (D3: Individual ResourceType lookup) ──────────

  describe('getResourceTypeById', () => {
    it('should return User resource type by id', () => {
      const result = service.getResourceTypeById('User');
      expect(result).toBeDefined();
      expect(result.id).toBe('User');
      expect(result.name).toBe('User');
      expect(result.endpoint).toBe('/Users');
    });

    it('should return Group resource type by id', () => {
      const result = service.getResourceTypeById('Group');
      expect(result).toBeDefined();
      expect(result.id).toBe('Group');
      expect(result.name).toBe('Group');
    });

    it('should throw 404 HttpException for unknown id', () => {
      expect(() => service.getResourceTypeById('Unknown')).toThrow(HttpException);
      try {
        service.getResourceTypeById('Unknown');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
        const body = (e as HttpException).getResponse() as any;
        expect(body.detail).toContain('Unknown');
        expect(body.status).toBe('404');
      }
    });

    it('should include schemas[] on returned resource type (D5)', () => {
      const result = service.getResourceTypeById('User') as any;
      expect(result.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:ResourceType']);
    });

    it('should include schema extensions on User resource type', () => {
      const result = service.getResourceTypeById('User');
      expect(result.schemaExtensions).toHaveLength(1);
      expect(result.schemaExtensions[0].schema).toBe(SCIM_ENTERPRISE_USER_SCHEMA);
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

    it('should advertise bulk as supported with maxOperations=1000', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(true);
      expect(result.bulk.maxOperations).toBe(1000);
      expect(result.bulk.maxPayloadSize).toBe(1048576);
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

    it('should include primary:true on authentication scheme (D6 - RFC 7643 §5)', () => {
      const result = service.getServiceProviderConfig();
      expect(result.authenticationSchemes[0].primary).toBe(true);
    });

    it('should return a new object each call (not shared reference)', () => {
      const result1 = service.getServiceProviderConfig();
      const result2 = service.getServiceProviderConfig();
      expect(result1).toBe(result2);
      expect(result1).toEqual(result2);
    });

    // ─── Dynamic SPC per-endpoint config ────────────────────────────────

    it('should return bulk.supported=true when no config is provided', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(true);
    });

    it('should return bulk.supported=true when config has BulkOperationsEnabled=true', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(true);
    });

    it('should return bulk.supported=false when config has BulkOperationsEnabled=false', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(true);
    });

    it('should return bulk.supported=true when config has BulkOperationsEnabled="True" (string)', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(true);
    });

    it('should return bulk.supported=false when config has BulkOperationsEnabled="False" (string)', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(true);
    });

    it('should return bulk.supported=true when config is empty (flag not set)', () => {
      const result = service.getServiceProviderConfig();
      expect(result.bulk.supported).toBe(true);
    });

    it('should not mutate other SPC fields when config adjusts bulk', () => {
      const result = service.getServiceProviderConfig();
      expect(result.patch.supported).toBe(true);
      expect(result.filter.supported).toBe(true);
      expect(result.etag.supported).toBe(true);
      expect(result.bulk.maxOperations).toBe(1000);
      expect(result.bulk.maxPayloadSize).toBe(1048576);
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

  // ─── Root-level discovery (Phase 14.4 - no endpointId) ─────────────

  describe('Root-level discovery', () => {
    it('getSchemas returns root-level defaults', () => {
      const result = service.getSchemas();
      expect(result.schemas).toBeDefined();
      expect(result.Resources.length).toBeGreaterThanOrEqual(0);
    });

    it('getResourceTypes returns root-level defaults', () => {
      const result = service.getResourceTypes();
      expect(result.schemas).toBeDefined();
    });

    it('getServiceProviderConfig returns defaults', () => {
      const result = service.getServiceProviderConfig();
      expect(result).toBeDefined();
      expect(result.patch).toBeDefined();
    });
  });

  // ─── Profile-based discovery (Phase 14.2) ─────────────────────────

  describe('Profile-based discovery', () => {
    const mockProfile = {
      schemas: [
        { id: 'urn:test:core', name: 'Test', description: 'Test', attributes: [] },
      ],
      resourceTypes: [
        { id: 'Test', name: 'Test', endpoint: '/Tests', description: 'Test', schema: 'urn:test:core', schemaExtensions: [] },
      ],
      serviceProviderConfig: {
        patch: { supported: true },
        bulk: { supported: false },
        filter: { supported: true, maxResults: 50 },
        sort: { supported: false },
        etag: { supported: false },
        changePassword: { supported: false },
      },
      settings: {},
    } as any;

    it('getSchemasFromProfile returns profile schemas', () => {
      const result = service.getSchemasFromProfile(mockProfile);
      expect(result.totalResults).toBe(1);
      expect(result.Resources[0].id).toBe('urn:test:core');
    });

    it('getSchemaByUrnFromProfile finds schema by URN', () => {
      const schema = service.getSchemaByUrnFromProfile('urn:test:core', mockProfile);
      expect(schema.name).toBe('Test');
    });

    it('getSchemaByUrnFromProfile throws 404 for unknown URN', () => {
      expect(() => service.getSchemaByUrnFromProfile('urn:unknown', mockProfile)).toThrow();
    });

    it('getResourceTypesFromProfile returns profile resource types', () => {
      const result = service.getResourceTypesFromProfile(mockProfile);
      expect(result.totalResults).toBe(1);
    });

    it('getSpcFromProfile returns profile SPC', () => {
      const spc = service.getSpcFromProfile(mockProfile);
      expect(spc.bulk.supported).toBe(false);
      expect(spc.sort.supported).toBe(false);
    });
  });
});
