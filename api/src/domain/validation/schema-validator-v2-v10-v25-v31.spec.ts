/**
 * Phase 8.1 / 8.6 Gap Tests — V2, V9, V10, V25, V31, G8c
 *
 * Tests for:
 *  V2  — PATCH pre-validation via validatePatchOperationValue()
 *  V9  — Required sub-attribute enforcement
 *  V10 — Canonical value enforcement
 *  V25 — schemas array validation
 *  V31 — Strict xsd:dateTime format
 *  G8c — readOnly mutability pre-validation in PATCH operations
 */

import { SchemaValidator } from './schema-validator';
import type {
  SchemaAttributeDefinition,
  SchemaDefinition,
  ValidationOptions,
} from './validation-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CORE_SCHEMA_ID = 'urn:ietf:params:scim:schemas:core:2.0:User';
const EXT_SCHEMA_ID = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

function makeAttr(
  overrides: Partial<SchemaAttributeDefinition> & { name: string },
): SchemaAttributeDefinition {
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
  return { id: CORE_SCHEMA_ID, attributes };
}

function makeExtSchema(attributes: SchemaAttributeDefinition[]): SchemaDefinition {
  return { id: EXT_SCHEMA_ID, attributes };
}

const createOpts: ValidationOptions = { strictMode: true, mode: 'create' };
const patchOpts: ValidationOptions = { strictMode: true, mode: 'patch' };

// ─── V2: PATCH pre-validation ─────────────────────────────────────────────────

describe('V2 — validatePatchOperationValue', () => {
  const schemas: SchemaDefinition[] = [
    makeCoreSchema([
      makeAttr({ name: 'userName', required: true }),
      makeAttr({ name: 'active', type: 'boolean' }),
      makeAttr({ name: 'displayName' }),
      makeAttr({
        name: 'name',
        type: 'complex',
        subAttributes: [
          makeAttr({ name: 'givenName' }),
          makeAttr({ name: 'familyName' }),
        ],
      }),
      makeAttr({
        name: 'emails',
        type: 'complex',
        multiValued: true,
        subAttributes: [
          makeAttr({ name: 'value' }),
          makeAttr({ name: 'type' }),
          makeAttr({ name: 'primary', type: 'boolean' }),
        ],
      }),
    ]),
    makeExtSchema([
      makeAttr({ name: 'department' }),
      makeAttr({ name: 'employeeNumber', type: 'integer' }),
    ]),
  ];

  it('should pass for valid simple string replace', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'displayName', 'Alice', schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type for boolean attribute', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'active', 'notBoolean', schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/boolean/i);
  });

  it('should pass for valid complex sub-attribute path', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'name.givenName', 'Bob', schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type for sub-attribute via dot path', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'name.givenName', 12345, schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/string/i);
  });

  it('should pass for no-path object with valid values', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', undefined, { displayName: 'Alice', active: true }, schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject no-path object with wrong type', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', undefined, { active: 'not-boolean' }, schemas,
    );
    expect(result.valid).toBe(false);
  });

  it('should skip validation for remove operations', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'remove', 'displayName', undefined, schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should handle value-filter paths like emails[type eq "work"].value', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'emails[type eq "work"].value', 'alice@work.com', schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject integer value on string sub-attribute via filter path', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'emails[type eq "work"].value', 12345, schemas,
    );
    expect(result.valid).toBe(false);
  });

  it('should validate extension attribute by URN prefix', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:department`,
      'Engineering',
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type for extension attribute', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:employeeNumber`,
      'not-a-number',
      schemas,
    );
    expect(result.valid).toBe(false);
  });

  it('should silently pass for unknown paths (no schema match)', () => {
    // Unknown paths are not schema-defined → no validation error
    // (strict mode is off in pre-PATCH validation by design)
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'unknownAttribute', 'value', schemas,
    );
    expect(result.valid).toBe(true);
  });
});

// ─── V9: Required sub-attributes ─────────────────────────────────────────────

describe('V9 — required sub-attribute enforcement', () => {
  const schema = makeCoreSchema([
    makeAttr({
      name: 'name',
      type: 'complex',
      subAttributes: [
        makeAttr({ name: 'familyName', required: true }),
        makeAttr({ name: 'givenName', required: false }),
      ],
    }),
  ]);

  it('should reject complex value missing required sub-attribute on create', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], name: { givenName: 'Alice' } };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'name.familyName' && e.message.includes('Required'))).toBe(true);
  });

  it('should pass when required sub-attribute is present', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], name: { familyName: 'Smith', givenName: 'Alice' } };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should skip required sub-attribute check in patch mode', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], name: { givenName: 'Alice' } };
    const result = SchemaValidator.validate(payload, [schema], patchOpts);
    expect(result.valid).toBe(true);
  });
});

// ─── V10: Canonical values ────────────────────────────────────────────────────

describe('V10 — canonical value enforcement', () => {
  const schema = makeCoreSchema([
    makeAttr({
      name: 'emails',
      type: 'complex',
      multiValued: true,
      subAttributes: [
        makeAttr({ name: 'value' }),
        makeAttr({
          name: 'type',
          canonicalValues: ['work', 'home', 'other'],
        }),
        makeAttr({ name: 'primary', type: 'boolean' }),
      ],
    }),
    makeAttr({
      name: 'locale',
      canonicalValues: ['en-US', 'en-GB', 'fr-FR', 'de-DE'],
    }),
  ]);

  it('should pass for a valid canonical value (case-insensitive)', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], locale: 'EN-US' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should reject a non-canonical value in strict mode', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], locale: 'xx-INVALID' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/canonical/i);
  });

  it('should reject non-canonical sub-attribute value in complex type', () => {
    const payload = {
      schemas: [CORE_SCHEMA_ID],
      emails: [{ value: 'a@b.com', type: 'personal' }],
    };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/canonical/i);
  });

  it('should pass for valid canonical sub-attribute value', () => {
    const payload = {
      schemas: [CORE_SCHEMA_ID],
      emails: [{ value: 'a@b.com', type: 'work' }],
    };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });
});

// ─── V25: schemas array validation ────────────────────────────────────────────

describe('V25 — schemas array validation', () => {
  const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);

  it('should reject non-string entries in schemas[]', () => {
    const payload = { schemas: [123], userName: 'alice' };
    const result = SchemaValidator.validate(payload as any, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'schemas' && e.message.includes('string'))).toBe(true);
  });

  it('should reject unknown schema URN in strict mode', () => {
    const payload = { schemas: [CORE_SCHEMA_ID, 'urn:unknown:schema'], userName: 'alice' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('not recognized'))).toBe(true);
  });

  it('should pass valid schemas array', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], userName: 'alice' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should reject schemas that is not an array', () => {
    const payload = { schemas: CORE_SCHEMA_ID, userName: 'alice' };
    const result = SchemaValidator.validate(payload as any, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'schemas' && e.message.includes('array'))).toBe(true);
  });
});

// ─── V31: dateTime strict validation ──────────────────────────────────────────

describe('V31 — strict xsd:dateTime format validation', () => {
  const schema = makeCoreSchema([
    makeAttr({ name: 'lastLogin', type: 'dateTime' }),
  ]);

  it('should pass valid ISO 8601 dateTime with Z', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-01-15T10:30:00Z' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should pass valid ISO 8601 dateTime with offset', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-01-15T10:30:00+05:30' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should pass valid dateTime with fractional seconds', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-01-15T10:30:00.123Z' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should reject date-only string (no time component)', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-01-15' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/xsd:dateTime/);
  });

  it('should reject dateTime without timezone', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-01-15T10:30:00' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/xsd:dateTime/);
  });

  it('should reject non-string dateTime', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: 1705312200 };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/dateTime string/);
  });

  it('should reject garbage string', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: 'not-a-date' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
  });
});

// ─── V2: Additional PATCH pre-validation edge cases ──────────────────────────

describe('V2 — validatePatchOperationValue — additional cases', () => {
  const schemas: SchemaDefinition[] = [
    makeCoreSchema([
      makeAttr({ name: 'userName', required: true }),
      makeAttr({ name: 'active', type: 'boolean' }),
      makeAttr({ name: 'displayName' }),
      makeAttr({
        name: 'emails',
        type: 'complex',
        multiValued: true,
        subAttributes: [
          makeAttr({ name: 'value' }),
          makeAttr({ name: 'type' }),
          makeAttr({ name: 'primary', type: 'boolean' }),
        ],
      }),
    ]),
    makeExtSchema([
      makeAttr({ name: 'department' }),
      makeAttr({ name: 'employeeNumber', type: 'integer' }),
    ]),
  ];

  it('should pass for add operation with valid value', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'add', 'displayName', 'NewName', schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type for add operation', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'add', 'active', 'yes', schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/boolean/i);
  });

  it('should pass for no-path add with extension URN block', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'add',
      undefined,
      {
        [EXT_SCHEMA_ID]: { department: 'Sales' },
      },
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type in extension URN block (no-path)', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'add',
      undefined,
      {
        [EXT_SCHEMA_ID]: { employeeNumber: 'not-a-number' },
      },
      schemas,
    );
    expect(result.valid).toBe(false);
  });

  it('should pass for multi-valued attribute with array value', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      'emails',
      [{ value: 'a@b.com', type: 'work', primary: true }],
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type in multi-valued attribute array element', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      'emails',
      [{ value: 'a@b.com', type: 'work', primary: 'yes' }],
      schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/boolean/i);
  });
});

// ─── V2: Manager PATCH string coercion (RFC 7644 §3.5.2.3 + Postel's Law) ────

describe('V2 — complex attribute string coercion in PATCH mode', () => {
  const schemasWithManager: SchemaDefinition[] = [
    makeCoreSchema([
      makeAttr({ name: 'userName', required: true }),
      makeAttr({ name: 'active', type: 'boolean' }),
      makeAttr({
        name: 'name',
        type: 'complex',
        subAttributes: [
          makeAttr({ name: 'givenName' }),
          makeAttr({ name: 'familyName' }),
        ],
      }),
    ]),
    makeExtSchema([
      makeAttr({ name: 'department' }),
      makeAttr({
        name: 'manager',
        type: 'complex',
        subAttributes: [
          makeAttr({ name: 'value', type: 'string' }),
          makeAttr({ name: '$ref', type: 'reference' }),
          makeAttr({ name: 'displayName', type: 'string', mutability: 'readOnly' }),
        ],
      }),
    ]),
  ];

  // ── Guard 1: empty-value removal signals ──

  it('should allow empty string for complex attr in patch mode (removal signal)', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:manager`,
      '',
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });

  it('should allow null for complex attr in patch mode (removal signal)', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:manager`,
      null,
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });

  it('should allow {value:""} for complex attr in patch mode (removal signal)', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:manager`,
      { value: '' },
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });

  it('should allow {value:null} for complex attr in patch mode (removal signal)', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:manager`,
      { value: null },
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });

  // ── Guard 2: raw string for complex attrs with value sub-attr ──

  it('should allow raw string for manager in patch mode (Entra ID compat)', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'add',
      `${EXT_SCHEMA_ID}:manager`,
      'a2c1f66c-8611-4bcd-852f-54dc340e3d97',
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });

  it('should allow raw string for manager replace in patch mode', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:manager`,
      'f7265ba9-fa36-4bbd-9ec8-1819396cc27d',
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });

  // ── Still accepts canonical form ──

  it('should still accept correct complex object in patch mode', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'add',
      `${EXT_SCHEMA_ID}:manager`,
      { value: 'MGR-UUID-123' },
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });

  it('should accept complex object with multiple sub-attrs in patch mode', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${EXT_SCHEMA_ID}:manager`,
      { value: 'MGR-UUID-123', displayName: 'Bob' },
      schemasWithManager,
    );
    // displayName is readOnly, but validatePatchOperationValue doesn't check
    // sub-attr mutability (it resolves to the parent 'manager' attr def).
    expect(result.valid).toBe(true);
  });

  // ── Safety: create mode still rejects strings ──

  it('should still reject raw string for complex attr in create mode', () => {
    const result = SchemaValidator.validate(
      {
        schemas: [CORE_SCHEMA_ID, EXT_SCHEMA_ID],
        userName: 'test@example.com',
        [EXT_SCHEMA_ID]: { manager: 'MGR-STRING' },
      },
      schemasWithManager,
      createOpts,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.match(/complex object/))).toBe(true);
  });

  // ── Safety: complex attr WITHOUT value sub-attr still rejects strings ──

  it('should still reject raw string for complex attr without value sub-attr', () => {
    const schemasNoValueSub: SchemaDefinition[] = [
      makeCoreSchema([
        makeAttr({
          name: 'customComplex',
          type: 'complex',
          subAttributes: [
            makeAttr({ name: 'code', type: 'string' }),
            makeAttr({ name: 'label', type: 'string' }),
          ],
        }),
      ]),
    ];
    const result = SchemaValidator.validatePatchOperationValue(
      'add',
      'customComplex',
      'raw-string-value',
      schemasNoValueSub,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/complex object/);
  });

  // ── remove op still works ──

  it('should allow remove op for manager (no value needed)', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'remove',
      `${EXT_SCHEMA_ID}:manager`,
      undefined,
      schemasWithManager,
    );
    expect(result.valid).toBe(true);
  });
});

// ─── V10: Canonical enforcement via validatePatchOperationValue ──────────────

describe('V10 — canonical via validatePatchOperationValue', () => {
  const schemas: SchemaDefinition[] = [
    makeCoreSchema([
      makeAttr({
        name: 'locale',
        canonicalValues: ['en-US', 'en-GB', 'fr-FR', 'de-DE'],
      }),
      makeAttr({
        name: 'emails',
        type: 'complex',
        multiValued: true,
        subAttributes: [
          makeAttr({ name: 'value' }),
          makeAttr({
            name: 'type',
            canonicalValues: ['work', 'home', 'other'],
          }),
        ],
      }),
    ]),
  ];

  it('should reject non-canonical value via PATCH pre-validation', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'locale', 'xx-INVALID', schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/canonical/i);
  });

  it('should accept canonical value via PATCH pre-validation', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace', 'locale', 'en-US', schemas,
    );
    expect(result.valid).toBe(true);
  });
});

// ─── V9: Required sub-attributes — multi-valued and extension ────────────────

describe('V9 — required sub-attributes in multi-valued and extension', () => {
  it('should reject multi-valued complex array element missing required sub-attr', () => {
    const schema = makeCoreSchema([
      makeAttr({
        name: 'addresses',
        type: 'complex',
        multiValued: true,
        subAttributes: [
          makeAttr({ name: 'streetAddress' }),
          makeAttr({ name: 'country', required: true }),
        ],
      }),
    ]);
    const payload = {
      schemas: [CORE_SCHEMA_ID],
      addresses: [{ streetAddress: '123 Main St' }],
    };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path?.includes('country') && e.message.includes('Required'))).toBe(true);
  });

  it('should pass multi-valued complex when required sub-attr present', () => {
    const schema = makeCoreSchema([
      makeAttr({
        name: 'addresses',
        type: 'complex',
        multiValued: true,
        subAttributes: [
          makeAttr({ name: 'streetAddress' }),
          makeAttr({ name: 'country', required: true }),
        ],
      }),
    ]);
    const payload = {
      schemas: [CORE_SCHEMA_ID],
      addresses: [{ streetAddress: '123 Main St', country: 'US' }],
    };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should reject extension complex missing required sub-attr on create', () => {
    const extSchema = makeExtSchema([
      makeAttr({
        name: 'manager',
        type: 'complex',
        subAttributes: [
          makeAttr({ name: 'managerId', required: true }),
          makeAttr({ name: 'displayName' }),
        ],
      }),
    ]);
    const coreSchema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
    const payload = {
      schemas: [CORE_SCHEMA_ID, EXT_SCHEMA_ID],
      userName: 'alice',
      [EXT_SCHEMA_ID]: { manager: { displayName: 'Bob' } },
    };
    const result = SchemaValidator.validate(payload, [coreSchema, extSchema], createOpts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path?.includes('managerId') && e.message.includes('Required'))).toBe(true);
  });
});

// ─── V25: Non-strict mode and empty schemas ─────────────────────────────────

describe('V25 — schemas in non-strict mode', () => {
  const schema = makeCoreSchema([makeAttr({ name: 'userName', required: true })]);
  const nonStrictOpts: ValidationOptions = { strictMode: false, mode: 'create' };

  it('should accept unknown schema URN in non-strict mode', () => {
    const payload = { schemas: [CORE_SCHEMA_ID, 'urn:unknown:schema'], userName: 'alice' };
    const result = SchemaValidator.validate(payload, [schema], nonStrictOpts);
    expect(result.valid).toBe(true);
  });

  it('should accept empty schemas array in non-strict mode (lenient)', () => {
    // Non-strict mode does not enforce schemas array constraints.
    // The DTO layer (@ArrayNotEmpty) handles this before the validator.
    const payload = { schemas: [] as string[], userName: 'alice' };
    const result = SchemaValidator.validate(payload, [schema], nonStrictOpts);
    expect(result.valid).toBe(true);
  });
});

// ─── V31: dateTime — additional edge cases ──────────────────────────────────

describe('V31 — dateTime additional edge cases', () => {
  const schema = makeCoreSchema([
    makeAttr({ name: 'lastLogin', type: 'dateTime' }),
  ]);

  it('should accept dateTime with negative timezone offset', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-06-15T08:00:00-05:00' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should accept dateTime with fractional seconds and positive offset', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-06-15T08:00:00.999+09:00' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should accept dateTime with out-of-range month (regex is format-only)', () => {
    // XSD_DATETIME_RE validates format (\d{4}-\d{2}-\d{2}T...) not
    // semantic ranges. Months like 13 pass the regex. Semantic
    // validation is DB/application layer responsibility.
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-13-15T10:30:00Z' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(true);
  });

  it('should reject dateTime with space instead of T separator', () => {
    const payload = { schemas: [CORE_SCHEMA_ID], lastLogin: '2024-01-15 10:30:00Z' };
    const result = SchemaValidator.validate(payload, [schema], createOpts);
    expect(result.valid).toBe(false);
  });
});

// ─── G8c: readOnly mutability pre-validation in PATCH ────────────────────────

describe('G8c — readOnly attribute rejection in PATCH operations', () => {
  const GROUP_CORE_SCHEMA_ID = 'urn:ietf:params:scim:schemas:core:2.0:Group';

  const userSchemas: SchemaDefinition[] = [
    makeCoreSchema([
      makeAttr({ name: 'userName', required: true }),
      makeAttr({ name: 'displayName' }),
      makeAttr({ name: 'active', type: 'boolean' }),
      makeAttr({ name: 'groups', type: 'complex', multiValued: true, mutability: 'readOnly',
        subAttributes: [
          makeAttr({ name: 'value' }),
          makeAttr({ name: 'display' }),
          makeAttr({ name: 'type' }),
          makeAttr({ name: '$ref', type: 'reference' }),
        ],
      }),
      makeAttr({
        name: 'name',
        type: 'complex',
        subAttributes: [
          makeAttr({ name: 'givenName' }),
          makeAttr({ name: 'familyName' }),
          makeAttr({ name: 'formatted', mutability: 'readOnly' }),
        ],
      }),
    ]),
    makeExtSchema([
      makeAttr({ name: 'department' }),
      makeAttr({ name: 'organization', mutability: 'readOnly' }),
    ]),
  ];

  // ── Path-based operations ──

  describe('path-based operations', () => {
    it('should reject replace on readOnly attribute (groups)', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', 'groups', [{ value: 'g1' }], userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].scimType).toBe('mutability');
      expect(result.errors[0].message).toMatch(/readOnly/);
      expect(result.errors[0].message).toMatch(/groups/i);
    });

    it('should reject add on readOnly attribute (groups)', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'add', 'groups', [{ value: 'g1' }], userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
    });

    it('should reject remove on readOnly attribute (groups)', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'remove', 'groups', undefined, userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
      expect(result.errors[0].message).toMatch(/removed/);
    });

    it('should allow replace on readWrite attribute (displayName)', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', 'displayName', 'Alice', userSchemas,
      );
      expect(result.valid).toBe(true);
    });

    it('should allow add on readWrite attribute', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'add', 'active', true, userSchemas,
      );
      expect(result.valid).toBe(true);
    });

    it('should reject replace on readOnly sub-attribute via dot path (name.formatted)', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', 'name.formatted', 'Dr. Alice Smith', userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
      expect(result.errors[0].message).toMatch(/readOnly/);
    });

    it('should allow replace on readWrite sub-attribute via dot path (name.givenName)', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', 'name.givenName', 'Bob', userSchemas,
      );
      expect(result.valid).toBe(true);
    });

    it('should reject replace on readOnly extension attribute via URN path', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace',
        `${EXT_SCHEMA_ID}:organization`,
        'Acme Corp',
        userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
      expect(result.errors[0].message).toMatch(/readOnly/);
    });

    it('should allow replace on readWrite extension attribute via URN path', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace',
        `${EXT_SCHEMA_ID}:department`,
        'Engineering',
        userSchemas,
      );
      expect(result.valid).toBe(true);
    });

    it('should reject readOnly via value-filter path (groups[value eq "x"])', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', 'groups[value eq "g1"].display', 'Group 1', userSchemas,
      );
      // groups is readOnly → should be rejected even with value filter
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
    });
  });

  // ── No-path operations (value is an object) ──

  describe('no-path operations', () => {
    it('should reject readOnly core attribute in no-path replace', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', undefined,
        { displayName: 'Alice', groups: [{ value: 'g1' }] },
        userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].scimType).toBe('mutability');
      expect(result.errors[0].path).toBe('groups');
    });

    it('should reject readOnly core attribute in no-path add', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'add', undefined,
        { groups: [{ value: 'g1' }] },
        userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
    });

    it('should allow no-path replace with only readWrite attributes', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', undefined,
        { displayName: 'Alice', active: true },
        userSchemas,
      );
      expect(result.valid).toBe(true);
    });

    it('should reject readOnly extension attribute in no-path object', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', undefined,
        {
          [EXT_SCHEMA_ID]: { organization: 'Acme Corp' },
        },
        userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
      expect(result.errors[0].path).toContain('organization');
    });

    it('should allow readWrite extension attribute in no-path object', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', undefined,
        {
          [EXT_SCHEMA_ID]: { department: 'Engineering' },
        },
        userSchemas,
      );
      expect(result.valid).toBe(true);
    });

    it('should reject multiple readOnly attributes and report all errors', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', undefined,
        {
          groups: [{ value: 'g1' }],
          [EXT_SCHEMA_ID]: { organization: 'Acme' },
        },
        userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.every(e => e.scimType === 'mutability')).toBe(true);
    });

    it('should skip reserved keys (schemas, meta, id) — no readOnly error', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', undefined,
        { schemas: ['urn:some:schema'], meta: {}, id: 'xyz', displayName: 'Alice' },
        userSchemas,
      );
      // Reserved keys are always skipped — should not produce readOnly errors
      expect(result.valid).toBe(true);
    });
  });

  // ── Case-insensitive path matching ──

  describe('case-insensitive path matching', () => {
    it('should reject readOnly attribute with different case (Groups vs groups)', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'replace', 'Groups', [{ value: 'g1' }], userSchemas,
      );
      // resolvePatchPath normalizes to lowercase → should still find groups → readOnly
      expect(result.valid).toBe(false);
      expect(result.errors[0].scimType).toBe('mutability');
    });
  });

  // ── Remove on readOnly with no value ──

  describe('remove operations on readOnly', () => {
    it('should reject remove on readOnly attribute with no value', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'remove', 'groups', undefined, userSchemas,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toMatch(/removed/);
    });

    it('should allow remove on readWrite attribute', () => {
      const result = SchemaValidator.validatePatchOperationValue(
        'remove', 'displayName', undefined, userSchemas,
      );
      expect(result.valid).toBe(true);
    });
  });
});
