/**
 * Unit tests for shared SCIM service helpers (G17 — Service Deduplication).
 *
 * Tests cover:
 *  - parseJson: safe JSON parsing with fallback
 *  - ensureSchema: schema URN validation
 *  - enforceIfMatch: ETag/If-Match enforcement
 *  - sanitizeBooleanStrings: boolean coercion
 *  - guardSoftDeleted: soft-delete guard
 *  - ScimSchemaHelpers: parameterized schema-aware methods
 */

import { HttpException } from '@nestjs/common';
import {
  parseJson,
  ensureSchema,
  enforceIfMatch,
  sanitizeBooleanStrings,
  guardSoftDeleted,
  ScimSchemaHelpers,
} from './scim-service-helpers';

// ─── parseJson ──────────────────────────────────────────────────────────────

describe('parseJson', () => {
  it('should parse valid JSON', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('should return empty object for null', () => {
    expect(parseJson(null)).toEqual({});
  });

  it('should return empty object for undefined', () => {
    expect(parseJson(undefined)).toEqual({});
  });

  it('should return empty object for empty string', () => {
    expect(parseJson('')).toEqual({});
  });

  it('should return empty object for invalid JSON', () => {
    expect(parseJson('not json')).toEqual({});
  });

  it('should parse arrays', () => {
    expect(parseJson<string[]>('["a","b"]')).toEqual(['a', 'b']);
  });
});

// ─── ensureSchema ───────────────────────────────────────────────────────────

describe('ensureSchema', () => {
  const URN = 'urn:ietf:params:scim:schemas:core:2.0:User';

  it('should pass when schema is present', () => {
    expect(() => ensureSchema([URN], URN)).not.toThrow();
  });

  it('should be case-insensitive', () => {
    expect(() => ensureSchema([URN.toUpperCase()], URN)).not.toThrow();
  });

  it('should throw 400 when schema is missing', () => {
    expect(() => ensureSchema(['urn:other'], URN)).toThrow(HttpException);
  });

  it('should throw 400 when schemas is undefined', () => {
    expect(() => ensureSchema(undefined, URN)).toThrow(HttpException);
  });

  it('should throw 400 when schemas is empty', () => {
    expect(() => ensureSchema([], URN)).toThrow(HttpException);
  });
});

// ─── enforceIfMatch ─────────────────────────────────────────────────────────

describe('enforceIfMatch', () => {
  it('should pass when If-Match matches', () => {
    expect(() => enforceIfMatch(3, 'W/"v3"')).not.toThrow();
  });

  it('should throw 412 when If-Match does not match', () => {
    try {
      enforceIfMatch(3, 'W/"v2"');
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(412);
    }
  });

  it('should pass when If-Match is wildcard (*)', () => {
    expect(() => enforceIfMatch(3, '*')).not.toThrow();
  });

  it('should pass when If-Match is not provided and not required', () => {
    expect(() => enforceIfMatch(3, undefined)).not.toThrow();
  });

  it('should throw 428 when RequireIfMatch is true and no If-Match', () => {
    const config = { RequireIfMatch: 'true' } as any;
    try {
      enforceIfMatch(3, undefined, config);
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(428);
    }
  });

  it('should not throw 428 when RequireIfMatch is false and no If-Match', () => {
    const config = { RequireIfMatch: 'false' } as any;
    expect(() => enforceIfMatch(3, undefined, config)).not.toThrow();
  });
});

// ─── sanitizeBooleanStrings ─────────────────────────────────────────────────

describe('sanitizeBooleanStrings', () => {
  const boolKeys = new Set(['active', 'primary']);

  it('should convert "True" to true for boolean keys', () => {
    const obj: Record<string, unknown> = { active: 'True' };
    sanitizeBooleanStrings(obj, boolKeys);
    expect(obj.active).toBe(true);
  });

  it('should convert "False" to false for boolean keys', () => {
    const obj: Record<string, unknown> = { primary: 'False' };
    sanitizeBooleanStrings(obj, boolKeys);
    expect(obj.primary).toBe(false);
  });

  it('should be case-insensitive for values', () => {
    const obj: Record<string, unknown> = { active: 'TRUE', primary: 'false' };
    sanitizeBooleanStrings(obj, boolKeys);
    expect(obj.active).toBe(true);
    expect(obj.primary).toBe(false);
  });

  it('should not convert non-boolean keys', () => {
    const obj: Record<string, unknown> = { name: 'True' };
    sanitizeBooleanStrings(obj, boolKeys);
    expect(obj.name).toBe('True');
  });

  it('should handle nested objects', () => {
    const obj: Record<string, unknown> = {
      nested: { active: 'True' },
    };
    sanitizeBooleanStrings(obj, boolKeys);
    expect((obj.nested as Record<string, unknown>).active).toBe(true);
  });

  it('should handle arrays of objects', () => {
    const obj: Record<string, unknown> = {
      items: [{ primary: 'True' }, { primary: 'False' }],
    };
    sanitizeBooleanStrings(obj, boolKeys);
    const items = obj.items as Record<string, unknown>[];
    expect(items[0].primary).toBe(true);
    expect(items[1].primary).toBe(false);
  });

  it('should not modify non-string values', () => {
    const obj: Record<string, unknown> = { active: true, primary: 42 };
    sanitizeBooleanStrings(obj, boolKeys);
    expect(obj.active).toBe(true);
    expect(obj.primary).toBe(42);
  });

  it('should handle empty booleanKeys set', () => {
    const obj: Record<string, unknown> = { active: 'True' };
    sanitizeBooleanStrings(obj, new Set());
    expect(obj.active).toBe('True');
  });
});

// ─── guardSoftDeleted ───────────────────────────────────────────────────────

describe('guardSoftDeleted', () => {
  const mockLogger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
  } as any;

  const logCategory = 'SCIM_USER' as any;

  afterEach(() => jest.clearAllMocks());

  it('should not throw when SoftDeleteEnabled is off', () => {
    const record = { deletedAt: new Date() };
    expect(() => guardSoftDeleted(record, undefined, 'id-1', mockLogger, logCategory)).not.toThrow();
  });

  it('should not throw when SoftDeleteEnabled is on but deletedAt is null', () => {
    const config = { SoftDeleteEnabled: 'true' } as any;
    const record = { deletedAt: null };
    expect(() => guardSoftDeleted(record, config, 'id-1', mockLogger, logCategory)).not.toThrow();
  });

  it('should throw 404 when SoftDeleteEnabled is on and deletedAt is set', () => {
    const config = { SoftDeleteEnabled: 'true' } as any;
    const record = { deletedAt: new Date() };
    try {
      guardSoftDeleted(record, config, 'id-1', mockLogger, logCategory);
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(404);
    }
  });
});

// ─── ScimSchemaHelpers ──────────────────────────────────────────────────────

describe('ScimSchemaHelpers', () => {
  const CORE_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const EXT_URN = 'urn:ext:custom';

  const mockRegistry = {
    getSchema: jest.fn(),
    getExtensionUrns: jest.fn().mockReturnValue([]),
  } as any;

  let helpers: ScimSchemaHelpers;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry.getExtensionUrns.mockReturnValue([]);
    helpers = new ScimSchemaHelpers(mockRegistry, CORE_URN);
  });

  describe('enforceStrictSchemaValidation', () => {
    it('should do nothing when strict mode is off', () => {
      helpers.enforceStrictSchemaValidation({ schemas: [CORE_URN] }, 'ep-1');
      // no throw
    });

    it('should pass when all URNs are declared and registered', () => {
      const config = { StrictSchemaValidation: 'true' } as any;
      mockRegistry.getExtensionUrns.mockReturnValue([EXT_URN]);
      const dto = {
        schemas: [CORE_URN, EXT_URN],
        [EXT_URN]: { foo: 'bar' },
      };
      expect(() =>
        helpers.enforceStrictSchemaValidation(dto, 'ep-1', config),
      ).not.toThrow();
    });

    it('should throw when extension URN is in body but not in schemas[]', () => {
      const config = { StrictSchemaValidation: 'true' } as any;
      mockRegistry.getExtensionUrns.mockReturnValue([EXT_URN]);
      const dto = {
        schemas: [CORE_URN],
        [EXT_URN]: { foo: 'bar' },
      };
      expect(() =>
        helpers.enforceStrictSchemaValidation(dto, 'ep-1', config),
      ).toThrow(HttpException);
    });

    it('should throw when extension URN is not registered', () => {
      const config = { StrictSchemaValidation: 'true' } as any;
      mockRegistry.getExtensionUrns.mockReturnValue([]); // empty
      const dto = {
        schemas: [CORE_URN, EXT_URN],
        [EXT_URN]: { foo: 'bar' },
      };
      expect(() =>
        helpers.enforceStrictSchemaValidation(dto, 'ep-1', config),
      ).toThrow(HttpException);
    });
  });

  describe('buildSchemaDefinitions', () => {
    it('should return core + extension schemas from registry', () => {
      const coreDef = { id: CORE_URN, name: 'User', attributes: [] };
      const extDef = { id: EXT_URN, name: 'Custom', attributes: [] };
      mockRegistry.getSchema.mockImplementation((urn: string) => {
        if (urn === CORE_URN) return coreDef;
        if (urn === EXT_URN) return extDef;
        return null;
      });

      const dto = { schemas: [CORE_URN, EXT_URN] };
      const result = helpers.buildSchemaDefinitions(dto, 'ep-1');
      expect(result).toEqual([coreDef, extDef]);
    });

    it('should return empty array when no schemas registered', () => {
      mockRegistry.getSchema.mockReturnValue(null);
      const dto = { schemas: [CORE_URN] };
      expect(helpers.buildSchemaDefinitions(dto, 'ep-1')).toEqual([]);
    });
  });

  describe('getExtensionUrns', () => {
    it('should delegate to schema registry', () => {
      mockRegistry.getExtensionUrns.mockReturnValue([EXT_URN]);
      expect(helpers.getExtensionUrns('ep-1')).toEqual([EXT_URN]);
      expect(mockRegistry.getExtensionUrns).toHaveBeenCalledWith('ep-1');
    });
  });

  describe('getSchemaDefinitions', () => {
    it('should return core + extension schemas', () => {
      const coreDef = { id: CORE_URN, name: 'User', attributes: [] };
      const extDef = { id: EXT_URN, name: 'Custom', attributes: [] };
      mockRegistry.getSchema.mockImplementation((urn: string) => {
        if (urn === CORE_URN) return coreDef;
        if (urn === EXT_URN) return extDef;
        return null;
      });
      mockRegistry.getExtensionUrns.mockReturnValue([EXT_URN]);
      const result = helpers.getSchemaDefinitions('ep-1');
      expect(result).toEqual([coreDef, extDef]);
    });
  });

  describe('getBooleanKeys', () => {
    it('should return empty set when no schemas registered', () => {
      mockRegistry.getSchema.mockReturnValue(null);
      expect(helpers.getBooleanKeys('ep-1').size).toBe(0);
    });
  });

  describe('getReturnedCharacteristics', () => {
    it('should return never and request sets', () => {
      mockRegistry.getSchema.mockReturnValue(null);
      const result = helpers.getReturnedCharacteristics('ep-1');
      expect(result).toHaveProperty('never');
      expect(result).toHaveProperty('request');
      expect(result.never).toBeInstanceOf(Set);
      expect(result.request).toBeInstanceOf(Set);
    });
  });

  describe('getRequestOnlyAttributes', () => {
    it('should return the request set from characteristics', () => {
      mockRegistry.getSchema.mockReturnValue(null);
      const result = helpers.getRequestOnlyAttributes('ep-1');
      expect(result).toBeInstanceOf(Set);
    });
  });

  describe('coerceBooleanStringsIfEnabled', () => {
    it('should coerce when default (flag not set = true)', () => {
      // Default is true via getConfigBooleanWithDefault
      const dto: Record<string, unknown> = {};
      // No boolean keys from empty registry so no mutations
      helpers.coerceBooleanStringsIfEnabled(dto, 'ep-1');
      // No error
    });

    it('should skip when flag is explicitly false', () => {
      const config = { AllowAndCoerceBooleanStrings: 'false' } as any;
      const dto: Record<string, unknown> = { active: 'True' };
      helpers.coerceBooleanStringsIfEnabled(dto, 'ep-1', config);
      expect(dto.active).toBe('True'); // Not coerced
    });
  });

  describe('validatePayloadSchema', () => {
    it('should do nothing when strict mode is off', () => {
      const dto = { schemas: [CORE_URN] };
      // No throw
      helpers.validatePayloadSchema(dto, 'ep-1', undefined, 'create');
    });
  });

  describe('checkImmutableAttributes', () => {
    it('should do nothing when strict mode is off', () => {
      const existing = { displayName: 'Alice' };
      const incoming = { displayName: 'Bob' };
      // No throw — strict mode is off
      helpers.checkImmutableAttributes(existing, incoming, 'ep-1');
    });
  });
});
