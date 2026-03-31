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
  sanitizeBooleanStringsByParent,
  guardSoftDeleted,
  ScimSchemaHelpers,
  stripReadOnlyAttributes,
  stripReadOnlyPatchOps,
  SCIM_WARNING_URN,
  flattenParentChildMap,
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
      expect(result).toEqual([{ ...coreDef, isCoreSchema: true }, extDef]);
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
      expect(mockRegistry.getExtensionUrns).toHaveBeenCalled();
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
      expect(result).toEqual([{ ...coreDef, isCoreSchema: true }, extDef]);
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

  describe('getRequestReturnedByParent', () => {
    it('should return the request set from characteristics', () => {
      mockRegistry.getSchema.mockReturnValue(null);
      const result = helpers.getRequestReturnedByParent('ep-1');
      expect(result).toBeInstanceOf(Map);
    });
  });

  describe('validatePayloadSchema', () => {
    it('should do nothing when strict mode is off', () => {
      const dto = { schemas: [CORE_URN] };
      // No throw
      helpers.validatePayloadSchema(dto, 'ep-1', undefined, 'create');
    });

    it('should throw 400 for unknown attribute when strict mode is on', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const config = { StrictSchemaValidation: 'true' } as any;
      const dto = { schemas: [CORE_URN], userName: 'alice', unknownField: 'bad' } as Record<string, unknown>;

      expect(() => helpers.validatePayloadSchema(dto, 'ep-1', config, 'create')).toThrow();
      try {
        helpers.validatePayloadSchema(dto, 'ep-1', config, 'create');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
      }
    });

    it('should pass for valid payload when strict mode is on', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const config = { StrictSchemaValidation: 'true' } as any;
      const dto = { schemas: [CORE_URN], userName: 'alice', displayName: 'Alice' } as Record<string, unknown>;

      expect(() => helpers.validatePayloadSchema(dto, 'ep-1', config, 'create')).not.toThrow();
    });
  });

  describe('checkImmutableAttributes', () => {
    it('should do nothing when strict mode is off', () => {
      const existing = { displayName: 'Alice' };
      const incoming = { displayName: 'Bob' };
      // No throw — strict mode is off
      helpers.checkImmutableAttributes(existing, incoming, 'ep-1');
    });

    it('should throw 400 when immutable attribute is changed with strict mode on', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'immutable' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const config = { StrictSchemaValidation: 'true' } as any;
      const existing = { schemas: [CORE_URN], userName: 'alice' };
      const incoming = { schemas: [CORE_URN], userName: 'bob' }; // changed immutable!

      expect(() => helpers.checkImmutableAttributes(existing, incoming, 'ep-1', config)).toThrow();
      try {
        helpers.checkImmutableAttributes(existing, incoming, 'ep-1', config);
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        expect(e.getResponse().scimType).toBe('mutability');
      }
    });

    it('should not throw when immutable attribute is unchanged with strict mode on', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'immutable' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const config = { StrictSchemaValidation: 'true' } as any;
      const existing = { schemas: [CORE_URN], userName: 'alice' };
      const incoming = { schemas: [CORE_URN], userName: 'alice', displayName: 'Alice Updated' };

      expect(() => helpers.checkImmutableAttributes(existing, incoming, 'ep-1', config)).not.toThrow();
    });
  });

  describe('validateFilterPaths', () => {
    it('should not throw when filter is empty or schemas are missing', () => {
      mockRegistry.getSchema.mockReturnValue(null);
      expect(() => helpers.validateFilterPaths('userName eq "test"', 'ep-1')).not.toThrow();
    });

    it('should not throw for valid core attribute paths', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);
      expect(() => helpers.validateFilterPaths('userName eq "test"', 'ep-1')).not.toThrow();
    });

    it('should throw 400 invalidFilter for unknown attribute paths', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);
      try {
        helpers.validateFilterPaths('unknownAttr eq "test"', 'ep-1');
        fail('Expected 400');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        expect(e.getResponse().scimType).toBe('invalidFilter');
      }
    });

    it('should not throw for malformed filter (syntax errors handled elsewhere)', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);
      // Malformed filter - parseScimFilter will throw, validateFilterPaths catches and returns
      expect(() => helpers.validateFilterPaths('not a valid filter !!!', 'ep-1')).not.toThrow();
    });

    it('should allow reserved paths like id and externalId', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);
      expect(() => helpers.validateFilterPaths('id eq "abc"', 'ep-1')).not.toThrow();
      expect(() => helpers.validateFilterPaths('externalId eq "ext-1"', 'ep-1')).not.toThrow();
    });

    it('should allow meta sub-attribute paths', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);
      expect(() => helpers.validateFilterPaths('meta.created gt "2025-01-01"', 'ep-1')).not.toThrow();
    });
  });
});

// ─── SCIM_WARNING_URN constant ──────────────────────────────────────────────

describe('SCIM_WARNING_URN', () => {
  it('should be the expected string', () => {
    expect(SCIM_WARNING_URN).toBe('urn:scimserver:api:messages:2.0:Warning');
  });
});

// ─── stripReadOnlyAttributes ────────────────────────────────────────────────

describe('stripReadOnlyAttributes', () => {
  const coreSchema = {
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    attributes: [
      { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
      { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
      { name: 'groups', type: 'complex', multiValued: true, required: false, mutability: 'readOnly' },
      { name: 'id', type: 'string', multiValued: false, required: true, mutability: 'readOnly' },
      { name: 'meta', type: 'complex', multiValued: false, required: false, mutability: 'readOnly' },
    ],
  } as const;

  const extensionSchema = {
    id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
    attributes: [
      { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
      { name: 'computedScore', type: 'integer', multiValued: false, required: false, mutability: 'readOnly' },
    ],
  } as const;

  it('should strip core readOnly attributes (id, meta, groups)', () => {
    const payload: Record<string, unknown> = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: 'client-supplied-id',
      userName: 'alice@example.com',
      groups: [{ value: 'g1' }],
      meta: { resourceType: 'User' },
    };

    const stripped = stripReadOnlyAttributes(payload, [coreSchema]);

    expect(stripped).toContain('id');
    expect(stripped).toContain('groups');
    expect(stripped).toContain('meta');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('groups');
    expect(payload).not.toHaveProperty('meta');
    // schemas is never stripped
    expect(payload).toHaveProperty('schemas');
    // readWrite attrs preserved
    expect(payload).toHaveProperty('userName');
  });

  it('should not strip readWrite attributes', () => {
    const payload: Record<string, unknown> = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'bob@example.com',
      displayName: 'Bob',
    };

    const stripped = stripReadOnlyAttributes(payload, [coreSchema]);

    expect(stripped).toHaveLength(0);
    expect(payload.userName).toBe('bob@example.com');
    expect(payload.displayName).toBe('Bob');
  });

  it('should strip readOnly attributes from extension URN blocks', () => {
    const payload: Record<string, unknown> = {
      schemas: [
        'urn:ietf:params:scim:schemas:core:2.0:User',
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      ],
      userName: 'alice@example.com',
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
        department: 'Engineering',
        computedScore: 42,
      },
    };

    const stripped = stripReadOnlyAttributes(payload, [coreSchema, extensionSchema]);

    expect(stripped).toContain('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.computedScore');
    const ext = payload['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
    expect(ext).toHaveProperty('department');
    expect(ext).not.toHaveProperty('computedScore');
  });

  it('should return empty array when no readOnly attributes present', () => {
    const payload: Record<string, unknown> = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'carol@example.com',
    };

    const stripped = stripReadOnlyAttributes(payload, [coreSchema]);
    expect(stripped).toHaveLength(0);
  });

  it('should perform case-insensitive matching', () => {
    const payload: Record<string, unknown> = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      ID: 'client-id',
      Groups: [{ value: 'g1' }],
      userName: 'alice@example.com',
    };

    const stripped = stripReadOnlyAttributes(payload, [coreSchema]);

    expect(stripped).toContain('ID');
    expect(stripped).toContain('Groups');
    expect(payload).not.toHaveProperty('ID');
    expect(payload).not.toHaveProperty('Groups');
  });

  // ─── R-MUT-2: readOnly sub-attributes within readWrite parents ──────

  describe('R-MUT-2: readOnly sub-attrs within readWrite parents', () => {
    const schemaWithReadOnlySubs = {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        {
          name: 'manager',
          type: 'complex',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
            { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readOnly' },
            { name: '$ref', type: 'reference', multiValued: false, required: false, mutability: 'readOnly' },
          ],
        },
        {
          name: 'emails',
          type: 'complex',
          multiValued: true,
          required: false,
          mutability: 'readWrite',
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
            { name: 'display', type: 'string', multiValued: false, required: false, mutability: 'readOnly' },
            { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
          ],
        },
      ],
    } as const;

    it('should strip readOnly sub-attrs from single complex parent (manager.displayName)', () => {
      const payload: Record<string, unknown> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'alice@example.com',
        manager: { value: 'mgr-1', displayName: 'Boss Man', $ref: 'https://example.com/Users/mgr-1' },
      };

      const stripped = stripReadOnlyAttributes(payload, [schemaWithReadOnlySubs]);

      expect(stripped).toContain('manager.displayName');
      expect(stripped).toContain('manager.$ref');
      const mgr = payload.manager as Record<string, unknown>;
      expect(mgr).toHaveProperty('value', 'mgr-1');
      expect(mgr).not.toHaveProperty('displayName');
      expect(mgr).not.toHaveProperty('$ref');
    });

    it('should strip readOnly sub-attrs from multi-valued complex parent (emails[].display)', () => {
      const payload: Record<string, unknown> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'alice@example.com',
        emails: [
          { value: 'a@work.com', type: 'work', display: 'Work Email' },
          { value: 'a@home.com', type: 'home', display: 'Home Email' },
        ],
      };

      const stripped = stripReadOnlyAttributes(payload, [schemaWithReadOnlySubs]);

      expect(stripped).toContain('emails[].display');
      const emails = payload.emails as Array<Record<string, unknown>>;
      expect(emails[0]).not.toHaveProperty('display');
      expect(emails[1]).not.toHaveProperty('display');
      // readWrite sub-attrs preserved
      expect(emails[0]).toHaveProperty('value', 'a@work.com');
      expect(emails[0]).toHaveProperty('type', 'work');
    });

    it('should not strip readWrite sub-attrs', () => {
      const payload: Record<string, unknown> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'alice@example.com',
        manager: { value: 'mgr-1' },
      };

      const stripped = stripReadOnlyAttributes(payload, [schemaWithReadOnlySubs]);

      expect(stripped).toHaveLength(0);
      expect((payload.manager as Record<string, unknown>).value).toBe('mgr-1');
    });

    const extensionWithReadOnlySubs = {
      id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      attributes: [
        {
          name: 'orgUnit',
          type: 'complex',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
            { name: 'computedPath', type: 'string', multiValued: false, required: false, mutability: 'readOnly' },
          ],
        },
      ],
    } as const;

    it('should strip readOnly sub-attrs from extension URN complex parent', () => {
      const payload: Record<string, unknown> = {
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        ],
        userName: 'alice@example.com',
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
          orgUnit: { value: 'eng-1', computedPath: '/org/eng' },
        },
      };

      const stripped = stripReadOnlyAttributes(payload, [schemaWithReadOnlySubs, extensionWithReadOnlySubs]);

      expect(stripped).toContain('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.orgUnit.computedPath');
      const ext = payload['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
      const orgUnit = ext.orgUnit as Record<string, unknown>;
      expect(orgUnit).toHaveProperty('value', 'eng-1');
      expect(orgUnit).not.toHaveProperty('computedPath');
    });
  });
});

// ─── stripReadOnlyPatchOps ──────────────────────────────────────────────────

describe('stripReadOnlyPatchOps', () => {
  const coreSchema = {
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    attributes: [
      { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
      { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
      { name: 'groups', type: 'complex', multiValued: true, required: false, mutability: 'readOnly' },
      { name: 'id', type: 'string', multiValued: false, required: true, mutability: 'readOnly' },
      { name: 'meta', type: 'complex', multiValued: false, required: false, mutability: 'readOnly' },
    ],
  } as const;

  it('should strip path-based ops targeting readOnly attributes', () => {
    const ops = [
      { op: 'replace', path: 'groups', value: [{ value: 'g2' }] },
      { op: 'replace', path: 'userName', value: 'alice@example.com' },
    ];

    const { filtered, stripped } = stripReadOnlyPatchOps(ops, [coreSchema]);

    expect(stripped).toEqual(['groups']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe('userName');
  });

  it('should NEVER strip ops targeting id (for G8c hard-reject)', () => {
    const ops = [
      { op: 'replace', path: 'id', value: 'new-id' },
    ];

    const { filtered, stripped } = stripReadOnlyPatchOps(ops, [coreSchema]);

    expect(stripped).toHaveLength(0);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe('id');
  });

  it('should strip readOnly keys from no-path replace ops', () => {
    const ops = [
      {
        op: 'replace',
        value: {
          userName: 'alice@example.com',
          groups: [{ value: 'g2' }],
          displayName: 'Alice',
          meta: { resourceType: 'User' },
        },
      },
    ];

    const { filtered, stripped } = stripReadOnlyPatchOps(ops, [coreSchema]);

    expect(stripped).toContain('groups');
    expect(stripped).toContain('meta');
    expect(filtered).toHaveLength(1);
    const val = filtered[0].value as Record<string, unknown>;
    expect(val).toHaveProperty('userName');
    expect(val).toHaveProperty('displayName');
    expect(val).not.toHaveProperty('groups');
    expect(val).not.toHaveProperty('meta');
  });

  it('should keep id in no-path ops for G8c rejection', () => {
    const ops = [
      {
        op: 'replace',
        value: {
          id: 'new-id',
          userName: 'alice@example.com',
        },
      },
    ];

    const { filtered, stripped } = stripReadOnlyPatchOps(ops, [coreSchema]);

    expect(stripped).toHaveLength(0);
    expect(filtered).toHaveLength(1);
    const val = filtered[0].value as Record<string, unknown>;
    expect(val).toHaveProperty('id');
    expect(val).toHaveProperty('userName');
  });

  it('should strip entire no-path op if all keys are readOnly', () => {
    const ops = [
      {
        op: 'replace',
        value: {
          groups: [{ value: 'g2' }],
          meta: { resourceType: 'User' },
        },
      },
    ];

    const { filtered, stripped } = stripReadOnlyPatchOps(ops, [coreSchema]);

    expect(stripped).toContain('groups');
    expect(stripped).toContain('meta');
    expect(filtered).toHaveLength(0);
  });

  it('should pass through ops on readWrite attributes unchanged', () => {
    const ops = [
      { op: 'replace', path: 'userName', value: 'bob@example.com' },
      { op: 'add', path: 'displayName', value: 'Bob' },
    ];

    const { filtered, stripped } = stripReadOnlyPatchOps(ops, [coreSchema]);

    expect(stripped).toHaveLength(0);
    expect(filtered).toHaveLength(2);
  });

  it('should pass through ops with array values unchanged', () => {
    const ops = [
      { op: 'add', value: ['some-value'] },
    ];

    const { filtered, stripped } = stripReadOnlyPatchOps(ops, [coreSchema]);

    expect(stripped).toHaveLength(0);
    expect(filtered).toHaveLength(1);
  });

  // ─── R-MUT-2: readOnly sub-attr stripping in PATCH ops ─────────────

  describe('R-MUT-2: readOnly sub-attrs in PATCH ops', () => {
    const schemaWithSubs = {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        {
          name: 'manager',
          type: 'complex',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
            { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readOnly' },
          ],
        },
        { name: 'id', type: 'string', multiValued: false, required: true, mutability: 'readOnly' },
      ],
    } as const;

    it('should strip path-based ops targeting readOnly sub-attr (manager.displayName)', () => {
      const ops = [
        { op: 'replace', path: 'manager.displayName', value: 'New Boss' },
        { op: 'replace', path: 'manager.value', value: 'mgr-2' },
      ];

      const { filtered, stripped } = stripReadOnlyPatchOps(ops, [schemaWithSubs]);

      expect(stripped).toEqual(['manager.displayName']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].path).toBe('manager.value');
    });

    it('should strip readOnly sub-attr keys from no-path replace ops with complex value', () => {
      const ops = [
        {
          op: 'replace',
          value: {
            userName: 'alice@example.com',
            manager: { value: 'mgr-2', displayName: 'New Boss' },
          },
        },
      ];

      const { filtered, stripped } = stripReadOnlyPatchOps(ops, [schemaWithSubs]);

      expect(stripped).toContain('manager.displayName');
      expect(filtered).toHaveLength(1);
      const val = filtered[0].value as Record<string, unknown>;
      const mgr = val.manager as Record<string, unknown>;
      expect(mgr).toHaveProperty('value', 'mgr-2');
      expect(mgr).not.toHaveProperty('displayName');
    });

    it('should pass through readWrite sub-attrs unchanged', () => {
      const ops = [
        { op: 'replace', path: 'manager.value', value: 'mgr-3' },
      ];

      const { filtered, stripped } = stripReadOnlyPatchOps(ops, [schemaWithSubs]);

      expect(stripped).toHaveLength(0);
      expect(filtered).toHaveLength(1);
    });
  });
});

// ─── sanitizeBooleanStringsByParent — Parent-context-aware coercion ─────────

describe('sanitizeBooleanStringsByParent', () => {
  const CORE_URN = 'urn:ietf:params:scim:schemas:core:2.0:user';

  // Simulates rfc-standard schema: active (boolean) at top, primary (boolean) in emails/roles
  const boolMap = new Map<string, Set<string>>([
    [CORE_URN, new Set(['active'])],
    [`${CORE_URN}.emails`, new Set(['primary'])],
    [`${CORE_URN}.roles`, new Set(['primary'])],
    [`${CORE_URN}.addresses`, new Set(['primary'])],
  ]);

  it('should coerce top-level boolean string', () => {
    const obj: Record<string, unknown> = { active: 'True', userName: 'jdoe@test.com' };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect(obj.active).toBe(true);
    expect(obj.userName).toBe('jdoe@test.com');
  });

  it('should coerce boolean inside array elements (emails[].primary)', () => {
    const obj: Record<string, unknown> = {
      emails: [
        { value: 'a@b.com', primary: 'True', type: 'work' },
        { value: 'c@d.com', primary: 'False' },
      ],
    };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect((obj.emails as any[])[0].primary).toBe(true);
    expect((obj.emails as any[])[1].primary).toBe(false);
  });

  it('should coerce boolean inside roles[].primary', () => {
    const obj: Record<string, unknown> = {
      roles: [{ value: 'admin', primary: 'True', type: 'work' }],
    };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect((obj.roles as any[])[0].primary).toBe(true);
  });

  it('should NOT coerce string value that matches boolean name in wrong parent', () => {
    // roles[].value = "true" — value is NOT in boolMap for "roles" parent
    const obj: Record<string, unknown> = {
      roles: [{ value: 'true', primary: 'True' }],
    };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect((obj.roles as any[])[0].value).toBe('true'); // string preserved
    expect((obj.roles as any[])[0].primary).toBe(true); // boolean coerced
  });

  it('should NOT coerce "active" inside extension object when not in extension map', () => {
    // Extension has active as string — not in boolMap under its URN key
    const obj: Record<string, unknown> = {
      active: 'True',
      'urn:custom:ext': { active: 'True' },
    };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect(obj.active).toBe(true); // core: coerced
    expect((obj['urn:custom:ext'] as any).active).toBe('True'); // extension: NOT coerced (no entry in boolMap for this parent)
  });

  it('should coerce extension boolean when extension key IS in map', () => {
    const extMap = new Map<string, Set<string>>([
      [CORE_URN, new Set(['active'])],
      ['urn:ext:2.0:user', new Set(['enabled'])],
    ]);
    const obj: Record<string, unknown> = {
      active: 'False',
      'urn:ext:2.0:User': { enabled: 'True' },
    };
    sanitizeBooleanStringsByParent(obj, extMap, CORE_URN);
    expect(obj.active).toBe(false);
    expect((obj['urn:ext:2.0:User'] as any).enabled).toBe(true);
  });

  it('should handle empty boolMap (no coercion)', () => {
    const obj: Record<string, unknown> = { active: 'True' };
    sanitizeBooleanStringsByParent(obj, new Map(), CORE_URN);
    expect(obj.active).toBe('True'); // not coerced
  });

  it('should handle deeply nested complex attributes', () => {
    const obj: Record<string, unknown> = {
      name: { formatted: 'John', givenName: 'John' },
      emails: [{ value: 'a@b.com', primary: 'true' }],
    };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect((obj.name as any).formatted).toBe('John'); // untouched
    expect((obj.emails as any[])[0].primary).toBe(true); // coerced
  });

  it('should handle case-insensitive "false"/"FALSE"', () => {
    const obj: Record<string, unknown> = { active: 'FALSE' };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect(obj.active).toBe(false);
  });

  it('should not coerce non-true/false string values', () => {
    const obj: Record<string, unknown> = { active: 'yes' };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect(obj.active).toBe('yes'); // not "true"/"false" — untouched
  });

  it('should handle addresses[].primary', () => {
    const obj: Record<string, unknown> = {
      addresses: [{ type: 'work', primary: 'True', formatted: 'addr' }],
    };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect((obj.addresses as any[])[0].primary).toBe(true);
    expect((obj.addresses as any[])[0].formatted).toBe('addr');
  });
});

// ─── flattenParentChildMap ──────────────────────────────────────────────

describe('flattenParentChildMap', () => {
  it('should union all children across parent keys into flat set', () => {
    const map = new Map<string, Set<string>>([
      ['__top__', new Set(['active', 'password'])],
      ['emails', new Set(['primary'])],
    ]);
    const flat = flattenParentChildMap(map);
    expect(flat.has('active')).toBe(true);
    expect(flat.has('password')).toBe(true);
    expect(flat.has('primary')).toBe(true);
    expect(flat.size).toBe(3);
  });

  it('should return empty set for empty map', () => {
    const flat = flattenParentChildMap(new Map());
    expect(flat.size).toBe(0);
  });

  it('should handle duplicate names across parents (union semantics)', () => {
    const map = new Map<string, Set<string>>([
      ['__top__', new Set(['active'])],
      ['urn:ext:schema', new Set(['active'])], // same name, different parent
    ]);
    const flat = flattenParentChildMap(map);
    expect(flat.has('active')).toBe(true);
    expect(flat.size).toBe(1); // union — no duplicates
  });

  it('should handle single parent with multiple children', () => {
    const map = new Map<string, Set<string>>([
      ['meta', new Set(['resourcetype', 'created', 'lastmodified', 'location', 'version'])],
    ]);
    const flat = flattenParentChildMap(map);
    expect(flat.size).toBe(5);
  });
});

// ─── stripReadOnlyAttributes with preCollected ──────────────────────────

describe('stripReadOnlyAttributes with preCollected', () => {
  const coreSchema = {
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    attributes: [
      { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
      { name: 'id', type: 'string', multiValued: false, required: true, mutability: 'readOnly' },
      { name: 'meta', type: 'complex', multiValued: false, required: false, mutability: 'readOnly' },
    ],
  } as const;

  it('should produce identical results with and without preCollected', () => {
    const payload1 = { schemas: ['core'], id: 'x', userName: 'alice', meta: { resourceType: 'User' } } as Record<string, unknown>;
    const payload2 = { ...payload1 };

    // Without preCollected
    const stripped1 = stripReadOnlyAttributes(payload1, [coreSchema]);

    // With preCollected
    const { core, extensions, coreSubAttrs, extensionSubAttrs } = require('../../../domain/validation').SchemaValidator.collectReadOnlyAttributes([coreSchema]);
    const stripped2 = stripReadOnlyAttributes(payload2, [coreSchema], { core, extensions, coreSubAttrs, extensionSubAttrs });

    expect(stripped1.sort()).toEqual(stripped2.sort());
  });
});