/**
 * Unit tests for shared SCIM service helpers (G17 - Service Deduplication).
 *
 * Tests cover:
 *  - parseJson: safe JSON parsing with fallback
 *  - ensureSchema: schema URN validation
 *  - enforceIfMatch: ETag/If-Match enforcement
 *  - coercePatchOpBooleans: PATCH operation boolean coercion
 *  - stripNeverReturnedFromPayload: never-returned attribute stripping
 *  - ScimSchemaHelpers: parameterized schema-aware methods
 */

import { HttpException } from '@nestjs/common';
import {
  parseJson,
  ensureSchema,
  enforceIfMatch,
  sanitizeBooleanStringsByParent,
  coercePatchOpBooleans,
  stripNeverReturnedFromPayload,
  ScimSchemaHelpers,
  stripReadOnlyAttributes,
  stripReadOnlyPatchOps,
  SCIM_WARNING_URN,
  flattenParentChildMap,
  assertSchemaUniqueness,
} from './scim-service-helpers';
import { SCIM_DIAGNOSTICS_URN } from './scim-constants';

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

  it('should log console.warn for invalid JSON', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    parseJson('not json');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('parseJson'),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it('should not log console.warn for null/undefined/empty', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    parseJson(null);
    parseJson(undefined);
    parseJson('');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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

  it('should include currentETag in 428 diagnostics', () => {
    const config = { RequireIfMatch: 'true' } as any;
    try {
      enforceIfMatch(5, undefined, config);
      fail('should have thrown');
    } catch (e: any) {
      const body = e.getResponse();
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
      expect(body[SCIM_DIAGNOSTICS_URN].currentETag).toBe('W/"v5"');
      expect(body[SCIM_DIAGNOSTICS_URN].triggeredBy).toBe('RequireIfMatch');
    }
  });

  it('should not throw 428 when RequireIfMatch is false and no If-Match', () => {
    const config = { RequireIfMatch: 'false' } as any;
    expect(() => enforceIfMatch(3, undefined, config)).not.toThrow();
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

    it('should return ONLY User extensions when coreSchemaUrn is User (multi-RT profile)', () => {
      const USER_CORE = 'urn:ietf:params:scim:schemas:core:2.0:User';
      const GROUP_CORE = 'urn:ietf:params:scim:schemas:core:2.0:Group';
      const USER_EXT = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const USER_EXT2 = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User';
      const GROUP_EXT = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group';

      const mockContext = {
        getProfile: () => ({
          schemas: [],
          settings: {},
          resourceTypes: [
            { id: 'User', name: 'User', schema: USER_CORE, endpoint: '/Users', description: 'User',
              schemaExtensions: [{ schema: USER_EXT, required: false }, { schema: USER_EXT2, required: false }] },
            { id: 'Group', name: 'Group', schema: GROUP_CORE, endpoint: '/Groups', description: 'Group',
              schemaExtensions: [{ schema: GROUP_EXT, required: false }] },
          ],
          serviceProviderConfig: {},
        }),
        getConfig: () => ({}),
      } as any;

      const userHelpers = new ScimSchemaHelpers(mockRegistry, USER_CORE, mockContext);
      const result = userHelpers.getExtensionUrns();

      expect(result).toContain(USER_EXT);
      expect(result).toContain(USER_EXT2);
      expect(result).not.toContain(GROUP_EXT);
      expect(result).toHaveLength(2);
    });

    it('should return ONLY Group extensions when coreSchemaUrn is Group (multi-RT profile)', () => {
      const USER_CORE = 'urn:ietf:params:scim:schemas:core:2.0:User';
      const GROUP_CORE = 'urn:ietf:params:scim:schemas:core:2.0:Group';
      const USER_EXT = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const GROUP_EXT = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group';
      const GROUP_EXT2 = 'urn:ietf:params:scim:schemas:extension:msfttest:Group';

      const mockContext = {
        getProfile: () => ({
          schemas: [],
          settings: {},
          resourceTypes: [
            { id: 'User', name: 'User', schema: USER_CORE, endpoint: '/Users', description: 'User',
              schemaExtensions: [{ schema: USER_EXT, required: false }] },
            { id: 'Group', name: 'Group', schema: GROUP_CORE, endpoint: '/Groups', description: 'Group',
              schemaExtensions: [{ schema: GROUP_EXT, required: false }, { schema: GROUP_EXT2, required: false }] },
          ],
          serviceProviderConfig: {},
        }),
        getConfig: () => ({}),
      } as any;

      const groupHelpers = new ScimSchemaHelpers(mockRegistry, GROUP_CORE, mockContext);
      const result = groupHelpers.getExtensionUrns();

      expect(result).toContain(GROUP_EXT);
      expect(result).toContain(GROUP_EXT2);
      expect(result).not.toContain(USER_EXT);
      expect(result).toHaveLength(2);
    });

    it('should fall back to global registry when no profile RTs match coreSchemaUrn', () => {
      const CUSTOM_CORE = 'urn:custom:FooResource';
      const mockContext = {
        getProfile: () => ({
          schemas: [],
          settings: {},
          resourceTypes: [
            { id: 'User', name: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', endpoint: '/Users', description: 'User',
              schemaExtensions: [{ schema: EXT_URN, required: false }] },
          ],
          serviceProviderConfig: {},
        }),
        getConfig: () => ({}),
      } as any;

      mockRegistry.getExtensionUrns.mockReturnValue(['urn:global:fallback']);
      const customHelpers = new ScimSchemaHelpers(mockRegistry, CUSTOM_CORE, mockContext);
      const result = customHelpers.getExtensionUrns();

      expect(result).toEqual(['urn:global:fallback']);
      expect(mockRegistry.getExtensionUrns).toHaveBeenCalled();
    });

    it('should use cached extensionUrns when _schemaCaches has valid Map', () => {
      const USER_CORE = 'urn:ietf:params:scim:schemas:core:2.0:User';
      const CACHED_EXT = 'urn:cached:extension';

      const mockContext = {
        getProfile: () => ({
          schemas: [],
          settings: {},
          resourceTypes: [],
          serviceProviderConfig: {},
          _schemaCaches: {
            [USER_CORE]: {
              booleansByParent: new Map(), // instanceof Map → cache hit
              extensionUrns: [CACHED_EXT],
            },
          },
        }),
        getConfig: () => ({}),
      } as any;

      const cachedHelpers = new ScimSchemaHelpers(mockRegistry, USER_CORE, mockContext);
      const result = cachedHelpers.getExtensionUrns();

      expect(result).toEqual([CACHED_EXT]);
      // Should NOT call the registry since cache was hit
      expect(mockRegistry.getExtensionUrns).not.toHaveBeenCalled();
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

  describe('getRequestReturnedByParent', () => {
    it('should return the request set from characteristics', () => {
      mockRegistry.getSchema.mockReturnValue(null);
      const result = helpers.getRequestReturnedByParent('ep-1');
      expect(result).toBeInstanceOf(Map);
    });
  });

  describe('validatePayloadSchema', () => {
    it('should enforce required attrs even when StrictSchemaValidation is explicitly false on create (G2)', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const config = { StrictSchemaValidation: 'false' } as any;
      const dto = { schemas: [CORE_URN], displayName: 'Alice' } as Record<string, unknown>; // missing userName

      // G2: required should be enforced unconditionally (RFC 7643 §2.4 "MUST")
      expect(() => helpers.validatePayloadSchema(dto, 'ep-1', config, 'create')).toThrow();
      try {
        helpers.validatePayloadSchema(dto, 'ep-1', config, 'create');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        expect(e.getResponse().detail).toContain("'userName' is missing");
      }
    });

    it('should allow unknown attrs when strict is off (type/unknown remains gated)', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const config = { StrictSchemaValidation: 'false' } as any;
      const dto = { schemas: [CORE_URN], userName: 'alice', unknownField: 'bad' } as Record<string, unknown>;

      // Unknown attrs should NOT throw when strict is off - only required is enforced
      expect(() => helpers.validatePayloadSchema(dto, 'ep-1', config, 'create')).not.toThrow();
    });

    it('should skip validation entirely for PATCH when strict is off', () => {
      const dto = { schemas: [CORE_URN] };
      // No throw - PATCH with strict OFF skips everything
      helpers.validatePayloadSchema(dto, 'ep-1', { StrictSchemaValidation: 'false' } as any, 'patch');
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
    it('should enforce immutable even when StrictSchemaValidation is explicitly false (G1)', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'immutable' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const config = { StrictSchemaValidation: 'false' } as any;
      const existing = { schemas: [CORE_URN], userName: 'alice' };
      const incoming = { schemas: [CORE_URN], userName: 'bob' };
      // G1: immutable should be enforced unconditionally (RFC 7643 §2.2 "SHALL NOT")
      // Even when StrictSchemaValidation is explicitly false
      expect(() => helpers.checkImmutableAttributes(existing, incoming, 'ep-1', config)).toThrow();
      try {
        helpers.checkImmutableAttributes(existing, incoming, 'ep-1', config);
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        expect(e.getResponse().scimType).toBe('mutability');
      }
    });

    it('should not throw when no schemas in payload (no-op fallback)', () => {
      const existing = { displayName: 'Alice' };
      const incoming = { displayName: 'Bob' };
      // No schemas[] → can't resolve schema → no-op
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

    it('should include attributePath in diagnostics for immutable violation', () => {
      const coreDef = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'immutable' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(coreDef);

      const existing = { schemas: [CORE_URN], userName: 'alice' };
      const incoming = { schemas: [CORE_URN], userName: 'bob' };

      try {
        helpers.checkImmutableAttributes(existing, incoming, 'ep-1');
        fail('should have thrown');
      } catch (e: any) {
        const diag = e.getResponse()[SCIM_DIAGNOSTICS_URN];
        expect(diag).toBeDefined();
        expect(diag.attributePath).toBe('userName');
        expect(diag.errorCode).toBe('VALIDATION_IMMUTABLE');
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

  // ─── G8h: enforcePrimaryConstraint ──────────────────────────────────────

  describe('enforcePrimaryConstraint', () => {
    const coreSchemaWithEmails = {
      id: CORE_URN,
      name: 'User',
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        {
          name: 'emails',
          type: 'complex',
          multiValued: true,
          required: false,
          mutability: 'readWrite',
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
            { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
            { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
          ],
        },
        {
          name: 'phoneNumbers',
          type: 'complex',
          multiValued: true,
          required: false,
          mutability: 'readWrite',
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
            { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
          ],
        },
      ],
    };

    beforeEach(() => {
      mockRegistry.getSchema.mockReturnValue(coreSchemaWithEmails);
      mockRegistry.getExtensionUrns.mockReturnValue([]);
    });

    // Test 1: Single primary=true - no mutation
    it('should not mutate when only one primary=true exists (normalize)', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', type: 'work', primary: true },
          { value: 'b@x.com', type: 'home', primary: false },
        ],
      };
      helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' });
      expect((payload.emails as any[])[0].primary).toBe(true);
      expect((payload.emails as any[])[1].primary).toBe(false);
    });

    // Test 2: Zero primaries - no mutation
    it('should not mutate when no primary=true exists (normalize)', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', type: 'work' },
          { value: 'b@x.com', type: 'home' },
        ],
      };
      helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' });
      expect((payload.emails as any[])[0].primary).toBeUndefined();
      expect((payload.emails as any[])[1].primary).toBeUndefined();
    });

    // Test 3: Multiple primaries - normalize keeps first
    it('should keep first primary=true and set rest to false (normalize)', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', type: 'work', primary: true },
          { value: 'b@x.com', type: 'home', primary: true },
          { value: 'c@x.com', type: 'other', primary: true },
        ],
      };
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' });
      expect((payload.emails as any[])[0].primary).toBe(true);
      expect((payload.emails as any[])[1].primary).toBe(false);
      expect((payload.emails as any[])[2].primary).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[PrimaryEnforcement]'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('emails'));
      warnSpy.mockRestore();
    });

    // Test 4: Multiple primaries - reject throws 400
    it('should throw 400 invalidValue when multiple primaries detected (reject)', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', primary: true },
          { value: 'b@x.com', primary: true },
        ],
      };
      try {
        helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'reject' });
        fail('should have thrown');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        const body = e.getResponse();
        expect(body.scimType).toBe('invalidValue');
        expect(body.detail).toContain('primary');
        expect(body.detail).toContain('emails');
      }
    });

    // Test 5: Multiple primaries - passthrough stores as-is but warns
    it('should not mutate payload when mode is passthrough but log WARN', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', primary: true },
          { value: 'b@x.com', primary: true },
        ],
      };
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'passthrough' });
      expect((payload.emails as any[])[0].primary).toBe(true);
      expect((payload.emails as any[])[1].primary).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[PrimaryEnforcement]'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('emails'));
      warnSpy.mockRestore();
    });

    // Test 6: Multi-attribute independence - each checked separately
    it('should check each multi-valued attribute independently', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', primary: true },
          { value: 'b@x.com', primary: true },
        ],
        phoneNumbers: [
          { value: '+1-555-0100', primary: true },
        ],
      };
      helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' });
      // emails: second primary cleared
      expect((payload.emails as any[])[0].primary).toBe(true);
      expect((payload.emails as any[])[1].primary).toBe(false);
      // phoneNumbers: only one - untouched
      expect((payload.phoneNumbers as any[])[0].primary).toBe(true);
    });

    // Test 7: Empty array - no crash
    it('should handle empty array gracefully', () => {
      const payload: Record<string, unknown> = {
        emails: [],
      };
      expect(() =>
        helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' }),
      ).not.toThrow();
    });

    // Test 8: Non-array value - no crash
    it('should handle non-array value gracefully', () => {
      const payload: Record<string, unknown> = {
        emails: 'not-an-array',
      };
      expect(() =>
        helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' }),
      ).not.toThrow();
    });

    // Test 9: Single entry array - no mutation
    it('should not mutate single-entry array with primary=true', () => {
      const payload: Record<string, unknown> = {
        emails: [{ value: 'a@x.com', primary: true }],
      };
      helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' });
      expect((payload.emails as any[])[0].primary).toBe(true);
    });

    // Test 10: Default mode when flag absent -> passthrough (warn but don't mutate)
    it('should default to passthrough when PrimaryEnforcement is not set', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', primary: true },
          { value: 'b@x.com', primary: true },
        ],
      };
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      helpers.enforcePrimaryConstraint(payload, 'ep-1', undefined);
      // passthrough: both remain true (no mutation)
      expect((payload.emails as any[])[0].primary).toBe(true);
      expect((payload.emails as any[])[1].primary).toBe(true);
      // but should still warn
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[PrimaryEnforcement]'));
      warnSpy.mockRestore();
    });

    // Test 11: Case-insensitive mode parsing
    it('should accept mode values case-insensitively', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { value: 'a@x.com', primary: true },
          { value: 'b@x.com', primary: true },
        ],
      };
      // "REJECT" should work same as "reject"
      try {
        helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'REJECT' });
        fail('should have thrown');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
      }
    });

    // Test 12: Attribute without primary sub-attr is skipped
    it('should skip multi-valued complex attrs without primary sub-attribute', () => {
      const schemaNoEmailPrimary = {
        id: CORE_URN,
        name: 'User',
        attributes: [
          {
            name: 'tags',
            type: 'complex',
            multiValued: true,
            required: false,
            mutability: 'readWrite',
            subAttributes: [
              { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
              { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
              // no primary sub-attribute
            ],
          },
        ],
      };
      mockRegistry.getSchema.mockReturnValue(schemaNoEmailPrimary);

      const payload: Record<string, unknown> = {
        tags: [
          { value: 'tag1' },
          { value: 'tag2' },
        ],
      };
      expect(() =>
        helpers.enforcePrimaryConstraint(payload, 'ep-1', { PrimaryEnforcement: 'normalize' }),
      ).not.toThrow();
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

// ─── sanitizeBooleanStringsByParent - Parent-context-aware coercion ─────────

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
    // roles[].value = "true" - value is NOT in boolMap for "roles" parent
    const obj: Record<string, unknown> = {
      roles: [{ value: 'true', primary: 'True' }],
    };
    sanitizeBooleanStringsByParent(obj, boolMap, CORE_URN);
    expect((obj.roles as any[])[0].value).toBe('true'); // string preserved
    expect((obj.roles as any[])[0].primary).toBe(true); // boolean coerced
  });

  it('should NOT coerce "active" inside extension object when not in extension map', () => {
    // Extension has active as string - not in boolMap under its URN key
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
    expect(obj.active).toBe('yes'); // not "true"/"false" - untouched
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

// ─── coercePatchOpBooleans ──────────────────────────────────────────────

describe('coercePatchOpBooleans', () => {
  const CORE_URN = 'urn:ietf:params:scim:schemas:core:2.0:user';
  const boolMap = new Map<string, Set<string>>([
    [CORE_URN, new Set(['active'])],
    [`${CORE_URN}.emails`, new Set(['primary'])],
  ]);

  it('should coerce boolean strings in object value (no-path replace)', () => {
    const ops = [{ op: 'replace', value: { active: 'True', displayName: 'Test' } }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect((ops[0].value as any).active).toBe(true);
    expect((ops[0].value as any).displayName).toBe('Test');
  });

  it('should coerce boolean strings in array value', () => {
    const ops = [{ op: 'add', value: [{ active: 'False' }, { active: 'True' }] }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect((ops[0].value as any[])[0].active).toBe(false);
    expect((ops[0].value as any[])[1].active).toBe(true);
  });

  it('should NOT coerce scalar non-boolean attribute strings', () => {
    const ops = [{ op: 'replace', path: 'displayName', value: 'True' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe('True');
  });

  it('should handle null/undefined values gracefully', () => {
    const ops = [
      { op: 'remove', path: 'displayName', value: undefined },
      { op: 'remove', path: 'active' },
    ];
    expect(() => coercePatchOpBooleans(ops, boolMap, CORE_URN)).not.toThrow();
  });

  it('should coerce nested complex attrs in object value', () => {
    const ops = [{
      op: 'replace',
      value: { emails: [{ value: 'a@b.com', primary: 'True' }] },
    }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(((ops[0].value as any).emails as any[])[0].primary).toBe(true);
  });

  it('should process multiple operations independently', () => {
    const ops = [
      { op: 'replace', value: { active: 'True' } },
      { op: 'replace', value: { active: 'False' } },
    ];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect((ops[0].value as any).active).toBe(true);
    expect((ops[1].value as any).active).toBe(false);
  });

  it('should not coerce non-boolean attribute strings', () => {
    const ops = [{ op: 'replace', value: { displayName: 'true', active: 'True' } }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect((ops[0].value as any).displayName).toBe('true');
    expect((ops[0].value as any).active).toBe(true);
  });

  it('should handle empty operations array', () => {
    const ops: Array<{ op: string; value?: unknown }> = [];
    expect(() => coercePatchOpBooleans(ops, boolMap, CORE_URN)).not.toThrow();
  });

  // ── Scalar path-based boolean coercion (Entra ID fix) ──────────────

  it('should coerce scalar "True" to true for path:"active"', () => {
    const ops = [{ op: 'Replace', path: 'active', value: 'True' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe(true);
  });

  it('should coerce scalar "False" to false for path:"active"', () => {
    const ops = [{ op: 'Replace', path: 'active', value: 'False' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe(false);
  });

  it('should coerce case-insensitively: "true", "TRUE", "false"', () => {
    const ops1 = [{ op: 'replace', path: 'active', value: 'true' }];
    coercePatchOpBooleans(ops1, boolMap, CORE_URN);
    expect(ops1[0].value).toBe(true);

    const ops2 = [{ op: 'replace', path: 'active', value: 'FALSE' }];
    coercePatchOpBooleans(ops2, boolMap, CORE_URN);
    expect(ops2[0].value).toBe(false);
  });

  it('should NOT coerce scalar string for non-boolean path', () => {
    const ops = [{ op: 'replace', path: 'displayName', value: 'True' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe('True');
  });

  it('should coerce scalar boolean in sub-attribute path with value filter', () => {
    const ops = [{ op: 'replace', path: 'emails[type eq "work"].primary', value: 'True' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe(true);
  });

  it('should NOT coerce scalar for non-boolean sub-attribute path', () => {
    const ops = [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'True' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe('True');
  });

  it('should coerce scalar boolean in extension URN path', () => {
    const EXT_URN_LOWER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user';
    const extBoolMap = new Map<string, Set<string>>([
      [CORE_URN, new Set(['active'])],
      [EXT_URN_LOWER, new Set(['securityenabled'])],
    ]);
    const ops = [{ op: 'Replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:securityEnabled', value: 'False' }];
    coercePatchOpBooleans(ops, extBoolMap, CORE_URN);
    expect(ops[0].value).toBe(false);
  });

  it('should NOT coerce extension path for non-boolean extension attribute', () => {
    const EXT_URN_LOWER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user';
    const extBoolMap = new Map<string, Set<string>>([
      [CORE_URN, new Set(['active'])],
      [EXT_URN_LOWER, new Set(['securityenabled'])],
    ]);
    const ops = [{ op: 'Replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'True' }];
    coercePatchOpBooleans(ops, extBoolMap, CORE_URN);
    expect(ops[0].value).toBe('True');
  });

  it('should coerce scalar boolean with dotted core path (name.givenName would NOT be boolean)', () => {
    // Only boolean sub-attrs should be coerced; name.givenName is string
    const ops = [{ op: 'replace', path: 'name.givenName', value: 'True' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe('True');
  });

  it('should handle mixed scalar and object ops in same batch', () => {
    const ops = [
      { op: 'Replace', path: 'active', value: 'False' },
      { op: 'Replace', value: { active: 'True', displayName: 'Test' } },
    ];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe(false);
    expect((ops[1].value as any).active).toBe(true);
    expect((ops[1].value as any).displayName).toBe('Test');
  });

  it('should NOT coerce non-true/false string values for boolean path', () => {
    const ops = [{ op: 'replace', path: 'active', value: 'yes' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe('yes');
  });

  it('should NOT coerce scalar when path is missing (handled as object case)', () => {
    // No path, scalar value - not a valid SCIM op but should be safe
    const ops = [{ op: 'replace', value: 'True' }];
    coercePatchOpBooleans(ops, boolMap, CORE_URN);
    expect(ops[0].value).toBe('True');
  });
});

// ─── stripNeverReturnedFromPayload ──────────────────────────────────────

describe('stripNeverReturnedFromPayload', () => {
  const CORE_URN = 'urn:ietf:params:scim:schemas:core:2.0:user';
  const EXT_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

  it('should strip core top-level returned:never attributes', () => {
    const neverByParent = new Map<string, Set<string>>([
      [CORE_URN, new Set(['password'])],
    ]);
    const payload: Record<string, unknown> = {
      userName: 'alice',
      password: 'secret',
      active: true,
    };
    const visible = stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, []);
    expect(payload.password).toBeUndefined();
    expect(payload.userName).toBe('alice');
    expect(payload.active).toBe(true);
    expect(visible).toEqual([]);
  });

  it('should strip core sub-attrs within complex parents', () => {
    const neverByParent = new Map<string, Set<string>>([
      [CORE_URN, new Set(['password'])],  // core top-level entry enables the core block
      [`${CORE_URN}.name`, new Set(['secrethash'])],
    ]);
    const payload: Record<string, unknown> = {
      userName: 'alice',
      name: { givenName: 'Alice', secretHash: 'abc123' },
    };
    stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, []);
    expect((payload.name as any).givenName).toBe('Alice');
    expect((payload.name as any).secretHash).toBeUndefined();
  });

  it('should strip core sub-attrs within multi-valued complex parents', () => {
    const neverByParent = new Map<string, Set<string>>([
      [CORE_URN, new Set(['password'])],  // core top-level entry enables the core block
      [`${CORE_URN}.emails`, new Set(['internalid'])],
    ]);
    const payload: Record<string, unknown> = {
      userName: 'alice',
      emails: [
        { value: 'a@b.com', internalId: 'hidden1' },
        { value: 'c@d.com', internalId: 'hidden2' },
      ],
    };
    stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, []);
    const emails = payload.emails as any[];
    expect(emails[0].value).toBe('a@b.com');
    expect(emails[0].internalId).toBeUndefined();
    expect(emails[1].internalId).toBeUndefined();
  });

  it('should strip extension top-level returned:never attributes', () => {
    const neverByParent = new Map<string, Set<string>>([
      [EXT_URN.toLowerCase(), new Set(['badge'])],
    ]);
    const payload: Record<string, unknown> = {
      userName: 'alice',
      [EXT_URN]: { department: 'Engineering', badge: 'secret-badge' },
    };
    const visible = stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, [EXT_URN]);
    expect((payload[EXT_URN] as any).department).toBe('Engineering');
    expect((payload[EXT_URN] as any).badge).toBeUndefined();
    expect(visible).toEqual([EXT_URN]);
  });

  it('should strip extension sub-attrs when top-level never entry also exists', () => {
    const extUrn = 'urn:test:ext:neversub';
    const neverByParent = new Map<string, Set<string>>([
      [extUrn, new Set(['topsecret'])],  // top-level never entry enables extension block
      [`${extUrn}.credentials`, new Set(['token'])],
    ]);
    const payload: Record<string, unknown> = {
      [extUrn]: { credentials: { token: 'secret', provider: 'oauth' }, topsecret: 'x' },
    };
    const visible = stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, [extUrn]);
    expect((payload[extUrn] as any).credentials.token).toBeUndefined();
    expect((payload[extUrn] as any).credentials.provider).toBe('oauth');
    expect((payload[extUrn] as any).topsecret).toBeUndefined();
    expect(visible).toEqual([extUrn]);
  });

  it('should remove extension entirely if all attrs are stripped (FP-1)', () => {
    const neverByParent = new Map<string, Set<string>>([
      [EXT_URN.toLowerCase(), new Set(['onlyattr'])],
    ]);
    const payload: Record<string, unknown> = {
      userName: 'alice',
      [EXT_URN]: { onlyattr: 'value' },  // use lowercase to match the Set entry
    };
    const visible = stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, [EXT_URN]);
    expect(payload[EXT_URN]).toBeUndefined();
    // FP-1: removed extension should NOT appear in visible URNs
    expect(visible).toEqual([]);
  });

  it('should return extension URNs present in payload that have visible attrs', () => {
    const ext1 = 'urn:test:ext1';
    const ext2 = 'urn:test:ext2';
    const neverByParent = new Map<string, Set<string>>();
    const payload: Record<string, unknown> = {
      [ext1]: { department: 'Eng' },
      // ext2 is NOT in payload
    };
    const visible = stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, [ext1, ext2]);
    expect(visible).toEqual([ext1]);
  });

  it('should handle empty neverByParent map', () => {
    const payload: Record<string, unknown> = {
      userName: 'alice',
      password: 'secret',
    };
    stripNeverReturnedFromPayload(payload, new Map(), CORE_URN, []);
    expect(payload.password).toBe('secret'); // not in map → not stripped
  });

  it('should handle combined core + extension stripping', () => {
    const neverByParent = new Map<string, Set<string>>([
      [CORE_URN, new Set(['password'])],
      [EXT_URN.toLowerCase(), new Set(['badge'])],
    ]);
    const payload: Record<string, unknown> = {
      userName: 'alice',
      password: 'secret',
      [EXT_URN]: { department: 'Eng', badge: 'hidden' },
    };
    const visible = stripNeverReturnedFromPayload(payload, neverByParent, CORE_URN, [EXT_URN]);
    expect(payload.password).toBeUndefined();
    expect((payload[EXT_URN] as any).badge).toBeUndefined();
    expect((payload[EXT_URN] as any).department).toBe('Eng');
    expect(visible).toEqual([EXT_URN]);
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

// ─── handleRepositoryError ──────────────────────────────────────────────────

import { handleRepositoryError } from './scim-service-helpers';
import { RepositoryError } from '../../../domain/errors/repository-error';

describe('handleRepositoryError', () => {
  const mockLogger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should log at ERROR and throw HttpException for RepositoryError NOT_FOUND', () => {
    const repoError = new RepositoryError('NOT_FOUND', 'User with id abc not found');

    expect(() => handleRepositoryError(
      repoError, 'create user', mockLogger, 'scim.user' as any, { endpointId: 'ep-1' },
    )).toThrow(HttpException);

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [category, message, , data] = mockLogger.error.mock.calls[0];
    expect(category).toBe('scim.user');
    expect(message).toContain('Repository failure');
    expect(message).toContain('create user');
    expect(data.errorCode).toBe('NOT_FOUND');
    expect(data.endpointId).toBe('ep-1');
  });

  it('should map NOT_FOUND to 404', () => {
    const repoError = new RepositoryError('NOT_FOUND', 'not found');
    try {
      handleRepositoryError(repoError, 'delete user', mockLogger, 'scim.user' as any);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(404);
      const body = (e as HttpException).getResponse() as Record<string, unknown>;
      expect(body.detail).toContain('Failed to delete user');
    }
  });

  it('should map CONFLICT to 409', () => {
    const repoError = new RepositoryError('CONFLICT', 'unique violation');
    try {
      handleRepositoryError(repoError, 'create user', mockLogger, 'scim.user' as any);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(409);
    }
  });

  it('should map CONNECTION to 503', () => {
    const repoError = new RepositoryError('CONNECTION', 'DB timeout');
    try {
      handleRepositoryError(repoError, 'update user', mockLogger, 'scim.user' as any);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(503);
    }
  });

  it('should map UNKNOWN to 500', () => {
    const repoError = new RepositoryError('UNKNOWN', 'unexpected');
    try {
      handleRepositoryError(repoError, 'patch user', mockLogger, 'scim.user' as any);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(500);
    }
  });

  it('should include operation context in the error detail', () => {
    const repoError = new RepositoryError('NOT_FOUND', 'record not found');
    try {
      handleRepositoryError(repoError, 'soft-delete group', mockLogger, 'scim.group' as any, { scimId: 'grp-1' });
    } catch (e) {
      const body = (e as HttpException).getResponse() as Record<string, unknown>;
      expect(body.detail).toContain('Failed to soft-delete group');
      expect(body.detail).toContain('record not found');
    }
  });

  it('should pass cause error to logger when available', () => {
    const cause = new Error('P2025: Record to delete does not exist.');
    const repoError = new RepositoryError('NOT_FOUND', 'not found', cause);

    try {
      handleRepositoryError(repoError, 'delete user', mockLogger, 'scim.user' as any);
    } catch { /* expected */ }

    const errorArg = mockLogger.error.mock.calls[0][2];
    expect(errorArg).toBe(cause);
  });

  it('should re-throw non-RepositoryError without logging', () => {
    const rawError = new TypeError('Cannot read properties of undefined');

    expect(() => handleRepositoryError(
      rawError, 'create user', mockLogger, 'scim.user' as any,
    )).toThrow(TypeError);

    // Should NOT log - let GlobalExceptionFilter handle it
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('should include additional context in error log data', () => {
    const repoError = new RepositoryError('UNKNOWN', 'fail');
    try {
      handleRepositoryError(repoError, 'create user', mockLogger, 'scim.user' as any, {
        userName: 'alice', endpointId: 'ep-1',
      });
    } catch { /* expected */ }

    const data = mockLogger.error.mock.calls[0][3];
    expect(data.userName).toBe('alice');
    expect(data.endpointId).toBe('ep-1');
    expect(data.operation).toBe('create user');
    expect(data.errorCode).toBe('UNKNOWN');
  });
});

// ─── assertSchemaUniqueness: triggeredBy (P5) ─────────────────────────────

describe('assertSchemaUniqueness triggeredBy (P5)', () => {
  it('should include triggeredBy SchemaUniqueness in diagnostics', () => {
    const uniqueAttrs = [{ schemaUrn: null, attrName: 'employeeId', caseExact: true }];
    const payload = { employeeId: 'EMP-001' };
    const existing = [
      { scimId: 'existing-1', rawPayload: JSON.stringify({ employeeId: 'EMP-001' }) },
    ];

    try {
      assertSchemaUniqueness('ep-1', payload, uniqueAttrs, existing);
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(409);
      const body = e.getResponse();
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
      expect(body[SCIM_DIAGNOSTICS_URN].triggeredBy).toBe('SchemaUniqueness');
    }
  });

  it('should include conflictingResourceId, conflictingAttribute, and incomingValue in diagnostics', () => {
    const uniqueAttrs = [{ schemaUrn: null, attrName: 'employeeId', caseExact: true }];
    const payload = { employeeId: 'EMP-001' };
    const existing = [
      { scimId: 'existing-res-42', rawPayload: JSON.stringify({ employeeId: 'EMP-001' }) },
    ];

    try {
      assertSchemaUniqueness('ep-1', payload, uniqueAttrs, existing);
      fail('should have thrown');
    } catch (e: any) {
      const diag = e.getResponse()[SCIM_DIAGNOSTICS_URN];
      expect(diag.conflictingResourceId).toBe('existing-res-42');
      expect(diag.conflictingAttribute).toBe('employeeId');
      expect(diag.incomingValue).toBe('EMP-001');
    }
  });

  it('should include URN-qualified conflictingAttribute for extension attributes', () => {
    const extUrn = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
    const uniqueAttrs = [{ schemaUrn: extUrn, attrName: 'costCenter', caseExact: false }];
    const payload = { [extUrn]: { costCenter: 'CC-100' } };
    const existing = [
      { scimId: 'existing-ext-7', rawPayload: JSON.stringify({ [extUrn]: { costCenter: 'cc-100' } }) },
    ];

    try {
      assertSchemaUniqueness('ep-1', payload, uniqueAttrs, existing);
      fail('should have thrown');
    } catch (e: any) {
      const diag = e.getResponse()[SCIM_DIAGNOSTICS_URN];
      expect(diag.conflictingAttribute).toBe(`${extUrn}.costCenter`);
      expect(diag.conflictingResourceId).toBe('existing-ext-7');
    }
  });
});

// ─── Test Gaps Audit #5: Additional helper tests ───────────────────────────

describe('Test Gaps Audit #5: enforceIfMatch edge cases', () => {
  it('should NOT throw when RequireIfMatch is undefined and If-Match is absent', () => {
    // Default OFF: no config key at all - enforceIfMatch(version, ifMatch?, config?)
    expect(() => {
      enforceIfMatch(1, undefined, {});
    }).not.toThrow();
  });

  it('should NOT throw when RequireIfMatch is False string and If-Match is absent', () => {
    expect(() => {
      enforceIfMatch(1, undefined, { RequireIfMatch: 'False' });
    }).not.toThrow();
  });

  it('should throw 412 when If-Match is stale', () => {
    try {
      enforceIfMatch(2, 'W/"v1"', {});
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(412);
    }
  });

  it('should throw 428 when RequireIfMatch is true and If-Match is absent', () => {
    try {
      enforceIfMatch(1, undefined, { RequireIfMatch: 'True' });
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(428);
    }
  });

  it('should allow wildcard If-Match (*)', () => {
    expect(() => {
      enforceIfMatch(5, '*', { RequireIfMatch: 'True' });
    }).not.toThrow();
  });
});

describe('Test Gaps Audit #5: assertSchemaUniqueness allows non-unique attrs', () => {
  it('should NOT throw when uniqueAttrs list is empty', () => {
    const payload = { userName: 'test@example.com', externalId: 'dup-ext' };
    const existing = [
      { scimId: 'ex-1', rawPayload: JSON.stringify({ externalId: 'dup-ext' }) },
    ];

    // Empty uniqueAttrs = no uniqueness check
    expect(() => {
      assertSchemaUniqueness('ep-1', payload, [], existing);
    }).not.toThrow();
  });
});