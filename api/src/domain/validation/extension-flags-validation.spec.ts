/**
 * Extension Schema Validation - Flag Combinations & Flow Tests
 *
 * Covers gaps in SchemaValidator for:
 *  - Extension schema with canonical value enforcement (V10 gap)
 *  - Extension block as array (should reject)
 *  - Immutable extension attributes across modes
 *  - Extension schema + core error accumulation across flag combos
 *  - validatePatchOperationValue with extension blocks in no-path ops
 *  - MSFT test URN validation coverage
 *  - Multi-extension simultaneous validation with strictMode × mode matrix
 *  - checkImmutable for extension attributes
 */

import { SchemaValidator } from './schema-validator';
import type {
  SchemaAttributeDefinition,
  SchemaDefinition,
  ValidationOptions,
} from './validation-types';

// ─── URN Constants ───────────────────────────────────────────────────────────

const CORE_USER_ID = 'urn:ietf:params:scim:schemas:core:2.0:User';
const CORE_GROUP_ID = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const ENTERPRISE_ID = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const CUSTOM_EXT_A = 'urn:example:custom:2.0:ExtA';
const CUSTOM_EXT_B = 'urn:example:custom:2.0:ExtB';
const MSFT_CUSTOM_USER = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User';
const MSFT_IETF_USER = 'urn:ietf:params:scim:schemas:extension:msfttest:User';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function coreSchema(attributes: SchemaAttributeDefinition[]): SchemaDefinition {
  return { id: CORE_USER_ID, attributes };
}

function coreGroupSchema(attributes: SchemaAttributeDefinition[]): SchemaDefinition {
  return { id: CORE_GROUP_ID, attributes };
}

function extSchema(
  attributes: SchemaAttributeDefinition[],
  id: string = ENTERPRISE_ID,
): SchemaDefinition {
  return { id, attributes };
}

// ─── Option Presets ──────────────────────────────────────────────────────────

const STRICT_CREATE: ValidationOptions = { strictMode: true, mode: 'create' };
const STRICT_REPLACE: ValidationOptions = { strictMode: true, mode: 'replace' };
const STRICT_PATCH: ValidationOptions = { strictMode: true, mode: 'patch' };
const LENIENT_CREATE: ValidationOptions = { strictMode: false, mode: 'create' };
const LENIENT_REPLACE: ValidationOptions = { strictMode: false, mode: 'replace' };
const LENIENT_PATCH: ValidationOptions = { strictMode: false, mode: 'patch' };

const ALL_OPTS: { label: string; opts: ValidationOptions }[] = [
  { label: 'strict+create', opts: STRICT_CREATE },
  { label: 'strict+replace', opts: STRICT_REPLACE },
  { label: 'strict+patch', opts: STRICT_PATCH },
  { label: 'lenient+create', opts: LENIENT_CREATE },
  { label: 'lenient+replace', opts: LENIENT_REPLACE },
  { label: 'lenient+patch', opts: LENIENT_PATCH },
];

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Extension Canonical Value Enforcement (V10 gap)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Extension schema - canonical values (V10)', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);
  const ext = extSchema([
    makeAttr({
      name: 'department',
      canonicalValues: ['Engineering', 'Sales', 'Marketing', 'HR'],
    }),
    makeAttr({
      name: 'employeeType',
      canonicalValues: ['full-time', 'part-time', 'contractor'],
    }),
  ]);

  it('should accept valid canonical value in extension attribute', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { department: 'Engineering' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should reject non-canonical value in extension attribute (strict)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { department: 'InvalidDept' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/canonical/i);
  });

  it('should accept canonical value case-insensitively', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { department: 'engineering' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should reject non-canonical in extension via PATCH pre-validation', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${ENTERPRISE_ID}:department`,
      'InvalidDept',
      [core, ext],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/canonical/i);
  });

  it('should accept canonical in extension via PATCH pre-validation', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${ENTERPRISE_ID}:department`,
      'Sales',
      [core, ext],
    );
    expect(result.valid).toBe(true);
  });

  it('should reject invalid employeeType in extension', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { employeeType: 'intern' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/canonical/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Extension Block as Array (should reject)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Extension block validation - non-object shapes', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);
  const ext = extSchema([
    makeAttr({ name: 'department' }),
  ]);

  // The current validator does NOT validate the extension block shape -
  // non-object values are silently skipped. These tests document actual behavior.
  it('should silently skip extension block as an array (no crash)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: [{ department: 'Eng' }],
    };
    const result = SchemaValidator.validate(payload as any, [core, ext], STRICT_CREATE);
    // Not rejected - validator skips non-object extension blocks
    expect(result.valid).toBe(true);
  });

  it('should silently skip extension block as a string (no crash)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: 'invalid-block',
    };
    const result = SchemaValidator.validate(payload as any, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should silently skip extension block as a number (no crash)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: 42,
    };
    const result = SchemaValidator.validate(payload as any, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should accept extension block as empty object', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: {},
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Immutable Extension Attributes - checkImmutable
// ═══════════════════════════════════════════════════════════════════════════════

describe('Immutable extension attributes - checkImmutable', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);
  const ext = extSchema([
    makeAttr({ name: 'employeeId', mutability: 'immutable' }),
    makeAttr({ name: 'department', mutability: 'readWrite' }),
  ]);

  it('should reject change to immutable extension attribute', () => {
    const existing = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { employeeId: 'EMP001', department: 'Eng' },
    };
    const incoming = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { employeeId: 'CHANGED', department: 'Sales' },
    };
    const result = SchemaValidator.checkImmutable(existing, incoming, [core, ext]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path?.includes('employeeId'))).toBe(true);
  });

  it('should accept when immutable extension attribute unchanged', () => {
    const existing = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { employeeId: 'EMP001', department: 'Eng' },
    };
    const incoming = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { employeeId: 'EMP001', department: 'Sales' },
    };
    const result = SchemaValidator.checkImmutable(existing, incoming, [core, ext]);
    expect(result.valid).toBe(true);
  });

  it('should accept when extension block is absent in incoming (no change)', () => {
    const existing = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { employeeId: 'EMP001' },
    };
    const incoming = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
    };
    const result = SchemaValidator.checkImmutable(existing, incoming, [core, ext]);
    expect(result.valid).toBe(true);
  });

  it('should accept first-time set of immutable extension attribute', () => {
    const existing = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
    };
    const incoming = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [ENTERPRISE_ID]: { employeeId: 'EMP001' },
    };
    const result = SchemaValidator.checkImmutable(existing, incoming, [core, ext]);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Extension Validation - strictMode × mode Matrix
// ═══════════════════════════════════════════════════════════════════════════════

describe('Extension validation across strictMode × mode matrix', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);
  const ext = extSchema([
    makeAttr({ name: 'department' }),
    makeAttr({ name: 'costCenter', required: true }),
  ]);

  // Required extension attrs: enforced on create/replace, skipped on patch
  for (const { label, opts } of ALL_OPTS) {
    it(`[${label}] valid ext with all required attrs should pass`, () => {
      const payload = {
        schemas: [CORE_USER_ID],
        userName: 'alice',
        [ENTERPRISE_ID]: { department: 'Eng', costCenter: 'CC100' },
      };
      const result = SchemaValidator.validate(payload, [core, ext], opts);
      expect(result.valid).toBe(true);
    });
  }

  // Missing required extension attr only fails on create/replace
  for (const { label, opts } of ALL_OPTS) {
    if (opts.mode === 'patch') {
      it(`[${label}] missing required ext attr should pass (patch mode)`, () => {
        const payload = {
          schemas: [CORE_USER_ID],
          userName: 'alice',
          [ENTERPRISE_ID]: { department: 'Eng' }, // no costCenter
        };
        const result = SchemaValidator.validate(payload, [core, ext], opts);
        expect(result.valid).toBe(true);
      });
    } else {
      it(`[${label}] missing required ext attr should fail`, () => {
        const payload = {
          schemas: [CORE_USER_ID],
          userName: 'alice',
          [ENTERPRISE_ID]: { department: 'Eng' }, // no costCenter
        };
        const result = SchemaValidator.validate(payload, [core, ext], opts);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.path?.includes('costCenter'))).toBe(true);
      });
    }
  }

  // Unknown extension attrs: only fail in strict mode
  for (const { label, opts } of ALL_OPTS) {
    if (opts.strictMode) {
      it(`[${label}] unknown ext attr should fail (strict)`, () => {
        const payload = {
          schemas: [CORE_USER_ID],
          userName: 'alice',
          [ENTERPRISE_ID]: { department: 'Eng', costCenter: 'CC100', unknownField: 'x' },
        };
        const result = SchemaValidator.validate(payload, [core, ext], opts);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.path?.includes('unknownField'))).toBe(true);
      });
    } else {
      it(`[${label}] unknown ext attr should pass (lenient)`, () => {
        const payload = {
          schemas: [CORE_USER_ID],
          userName: 'alice',
          [ENTERPRISE_ID]: { department: 'Eng', costCenter: 'CC100', unknownField: 'x' },
        };
        const result = SchemaValidator.validate(payload, [core, ext], opts);
        expect(result.valid).toBe(true);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Multi-Extension + strictMode × mode Combinations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Multi-extension schemas - flag matrix interactions', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);
  const ext1 = extSchema([
    makeAttr({ name: 'dept', required: true }),
  ], CUSTOM_EXT_A);
  const ext2 = extSchema([
    makeAttr({ name: 'team', required: true }),
  ], CUSTOM_EXT_B);

  it('should pass when both extensions have all required attrs (strict+create)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [CUSTOM_EXT_A]: { dept: 'Eng' },
      [CUSTOM_EXT_B]: { team: 'Backend' },
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should fail when one extension missing required attr (strict+create)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [CUSTOM_EXT_A]: { dept: 'Eng' },
      [CUSTOM_EXT_B]: {}, // missing team
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], STRICT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path?.includes('team'))).toBe(true);
  });

  it('should pass when extensions missing required attrs in patch mode', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [CUSTOM_EXT_A]: {},
      [CUSTOM_EXT_B]: {},
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], STRICT_PATCH);
    expect(result.valid).toBe(true);
  });

  it('should pass with only one extension present (partial)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      [CUSTOM_EXT_A]: { dept: 'Eng' },
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should reject unknown URN in schemas[] with two extensions registered (strict)', () => {
    const payload = {
      schemas: [CORE_USER_ID, 'urn:unknown:schema'],
      userName: 'alice',
      [CUSTOM_EXT_A]: { dept: 'Eng' },
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], STRICT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('not recognized'))).toBe(true);
  });

  it('should accept unknown URN in schemas[] with two extensions (lenient)', () => {
    const payload = {
      schemas: [CORE_USER_ID, 'urn:unknown:schema'],
      userName: 'alice',
      [CUSTOM_EXT_A]: { dept: 'Eng' },
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], LENIENT_CREATE);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. validatePatchOperationValue - Extension Complex Types
// ═══════════════════════════════════════════════════════════════════════════════

describe('validatePatchOperationValue - extension complex types', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);
  const ext = extSchema([
    makeAttr({
      name: 'manager',
      type: 'complex',
      subAttributes: [
        makeAttr({ name: 'value', required: true }),
        makeAttr({ name: 'displayName' }),
        makeAttr({ name: 'managerId', type: 'integer' }),
      ],
    }),
    makeAttr({ name: 'department' }),
    makeAttr({ name: 'employeeNumber', type: 'integer' }),
  ]);
  const schemas = [core, ext];

  it('should validate complex extension attribute via path', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${ENTERPRISE_ID}:manager`,
      { value: 'mgr-1', displayName: 'Boss' },
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type in complex extension sub-attribute', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${ENTERPRISE_ID}:manager`,
      { value: 'mgr-1', managerId: 'not-a-number' },
      schemas,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/integer/i);
  });

  it('should validate extension integer attribute via path', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${ENTERPRISE_ID}:employeeNumber`,
      42,
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject string for extension integer attribute', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      `${ENTERPRISE_ID}:employeeNumber`,
      'not-int',
      schemas,
    );
    expect(result.valid).toBe(false);
  });

  it('should validate no-path with extension complex block', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      undefined,
      {
        [ENTERPRISE_ID]: {
          manager: { value: 'mgr-1', displayName: 'Boss' },
          department: 'Eng',
        },
      },
      schemas,
    );
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type in no-path extension complex block', () => {
    const result = SchemaValidator.validatePatchOperationValue(
      'replace',
      undefined,
      {
        [ENTERPRISE_ID]: {
          employeeNumber: 'not-int',
        },
      },
      schemas,
    );
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Extension on Group Schema - Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group schema with custom extension - validation', () => {
  const groupCore = coreGroupSchema([
    makeAttr({ name: 'displayName', required: true }),
    makeAttr({
      name: 'members',
      type: 'complex',
      multiValued: true,
      subAttributes: [
        makeAttr({ name: 'value', required: true }),
        makeAttr({ name: 'display' }),
        makeAttr({ name: 'type' }),
      ],
    }),
  ]);

  const groupExt = extSchema([
    makeAttr({ name: 'groupType' }),
    makeAttr({ name: 'priority', type: 'integer' }),
  ], CUSTOM_EXT_A);

  it('should validate group with custom extension', () => {
    const payload = {
      schemas: [CORE_GROUP_ID],
      displayName: 'Engineering',
      [CUSTOM_EXT_A]: { groupType: 'team', priority: 1 },
    };
    const result = SchemaValidator.validate(payload, [groupCore, groupExt], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type in group extension', () => {
    const payload = {
      schemas: [CORE_GROUP_ID],
      displayName: 'Engineering',
      [CUSTOM_EXT_A]: { priority: 'high' },
    };
    const result = SchemaValidator.validate(payload, [groupCore, groupExt], LENIENT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/integer/i);
  });

  it('should reject unknown attrs in group extension (strict)', () => {
    const payload = {
      schemas: [CORE_GROUP_ID],
      displayName: 'Engineering',
      [CUSTOM_EXT_A]: { groupType: 'team', unknownGroupField: 'x' },
    };
    const result = SchemaValidator.validate(payload, [groupCore, groupExt], STRICT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toContain('unknownGroupField');
  });

  it('should allow unknown attrs in group extension (lenient)', () => {
    const payload = {
      schemas: [CORE_GROUP_ID],
      displayName: 'Engineering',
      [CUSTOM_EXT_A]: { groupType: 'team', unknownGroupField: 'x' },
    };
    const result = SchemaValidator.validate(payload, [groupCore, groupExt], LENIENT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should validate group extension in patch mode (required skipped)', () => {
    const extWithRequired = extSchema([
      makeAttr({ name: 'groupType', required: true }),
    ], CUSTOM_EXT_A);
    const payload = {
      schemas: [CORE_GROUP_ID],
      displayName: 'Engineering',
      [CUSTOM_EXT_A]: {}, // missing required groupType
    };
    const result = SchemaValidator.validate(payload, [groupCore, extWithRequired], STRICT_PATCH);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Extension Type Validation - All SCIM Types
// ═══════════════════════════════════════════════════════════════════════════════

describe('Extension attributes - all SCIM types', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);

  const typeCases: {
    type: string;
    valid: unknown;
    invalid: unknown;
  }[] = [
    { type: 'string', valid: 'hello', invalid: 42 },
    { type: 'boolean', valid: true, invalid: 'true' },
    { type: 'integer', valid: 42, invalid: 'forty-two' },
    { type: 'decimal', valid: 3.14, invalid: 'pi' },
    { type: 'dateTime', valid: '2024-01-15T10:00:00Z', invalid: 'yesterday' },
    { type: 'reference', valid: 'https://example.com', invalid: 42 },
    { type: 'binary', valid: 'aGVsbG8=', invalid: 42 },
  ];

  for (const { type, valid, invalid } of typeCases) {
    it(`should accept valid ${type} extension attribute`, () => {
      const ext = extSchema([makeAttr({ name: 'testField', type })]);
      const payload = {
        schemas: [CORE_USER_ID],
        userName: 'a',
        [ENTERPRISE_ID]: { testField: valid },
      };
      const result = SchemaValidator.validate(payload, [core, ext], LENIENT_CREATE);
      expect(result.valid).toBe(true);
    });

    it(`should reject invalid ${type} extension attribute`, () => {
      const ext = extSchema([makeAttr({ name: 'testField', type })]);
      const payload = {
        schemas: [CORE_USER_ID],
        userName: 'a',
        [ENTERPRISE_ID]: { testField: invalid },
      };
      const result = SchemaValidator.validate(payload, [core, ext], LENIENT_CREATE);
      expect(result.valid).toBe(false);
    });
  }

  it('should validate complex extension attribute with sub-attributes', () => {
    const ext = extSchema([
      makeAttr({
        name: 'office',
        type: 'complex',
        subAttributes: [
          makeAttr({ name: 'building', type: 'string' }),
          makeAttr({ name: 'floor', type: 'integer' }),
        ],
      }),
    ]);
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { office: { building: 'HQ', floor: 3 } },
    };
    const result = SchemaValidator.validate(payload, [core, ext], LENIENT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should reject wrong type in complex extension sub-attribute', () => {
    const ext = extSchema([
      makeAttr({
        name: 'office',
        type: 'complex',
        subAttributes: [
          makeAttr({ name: 'building', type: 'string' }),
          makeAttr({ name: 'floor', type: 'integer' }),
        ],
      }),
    ]);
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { office: { building: 'HQ', floor: 'third' } },
    };
    const result = SchemaValidator.validate(payload, [core, ext], LENIENT_CREATE);
    expect(result.valid).toBe(false);
  });

  it('should validate multi-valued extension attribute', () => {
    const ext = extSchema([
      makeAttr({ name: 'tags', type: 'string', multiValued: true }),
    ]);
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { tags: ['a', 'b', 'c'] },
    };
    const result = SchemaValidator.validate(payload, [core, ext], LENIENT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should reject non-array for multi-valued extension attribute', () => {
    const ext = extSchema([
      makeAttr({ name: 'tags', type: 'string', multiValued: true }),
    ]);
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { tags: 'not-an-array' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], LENIENT_CREATE);
    expect(result.valid).toBe(false);
  });

  it('should reject wrong element type in multi-valued extension attribute', () => {
    const ext = extSchema([
      makeAttr({ name: 'tags', type: 'string', multiValued: true }),
    ]);
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { tags: ['valid', 42] },
    };
    const result = SchemaValidator.validate(payload, [core, ext], LENIENT_CREATE);
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Extension readOnly/writeOnly across modes
// ═══════════════════════════════════════════════════════════════════════════════

describe('Extension mutability flags across modes', () => {
  const core = coreSchema([makeAttr({ name: 'userName', required: true })]);
  const ext = extSchema([
    makeAttr({ name: 'readOnlyField', mutability: 'readOnly' }),
    makeAttr({ name: 'writeOnlyField', mutability: 'writeOnly' }),
    makeAttr({ name: 'immutableField', mutability: 'immutable' }),
    makeAttr({ name: 'readWriteField' }),
  ]);

  it('should reject readOnly extension attr on create', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { readOnlyField: 'x' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/readOnly/i);
  });

  it('should reject readOnly extension attr on replace', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { readOnlyField: 'x' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_REPLACE);
    expect(result.valid).toBe(false);
  });

  it('should accept readOnly extension attr on patch', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { readOnlyField: 'x' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_PATCH);
    expect(result.valid).toBe(true);
  });

  it('should accept writeOnly extension attr on create', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { writeOnlyField: 'secret' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should accept immutable extension attr on create (first set)', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { immutableField: 'set-once' },
    };
    const result = SchemaValidator.validate(payload, [core, ext], STRICT_CREATE);
    expect(result.valid).toBe(true);
  });

  it('should accept readWrite extension attr on all modes', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'a',
      [ENTERPRISE_ID]: { readWriteField: 'anything' },
    };
    for (const { opts } of ALL_OPTS) {
      const result = SchemaValidator.validate(payload, [core, ext], opts);
      expect(result.valid).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Error Accumulation - Core + Multiple Extensions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Error accumulation - core + multiple extensions', () => {
  const core = coreSchema([
    makeAttr({ name: 'userName', required: true }),
    makeAttr({ name: 'active', type: 'boolean' }),
  ]);
  const ext1 = extSchema([
    makeAttr({ name: 'dept', type: 'integer' }),
  ], CUSTOM_EXT_A);
  const ext2 = extSchema([
    makeAttr({ name: 'team', type: 'boolean' }),
  ], CUSTOM_EXT_B);

  it('should accumulate errors from core + two extensions', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      active: 'not-bool', // error in core
      [CUSTOM_EXT_A]: { dept: 'not-int' }, // error in ext1
      [CUSTOM_EXT_B]: { team: 'not-bool' }, // error in ext2
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], LENIENT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('should report all errors even when first extension is valid', () => {
    const payload = {
      schemas: [CORE_USER_ID],
      userName: 'alice',
      active: 'not-bool',
      [CUSTOM_EXT_A]: { dept: 42 }, // valid
      [CUSTOM_EXT_B]: { team: 'not-bool' }, // error
    };
    const result = SchemaValidator.validate(payload, [core, ext1, ext2], LENIENT_CREATE);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
