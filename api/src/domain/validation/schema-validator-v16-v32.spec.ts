/**
 * Phase 8 Next - V32 (Filter attribute validation),
 *                G8e (collectReturnedCharacteristics)
 *
 * Tests for:
 *  - SchemaValidator.validateFilterAttributePaths()      (V32)
 *  - SchemaValidator.collectReturnedCharacteristics()    (G8e)
 */

import { SchemaValidator } from './schema-validator';
import type { SchemaDefinition, SchemaAttributeDefinition } from './validation-types';

// ─── Test Schema Definitions ──────────────────────────────────────────────────

const USER_SCHEMA: SchemaDefinition = {
  id: 'urn:ietf:params:scim:schemas:core:2.0:User',
  attributes: [
    { name: 'userName', type: 'string', multiValued: false, required: true },
    { name: 'active', type: 'boolean', multiValued: false, required: false },
    { name: 'displayName', type: 'string', multiValued: false, required: false },
    {
      name: 'name',
      type: 'complex',
      multiValued: false,
      required: false,
      subAttributes: [
        { name: 'givenName', type: 'string', multiValued: false, required: false },
        { name: 'familyName', type: 'string', multiValued: false, required: false },
      ],
    },
    {
      name: 'emails',
      type: 'complex',
      multiValued: true,
      required: false,
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: true },
        { name: 'type', type: 'string', multiValued: false, required: false },
        { name: 'primary', type: 'boolean', multiValued: false, required: false },
      ],
    },
    {
      name: 'phoneNumbers',
      type: 'complex',
      multiValued: true,
      required: false,
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false },
        { name: 'primary', type: 'boolean', multiValued: false, required: false },
      ],
    },
    {
      name: 'roles',
      type: 'complex',
      multiValued: true,
      required: false,
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false },
        { name: 'display', type: 'string', multiValued: false, required: false },
        { name: 'primary', type: 'boolean', multiValued: false, required: false },
      ],
    },
  ] as SchemaAttributeDefinition[],
};

const ENTERPRISE_SCHEMA: SchemaDefinition = {
  id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  attributes: [
    { name: 'department', type: 'string', multiValued: false, required: false },
    { name: 'employeeNumber', type: 'string', multiValued: false, required: false },
    { name: 'isContractor', type: 'boolean', multiValued: false, required: false },
    {
      name: 'manager',
      type: 'complex',
      multiValued: false,
      required: false,
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false },
        { name: 'displayName', type: 'string', multiValued: false, required: false },
      ],
    },
  ] as SchemaAttributeDefinition[],
};

const GROUP_SCHEMA: SchemaDefinition = {
  id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  attributes: [
    { name: 'displayName', type: 'string', multiValued: false, required: true },
    {
      name: 'members',
      type: 'complex',
      multiValued: true,
      required: false,
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false },
        { name: 'display', type: 'string', multiValued: false, required: false },
        { name: 'type', type: 'string', multiValued: false, required: false },
      ],
    },
  ] as SchemaAttributeDefinition[],
};

// ─── V32: validateFilterAttributePaths ────────────────────────────────────────

describe('SchemaValidator.validateFilterAttributePaths (V32)', () => {
  const schemas = [USER_SCHEMA, ENTERPRISE_SCHEMA];

  it('should accept known core attribute paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['userName', 'active', 'displayName'],
      schemas,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept dotted sub-attribute paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['name.givenName', 'name.familyName'],
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject unknown top-level attributes', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['favoriteColor'],
      schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('favoriteColor');
    expect(result.errors[0].scimType).toBe('invalidFilter');
  });

  it('should reject unknown sub-attribute paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['name.middleName'],
      schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('name.middleName');
  });

  it('should accept reserved paths (id, externalId)', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['id', 'externalId'],
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should accept meta sub-attribute paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['meta.created', 'meta.lastModified', 'meta.resourceType'],
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject unknown meta sub-attribute paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['meta.unknownField'],
      schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].scimType).toBe('invalidFilter');
  });

  it('should accept extension URN attribute paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.department'],
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject unknown extension attribute paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.salary'],
      schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('not defined in extension schema');
  });

  it('should handle mix of valid and invalid paths', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['userName', 'unknownAttr1', 'active', 'unknownAttr2'],
      schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].path).toBe('unknownAttr1');
    expect(result.errors[1].path).toBe('unknownAttr2');
  });

  it('should accept empty path list', () => {
    const result = SchemaValidator.validateFilterAttributePaths([], schemas);
    expect(result.valid).toBe(true);
  });

  it('should validate against Group schema', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['displayName'],
      [GROUP_SCHEMA],
    );
    expect(result.valid).toBe(true);
  });

  it('should reject User-only attrs against Group schema', () => {
    const result = SchemaValidator.validateFilterAttributePaths(
      ['userName'],
      [GROUP_SCHEMA],
    );
    expect(result.valid).toBe(false);
  });
});

// ─── G8e: collectReturnedCharacteristics ──────────────────────────────────────

describe('SchemaValidator.collectReturnedCharacteristics (G8e)', () => {
  it('should collect returned:never attributes', () => {
    const schemaWithNever: SchemaDefinition = {
      id: 'urn:test:never',
      attributes: [
        { name: 'password', type: 'string', multiValued: false, required: false, returned: 'never' },
        { name: 'userName', type: 'string', multiValued: false, required: true, returned: 'always' },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([schemaWithNever]);
    expect(result.never.has('password')).toBe(true);
    expect(result.never.size).toBe(1);
    expect(result.request.size).toBe(0);
  });

  it('should collect returned:request attributes', () => {
    const schemaWithRequest: SchemaDefinition = {
      id: 'urn:test:request',
      attributes: [
        { name: 'secretKey', type: 'string', multiValued: false, required: false, returned: 'request' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, returned: 'default' },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([schemaWithRequest]);
    expect(result.request.has('secretkey')).toBe(true);
    expect(result.request.size).toBe(1);
    expect(result.never.size).toBe(0);
  });

  it('should collect from multiple schemas', () => {
    const core: SchemaDefinition = {
      id: 'urn:core',
      attributes: [
        { name: 'password', type: 'string', multiValued: false, required: false, returned: 'never' },
        { name: 'active', type: 'boolean', multiValued: false, required: false, returned: 'default' },
      ] as SchemaAttributeDefinition[],
    };
    const ext: SchemaDefinition = {
      id: 'urn:ext',
      attributes: [
        { name: 'apiToken', type: 'string', multiValued: false, required: false, returned: 'never' },
        { name: 'costCenter', type: 'string', multiValued: false, required: false, returned: 'request' },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([core, ext]);
    expect(result.never.has('password')).toBe(true);
    expect(result.never.has('apitoken')).toBe(true);
    expect(result.never.size).toBe(2);
    expect(result.request.has('costcenter')).toBe(true);
    expect(result.request.size).toBe(1);
  });

  it('should collect returned characteristics from sub-attributes', () => {
    const schema: SchemaDefinition = {
      id: 'urn:sub',
      attributes: [
        {
          name: 'emails',
          type: 'complex',
          multiValued: true,
          required: false,
          returned: 'default',
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false, returned: 'default' },
            { name: 'secret', type: 'string', multiValued: false, required: false, returned: 'never' },
          ],
        },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([schema]);
    expect(result.never.has('secret')).toBe(true);
    expect(result.never.size).toBe(1);
  });

  it('should return lowercase attribute names', () => {
    const schema: SchemaDefinition = {
      id: 'urn:case',
      attributes: [
        { name: 'Password', type: 'string', multiValued: false, required: false, returned: 'never' },
        { name: 'SecretKey', type: 'string', multiValued: false, required: false, returned: 'request' },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([schema]);
    expect(result.never.has('password')).toBe(true);
    expect(result.request.has('secretkey')).toBe(true);
  });

  it('should ignore always and default attributes', () => {
    const schema: SchemaDefinition = {
      id: 'urn:ignore',
      attributes: [
        { name: 'id', type: 'string', multiValued: false, required: true, returned: 'always' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, returned: 'default' },
        { name: 'userName', type: 'string', multiValued: false, required: true },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([schema]);
    expect(result.never.size).toBe(0);
    expect(result.request.size).toBe(0);
  });

  it('should handle empty schema list', () => {
    const result = SchemaValidator.collectReturnedCharacteristics([]);
    expect(result.never.size).toBe(0);
    expect(result.request.size).toBe(0);
  });

  it('should handle attributes without returned property', () => {
    const schema: SchemaDefinition = {
      id: 'urn:noreturned',
      attributes: [
        { name: 'displayName', type: 'string', multiValued: false, required: false },
        { name: 'active', type: 'boolean', multiValued: false, required: false },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([schema]);
    expect(result.never.size).toBe(0);
    expect(result.request.size).toBe(0);
  });

  it('should be case-insensitive on returned value', () => {
    const schema: SchemaDefinition = {
      id: 'urn:casevalue',
      attributes: [
        { name: 'field1', type: 'string', multiValued: false, required: false, returned: 'Never' },
        { name: 'field2', type: 'string', multiValued: false, required: false, returned: 'REQUEST' },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([schema]);
    expect(result.never.has('field1')).toBe(true);
    expect(result.request.has('field2')).toBe(true);
  });

  it('should collect from real User schema with password defined as never', () => {
    const userWithPassword: SchemaDefinition = {
      ...USER_SCHEMA,
      attributes: [
        ...USER_SCHEMA.attributes,
        { name: 'password', type: 'string', multiValued: false, required: false, returned: 'never', mutability: 'writeOnly' } as SchemaAttributeDefinition,
      ],
    };
    const result = SchemaValidator.collectReturnedCharacteristics([userWithPassword]);
    expect(result.never.has('password')).toBe(true);
  });
});
