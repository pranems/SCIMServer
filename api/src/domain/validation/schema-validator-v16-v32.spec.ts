/**
 * Phase 8 Next — V16 (Boolean sanitization) & V32 (Filter attribute validation)
 *
 * Tests for:
 *  - SchemaValidator.collectBooleanAttributeNames()  (V16)
 *  - SchemaValidator.validateFilterAttributePaths()   (V32)
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

// ─── V16: collectBooleanAttributeNames ────────────────────────────────────────

describe('SchemaValidator.collectBooleanAttributeNames (V16)', () => {
  it('should collect top-level boolean attributes', () => {
    const result = SchemaValidator.collectBooleanAttributeNames([USER_SCHEMA]);
    expect(result.has('active')).toBe(true);
  });

  it('should collect sub-attribute boolean attributes', () => {
    const result = SchemaValidator.collectBooleanAttributeNames([USER_SCHEMA]);
    expect(result.has('primary')).toBe(true);
  });

  it('should NOT include string attributes', () => {
    const result = SchemaValidator.collectBooleanAttributeNames([USER_SCHEMA]);
    expect(result.has('username')).toBe(false);
    expect(result.has('displayname')).toBe(false);
    expect(result.has('value')).toBe(false);
    expect(result.has('type')).toBe(false);
  });

  it('should collect boolean attributes from extension schemas', () => {
    const result = SchemaValidator.collectBooleanAttributeNames([USER_SCHEMA, ENTERPRISE_SCHEMA]);
    expect(result.has('iscontractor')).toBe(true);
  });

  it('should return lowercase attribute names', () => {
    const result = SchemaValidator.collectBooleanAttributeNames([USER_SCHEMA]);
    // All names should be lowercase
    for (const name of result) {
      expect(name).toBe(name.toLowerCase());
    }
  });

  it('should return empty set for schema with no booleans', () => {
    const result = SchemaValidator.collectBooleanAttributeNames([GROUP_SCHEMA]);
    expect(result.size).toBe(0);
  });

  it('should handle multiple schemas and deduplicate names', () => {
    // Both User and Enterprise schemas have boolean attributes
    const result = SchemaValidator.collectBooleanAttributeNames([USER_SCHEMA, ENTERPRISE_SCHEMA]);
    // "active" from User, "primary" from User sub-attrs, "iscontractor" from Enterprise
    expect(result.has('active')).toBe(true);
    expect(result.has('primary')).toBe(true);
    expect(result.has('iscontractor')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('should handle empty schema list', () => {
    const result = SchemaValidator.collectBooleanAttributeNames([]);
    expect(result.size).toBe(0);
  });

  it('should not collect complex or integer types as boolean', () => {
    const schemaWithTypes: SchemaDefinition = {
      id: 'urn:test',
      attributes: [
        { name: 'count', type: 'integer', multiValued: false, required: false },
        { name: 'ratio', type: 'decimal', multiValued: false, required: false },
        { name: 'nested', type: 'complex', multiValued: false, required: false,
          subAttributes: [
            { name: 'flag', type: 'boolean', multiValued: false, required: false },
          ] },
      ] as SchemaAttributeDefinition[],
    };
    const result = SchemaValidator.collectBooleanAttributeNames([schemaWithTypes]);
    expect(result.has('count')).toBe(false);
    expect(result.has('ratio')).toBe(false);
    expect(result.has('nested')).toBe(false);
    expect(result.has('flag')).toBe(true);
    expect(result.size).toBe(1);
  });
});

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
