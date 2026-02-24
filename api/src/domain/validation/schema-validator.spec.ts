import { SchemaValidator } from './schema-validator';
import type {
  SchemaAttributeDefinition,
  SchemaDefinition,
  ValidationOptions,
} from './validation-types';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const CORE_USER_SCHEMA_ID = 'urn:ietf:params:scim:schemas:core:2.0:User';
const EXTENSION_SCHEMA_ID = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

function makeAttr(overrides: Partial<SchemaAttributeDefinition> & { name: string }): SchemaAttributeDefinition {
  return {
    type: 'string',
    multiValued: false,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    ...overrides,
  };
}

function makeCoreSchema(attributes: SchemaAttributeDefinition[]): SchemaDefinition {
  return { id: CORE_USER_SCHEMA_ID, attributes };
}

function makeExtensionSchema(
  attributes: SchemaAttributeDefinition[],
  id = EXTENSION_SCHEMA_ID,
): SchemaDefinition {
  return { id, attributes };
}

const defaultOptions: ValidationOptions = { strictMode: false, mode: 'create' };
const strictOptions: ValidationOptions = { strictMode: true, mode: 'create' };
const replaceOptions: ValidationOptions = { strictMode: true, mode: 'replace' };
const patchOptions: ValidationOptions = { strictMode: true, mode: 'patch' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SchemaValidator', () => {
  // ── Basic Valid Payloads ───────────────────────────────────────────────

  describe('valid payloads', () => {
    it('should pass validation for a minimal valid payload', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'alice' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass validation when all required attributes are present', () => {
      const schema = makeCoreSchema([
        makeAttr({ name: 'userName', required: true }),
        makeAttr({ name: 'displayName', required: false }),
      ]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'bob', displayName: 'Bob' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should pass when optional attributes are omitted', () => {
      const schema = makeCoreSchema([
        makeAttr({ name: 'userName', required: true }),
        makeAttr({ name: 'nickName', required: false }),
      ]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'charlie' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should pass when null values are provided for optional attributes', () => {
      const schema = makeCoreSchema([
        makeAttr({ name: 'userName', required: true }),
        makeAttr({ name: 'nickName', required: false }),
      ]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'dave', nickName: null };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should skip reserved keys (schemas, id, externalId, meta)', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        id: 'some-id',
        externalId: 'ext-1',
        meta: { resourceType: 'User' },
        userName: 'eve',
      };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(true);
    });
  });

  // ── Required Attributes ───────────────────────────────────────────────

  describe('required attributes', () => {
    it('should report error when required attribute is missing on create', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID] };
      const result = SchemaValidator.validate(payload, [schema], { ...defaultOptions, mode: 'create' });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('userName');
      expect(result.errors[0].scimType).toBe('invalidValue');
    });

    it('should report error when required attribute is missing on replace', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID] };
      const result = SchemaValidator.validate(payload, [schema], replaceOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBe('userName');
    });

    it('should NOT report error for missing required attribute on patch', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID] };
      const result = SchemaValidator.validate(payload, [schema], patchOptions);
      expect(result.valid).toBe(true);
    });

    it('should report multiple missing required attributes', () => {
      const schema = makeCoreSchema([
        makeAttr({ name: 'userName', required: true }),
        makeAttr({ name: 'displayName', required: true }),
      ]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID] };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should find required attribute case-insensitively', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], USERNAME: 'alice' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });
  });

  // ── Type Checking ─────────────────────────────────────────────────────

  describe('type checking', () => {
    it('should reject non-string for string attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', type: 'string' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 123 };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('invalidValue');
    });

    it('should accept string for string attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', type: 'string' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'alice' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject non-boolean for boolean attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'active', type: 'boolean' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], active: 'true' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should accept boolean for boolean attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'active', type: 'boolean' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], active: true };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject non-integer for integer attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'count', type: 'integer' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], count: 3.14 };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should accept integer for integer attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'count', type: 'integer' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], count: 42 };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject non-number for decimal attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'score', type: 'decimal' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], score: 'high' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should accept number for decimal attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'score', type: 'decimal' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], score: 3.14 };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject non-string for reference attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'ref', type: 'reference' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], ref: 42 };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should accept string for reference attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'ref', type: 'reference' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], ref: 'https://example.com/Users/123' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject non-string for binary attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'photo', type: 'binary' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], photo: 123 };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should accept string for binary attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'photo', type: 'binary' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], photo: 'base64data==' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject non-string for dateTime attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'created', type: 'dateTime' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], created: 12345 };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid dateTime string', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'created', type: 'dateTime' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], created: 'not-a-date' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should accept valid ISO 8601 dateTime string', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'created', type: 'dateTime' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], created: '2025-01-15T10:30:00Z' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject non-object for complex attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'name', type: 'complex' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], name: 'text' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
    });

    it('should accept object for complex attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'name', type: 'complex' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], name: { givenName: 'Alice' } };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should skip validation for unknown types (forward-compatible)', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'custom', type: 'futureType' as string })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], custom: 'anything' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });
  });

  // ── Mutability ────────────────────────────────────────────────────────

  describe('mutability constraints', () => {
    it('should reject readOnly attribute on create', () => {
      const schema = makeCoreSchema([
        makeAttr({ name: 'userName', required: true }),
        makeAttr({ name: 'groups', mutability: 'readOnly' }),
      ]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'alice', groups: [] };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
    });

    it('should reject readOnly attribute on replace', () => {
      const schema = makeCoreSchema([
        makeAttr({ name: 'userName', required: true }),
        makeAttr({ name: 'groups', mutability: 'readOnly' }),
      ]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'alice', groups: [] };
      const result = SchemaValidator.validate(payload, [schema], replaceOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
    });

    it('should allow readWrite attribute on create', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'displayName', mutability: 'readWrite' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], displayName: 'Alice' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should allow writeOnly attribute on create', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'password', mutability: 'writeOnly' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], password: 'secret' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should allow immutable attribute on create', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'immutableField', mutability: 'immutable' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], immutableField: 'set-once' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });
  });

  // ── Multi-valued / Single-valued ──────────────────────────────────────

  describe('multi-valued enforcement', () => {
    it('should reject non-array for multi-valued attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'emails', type: 'complex', multiValued: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], emails: { value: 'a@b.com' } };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('multi-valued');
    });

    it('should accept array for multi-valued attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'emails', type: 'complex', multiValued: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], emails: [{ value: 'a@b.com' }] };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should accept empty array for multi-valued attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'emails', type: 'complex', multiValued: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], emails: [] };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject array for single-valued attribute', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'displayName', type: 'string', multiValued: false })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], displayName: ['Alice', 'Bob'] };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('single-valued');
    });

    it('should validate each element in a multi-valued array', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'tags', type: 'string', multiValued: true })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], tags: ['valid', 123, 'also-valid'] };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('tags[1]');
    });
  });

  // ── Strict Mode (Unknown Attributes) ─────────────────────────────────

  describe('strict mode - unknown attributes', () => {
    it('should ignore unknown attributes in non-strict mode', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'alice', unknownField: 'val' };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject unknown attributes in strict mode', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'alice', unknownField: 'val' };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBe('unknownField');
      expect(result.errors[0].scimType).toBe('invalidSyntax');
    });

    it('should report multiple unknown attributes in strict mode', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], userName: 'alice', foo: 1, bar: 2 };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should not flag reserved keys as unknown in strict mode', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        id: '123',
        externalId: 'ext',
        meta: {},
        userName: 'alice',
      };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(true);
    });
  });

  // ── Sub-Attributes (Complex Types) ────────────────────────────────────

  describe('sub-attribute validation', () => {
    const nameAttr = makeAttr({
      name: 'name',
      type: 'complex',
      subAttributes: [
        makeAttr({ name: 'givenName', type: 'string' }),
        makeAttr({ name: 'familyName', type: 'string' }),
        makeAttr({ name: 'formatted', type: 'string' }),
      ],
    });

    it('should validate sub-attributes of complex types', () => {
      const schema = makeCoreSchema([nameAttr]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        name: { givenName: 'Alice', familyName: 'Smith' },
      };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject wrong type in sub-attribute', () => {
      const schema = makeCoreSchema([nameAttr]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        name: { givenName: 42 },
      };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBe('name.givenName');
    });

    it('should reject unknown sub-attributes in strict mode', () => {
      const schema = makeCoreSchema([nameAttr]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        name: { givenName: 'Alice', unknownSub: 'val' },
      };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBe('name.unknownSub');
    });

    it('should allow unknown sub-attributes in non-strict mode', () => {
      const schema = makeCoreSchema([nameAttr]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        name: { givenName: 'Alice', unknownSub: 'val' },
      };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });
  });

  // ── Extension Schemas ─────────────────────────────────────────────────

  describe('extension schema validation', () => {
    it('should validate extension schema attributes under their URN key', () => {
      const coreSchema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const extSchema = makeExtensionSchema([
        makeAttr({ name: 'employeeNumber', type: 'string' }),
        makeAttr({ name: 'costCenter', type: 'string' }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID, EXTENSION_SCHEMA_ID],
        userName: 'alice',
        [EXTENSION_SCHEMA_ID]: {
          employeeNumber: 'EMP001',
          costCenter: 'CC100',
        },
      };
      const result = SchemaValidator.validate(payload, [coreSchema, extSchema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject wrong type in extension schema attribute', () => {
      const coreSchema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const extSchema = makeExtensionSchema([
        makeAttr({ name: 'employeeNumber', type: 'string' }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID, EXTENSION_SCHEMA_ID],
        userName: 'alice',
        [EXTENSION_SCHEMA_ID]: {
          employeeNumber: 42,
        },
      };
      const result = SchemaValidator.validate(payload, [coreSchema, extSchema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain('employeeNumber');
    });

    it('should report missing required extension attribute when extension block exists', () => {
      const coreSchema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const extSchema = makeExtensionSchema([
        makeAttr({ name: 'employeeNumber', type: 'string', required: true }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID, EXTENSION_SCHEMA_ID],
        userName: 'alice',
        [EXTENSION_SCHEMA_ID]: {
          costCenter: 'CC100',
        },
      };
      const result = SchemaValidator.validate(payload, [coreSchema, extSchema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain('employeeNumber');
    });

    it('should not report missing required extension attribute if extension block is absent', () => {
      const coreSchema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const extSchema = makeExtensionSchema([
        makeAttr({ name: 'employeeNumber', type: 'string', required: true }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        userName: 'alice',
      };
      const result = SchemaValidator.validate(payload, [coreSchema, extSchema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject unknown extension attributes in strict mode', () => {
      const coreSchema = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const extSchema = makeExtensionSchema([
        makeAttr({ name: 'employeeNumber', type: 'string' }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID, EXTENSION_SCHEMA_ID],
        userName: 'alice',
        [EXTENSION_SCHEMA_ID]: {
          employeeNumber: 'EMP001',
          unknownExtAttr: 'val',
        },
      };
      const result = SchemaValidator.validate(payload, [coreSchema, extSchema], strictOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain('unknownExtAttr');
    });
  });

  // ── Case-Insensitive Attribute Matching ───────────────────────────────

  describe('case-insensitive attribute matching', () => {
    it('should match attribute names case-insensitively', () => {
      const schema = makeCoreSchema([makeAttr({ name: 'userName', type: 'string' })]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], USERNAME: 'alice' };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(true);
    });

    it('should match sub-attribute names case-insensitively', () => {
      const schema = makeCoreSchema([
        makeAttr({
          name: 'name',
          type: 'complex',
          subAttributes: [makeAttr({ name: 'givenName', type: 'string' })],
        }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        name: { GIVENNAME: 'Alice' },
      };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(true);
    });
  });

  // ── Multi-valued Complex Elements ─────────────────────────────────────

  describe('multi-valued complex elements', () => {
    const emailsAttr = makeAttr({
      name: 'emails',
      type: 'complex',
      multiValued: true,
      subAttributes: [
        makeAttr({ name: 'value', type: 'string' }),
        makeAttr({ name: 'type', type: 'string' }),
        makeAttr({ name: 'primary', type: 'boolean' }),
      ],
    });

    it('should validate each element in a multi-valued complex array', () => {
      const schema = makeCoreSchema([emailsAttr]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        emails: [
          { value: 'a@b.com', type: 'work', primary: true },
          { value: 'c@d.com', type: 'home', primary: false },
        ],
      };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid sub-attribute type in multi-valued element', () => {
      const schema = makeCoreSchema([emailsAttr]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        emails: [
          { value: 'a@b.com', type: 'work', primary: 'yes' },
        ],
      };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBe('emails[0].primary');
    });
  });

  // ── Empty / Edge Cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should return valid for empty schemas list', () => {
      const payload = { schemas: [], userName: 'alice' };
      const result = SchemaValidator.validate(payload, [], defaultOptions);
      expect(result.valid).toBe(true);
    });

    it('should return valid for payload with only reserved keys', () => {
      const schema = makeCoreSchema([]);
      const payload = { schemas: [CORE_USER_SCHEMA_ID], id: '1', externalId: 'e1', meta: {} };
      const result = SchemaValidator.validate(payload, [schema], strictOptions);
      expect(result.valid).toBe(true);
    });

    it('should handle multiple schemas (core + extension) simultaneously', () => {
      const core = makeCoreSchema([
        makeAttr({ name: 'userName', type: 'string', required: true }),
      ]);
      const ext = makeExtensionSchema([
        makeAttr({ name: 'department', type: 'string' }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID, EXTENSION_SCHEMA_ID],
        userName: 'alice',
        [EXTENSION_SCHEMA_ID]: { department: 'Engineering' },
      };
      const result = SchemaValidator.validate(payload, [core, ext], strictOptions);
      expect(result.valid).toBe(true);
    });

    it('should handle extension URN in payload that has no matching schema definition', () => {
      const core = makeCoreSchema([makeAttr({ name: 'userName' })]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        userName: 'alice',
        'urn:unknown:extension': { foo: 'bar' },
      };
      // Unknown extension URNs are NOT flagged by SchemaValidator (handled by enforceStrictSchemaValidation)
      const result = SchemaValidator.validate(payload, [core], strictOptions);
      expect(result.valid).toBe(true);
    });

    it('should collect all errors without short-circuiting', () => {
      const schema = makeCoreSchema([
        makeAttr({ name: 'userName', type: 'string', required: true }),
        makeAttr({ name: 'active', type: 'boolean' }),
        makeAttr({ name: 'displayName', type: 'string' }),
      ]);
      const payload = {
        schemas: [CORE_USER_SCHEMA_ID],
        // userName is missing (required)
        active: 'not-a-bool',          // wrong type
        displayName: 123,              // wrong type
      };
      const result = SchemaValidator.validate(payload, [schema], defaultOptions);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
