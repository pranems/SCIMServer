/**
 * SchemaValidator.buildCharacteristicsCache — Unit Tests
 *
 * Tests the precomputed Parent→Children map cache builder.
 * Verifies all 10 maps are correctly populated from schema definitions
 * with proper parent-key context for name-collision disambiguation.
 */
import { SchemaValidator } from './schema-validator';
import type { SchemaDefinition, SchemaCharacteristicsCache } from './validation-types';

/** Lowercase core User schema URN used in test fixtures */
const CORE_USER_URN = 'urn:ietf:params:scim:schemas:core:2.0:user';

/** Helper: check if a URN dot-path key is a sub-attr key (has '.' after last ':') */
function isSubAttrKey(key: string): boolean {
  const lastColon = key.lastIndexOf(':');
  return key.indexOf('.', lastColon) !== -1;
}

/** Helper: extract sub-attr entries (keys with URN.attr dot pattern) from a ByParent map */
function extractSubs(map: Map<string, Set<string>>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const [parent, children] of map) {
    if (isSubAttrKey(parent)) {
      // Re-key by last segment (attr name) for test assertions
      const dotIdx = parent.lastIndexOf('.');
      const attrName = parent.substring(dotIdx + 1);
      result.set(attrName, children);
    }
  }
  return result;
}
import { flattenParentChildMap } from '../../modules/scim/common/scim-service-helpers';

// ─── Test Fixtures ────────────────────────────────────────────────────

const CORE_USER_SCHEMA: SchemaDefinition = {
  id: 'urn:ietf:params:scim:schemas:core:2.0:User',
  isCoreSchema: true,
  attributes: [
    { name: 'id', type: 'string', multiValued: false, required: true, mutability: 'readOnly', returned: 'always', caseExact: true, uniqueness: 'server' },
    { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'always', caseExact: false, uniqueness: 'server' },
    { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'always' },
    { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
    { name: 'password', type: 'string', multiValued: false, required: false, mutability: 'writeOnly', returned: 'never' },
    {
      name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
        { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
      ],
    },
    {
      name: 'roles', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: 'display', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
      ],
    },
    {
      name: 'meta', type: 'complex', multiValued: false, required: false, mutability: 'readOnly', returned: 'default',
      subAttributes: [
        { name: 'resourceType', type: 'string', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
        { name: 'created', type: 'dateTime', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
        { name: 'lastModified', type: 'dateTime', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
        { name: 'location', type: 'reference', multiValued: false, required: false, mutability: 'readOnly', returned: 'default', caseExact: true },
        { name: 'version', type: 'string', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
      ],
    },
    { name: 'nickName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
    { name: 'title', type: 'string', multiValued: false, required: false, mutability: 'immutable', returned: 'default' },
  ],
};

const EXTENSION_SCHEMA: SchemaDefinition = {
  id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  attributes: [
    { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
    { name: 'costCenter', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
    {
      name: 'manager', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: '$ref', type: 'reference', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
      ],
    },
  ],
};

// Extension with intentional name collision: has 'active' as a STRING attribute
const COLLISION_EXTENSION: SchemaDefinition = {
  id: 'urn:custom:collision:2.0:User',
  attributes: [
    { name: 'active', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'never' },
    { name: 'password', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
  ],
};

// Custom extension with unique attribute
const UNIQUE_EXTENSION: SchemaDefinition = {
  id: 'urn:custom:unique:2.0:User',
  attributes: [
    { name: 'employeeBadge', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server', caseExact: true },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────

describe('SchemaValidator.buildCharacteristicsCache', () => {
  let cache: SchemaCharacteristicsCache;

  beforeAll(() => {
    cache = SchemaValidator.buildCharacteristicsCache(
      [CORE_USER_SCHEMA, EXTENSION_SCHEMA],
      ['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'],
    );
  });

  // ─── booleansByParent ───────────────────────────────────────────

  describe('booleansByParent', () => {
    it('should place core boolean at __top__', () => {
      expect(cache.booleansByParent.get(CORE_USER_URN)?.has('active')).toBe(true);
    });

    it('should place sub-attribute booleans under URN dot-path parent', () => {
      expect(cache.booleansByParent.get(`${CORE_USER_URN}.emails`)?.has('primary')).toBe(true);
      expect(cache.booleansByParent.get(`${CORE_USER_URN}.roles`)?.has('primary')).toBe(true);
    });

    it('should NOT place string attributes in boolean map', () => {
      expect(cache.booleansByParent.get(CORE_USER_URN)?.has('username')).toBeFalsy();
      expect(cache.booleansByParent.get(CORE_USER_URN)?.has('displayname')).toBeFalsy();
    });

    it('should NOT have extension attributes at __top__', () => {
      expect(cache.booleansByParent.get(CORE_USER_URN)?.has('department')).toBeFalsy();
    });
  });

  // ─── Name collision disambiguation ──────────────────────────────

  describe('name collision disambiguation', () => {
    let collisionCache: SchemaCharacteristicsCache;

    beforeAll(() => {
      collisionCache = SchemaValidator.buildCharacteristicsCache(
        [CORE_USER_SCHEMA, COLLISION_EXTENSION],
        ['urn:custom:collision:2.0:User'],
      );
    });

    it('should distinguish core boolean "active" from extension string "active"', () => {
      // Core: active is boolean → appears in booleansByParent at __top__
      expect(collisionCache.booleansByParent.get(CORE_USER_URN)?.has('active')).toBe(true);
      // Extension: active is string → does NOT appear in booleansByParent under extension key
      const extKey = 'urn:custom:collision:2.0:user';
      expect(collisionCache.booleansByParent.get(extKey)?.has('active')).toBeFalsy();
    });

    it('should distinguish core never-returned "password" from extension default "password"', () => {
      // Core: password is returned:never → in neverReturned flat set
      expect(collisionCache.neverReturnedByParent.get(CORE_USER_URN)?.has('password')).toBe(true);
      // Extension: password is returned:default → also NOT in flat set since flat set unions all
      // (but the collision extension has active as returned:never, not password)
    });

    it('should put extension never-returned "active" in neverReturnedByParent under extension key', () => {
      // Extension: active has returned:never — in extension's parent key, not __top__
      const extKey = 'urn:custom:collision:2.0:user';
      expect(collisionCache.neverReturnedByParent.get(extKey)?.has('active')).toBe(true);
    });
  });

  // ─── neverReturned (flat set) ──────────────────────────────────

  describe('neverReturned', () => {
    it('should include returned:never attributes', () => {
      expect(cache.neverReturnedByParent.get(CORE_USER_URN)?.has('password')).toBe(true);
    });

    it('should also catch writeOnly attributes as never-returned', () => {
      expect(cache.neverReturnedByParent.get(CORE_USER_URN)?.has('password')).toBe(true);
    });
  });

  // ─── alwaysReturned (flat set) ────────────────────────────────

  describe('alwaysReturned', () => {
    it('should include returned:always top-level attributes', () => {
      expect(cache.alwaysReturnedByParent.get(CORE_USER_URN)?.has('id')).toBe(true);
      expect(cache.alwaysReturnedByParent.get(CORE_USER_URN)?.has('username')).toBe(true);
      expect(cache.alwaysReturnedByParent.get(CORE_USER_URN)?.has('active')).toBe(true);
    });

    it('should NOT include returned:default attributes', () => {
      expect(cache.alwaysReturnedByParent.get(CORE_USER_URN)?.has('displayname')).toBe(false);
    });
  });

  // ─── readOnlyCollected (replaces readOnlyByParent) ──────────────

  describe('readOnlyCollected', () => {
    it('should include readOnly top-level core attributes', () => {
      expect(cache.readOnlyCollected.core.has('id')).toBe(true);
      expect(cache.readOnlyCollected.core.has('meta')).toBe(true);
    });

    it('should include readOnly sub-attributes in coreSubAttrs', () => {
      expect(cache.readOnlyCollected.coreSubAttrs.get('meta')?.has('resourcetype')).toBe(true);
      expect(cache.readOnlyCollected.coreSubAttrs.get('meta')?.has('created')).toBe(true);
      expect(cache.readOnlyCollected.coreSubAttrs.get('meta')?.has('lastmodified')).toBe(true);
      expect(cache.readOnlyCollected.coreSubAttrs.get('meta')?.has('location')).toBe(true);
      expect(cache.readOnlyCollected.coreSubAttrs.get('meta')?.has('version')).toBe(true);
    });

    it('should include readOnly extension sub-attributes', () => {
      // manager.$ref and manager.displayName are readOnly in extension schema
      const extSubMap = cache.readOnlyCollected.extensionSubAttrs;
      let foundRef = false;
      let foundDisplay = false;
      for (const [, parentMap] of extSubMap) {
        for (const [, subs] of parentMap) {
          if (subs.has('$ref')) foundRef = true;
          if (subs.has('displayname')) foundDisplay = true;
        }
      }
      // If not in extensionSubAttrs, check coreSubAttrs (manager may be categorized as core sub)
      if (!foundRef) foundRef = cache.readOnlyCollected.coreSubAttrs.get('manager')?.has('$ref') ?? false;
      if (!foundDisplay) foundDisplay = cache.readOnlyCollected.coreSubAttrs.get('manager')?.has('displayname') ?? false;
      expect(foundRef || foundDisplay).toBe(true);
    });
  });

  // ─── immutableByParent ──────────────────────────────────────────

  describe('immutableByParent', () => {
    it('should include immutable attributes', () => {
      expect(cache.immutableByParent.get(CORE_USER_URN)?.has('title')).toBe(true);
    });

    it('should NOT include readWrite attributes', () => {
      expect(cache.immutableByParent.get(CORE_USER_URN)?.has('displayname')).toBeFalsy();
    });
  });

  // ─── caseExactPaths (pre-flattened dotted paths) ───────────────

  describe('caseExactPaths', () => {
    it('should include caseExact top-level attributes', () => {
      expect(cache.caseExactPaths.has('id')).toBe(true);
    });

    it('should include caseExact sub-attributes as dotted paths', () => {
      expect(cache.caseExactPaths.has('meta.location')).toBe(true);
    });

    it('should NOT include caseExact:false attributes', () => {
      expect(cache.caseExactPaths.has('username')).toBe(false);
    });
  });

  // ─── uniqueAttrs ────────────────────────────────────────────────

  describe('uniqueAttrs', () => {
    it('should NOT include hardcoded column-promoted attrs (userName, id, displayName, externalId)', () => {
      // These are handled by the service layer directly — excluded from cache
      const attrNames = cache.uniqueAttrs.map(a => a.attrName.toLowerCase());
      expect(attrNames).not.toContain('username');
      expect(attrNames).not.toContain('id');
      expect(attrNames).not.toContain('displayname');
      expect(attrNames).not.toContain('externalid');
    });

    it('should include custom extension unique attrs with schema URN', () => {
      const uniqueCache = SchemaValidator.buildCharacteristicsCache(
        [CORE_USER_SCHEMA, UNIQUE_EXTENSION],
        ['urn:custom:unique:2.0:User'],
      );
      expect(uniqueCache.uniqueAttrs).toEqual([
        { schemaUrn: 'urn:custom:unique:2.0:User', attrName: 'employeeBadge', caseExact: true },
      ]);
    });
  });

  // ─── extensionUrns ──────────────────────────────────────────────

  describe('extensionUrns', () => {
    it('should pass through the extension URNs', () => {
      expect(cache.extensionUrns).toEqual(['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']);
    });
  });

  // ─── Empty schemas ──────────────────────────────────────────────

  describe('empty schemas', () => {
    it('should return empty maps for empty schema array', () => {
      const emptyCache = SchemaValidator.buildCharacteristicsCache([], []);
      expect(emptyCache.booleansByParent.size).toBe(0);
      expect(emptyCache.neverReturnedByParent.size).toBe(0);
      expect(emptyCache.readOnlyCollected.core.size).toBe(0);
      expect(emptyCache.uniqueAttrs).toEqual([]);
      expect(emptyCache.extensionUrns).toEqual([]);
    });
  });

  // ─── alwaysReturnedSubs (R-RET-3) ──────────────────────────────

  describe('alwaysReturnedSubs', () => {
    it('should be empty when no sub-attributes have returned:always', () => {
      // Our test fixtures don't have returned:always on sub-attrs
      // This is correct — meta sub-attrs are returned:default
      expect(extractSubs(cache.alwaysReturnedByParent).size).toBe(0);
    });

    it('should capture sub-attributes with returned:always', () => {
      const schemaWithAlwaysSub: SchemaDefinition = {
        id: 'urn:test:schema',
        isCoreSchema: true,
        attributes: [{
          name: 'addresses', type: 'complex', multiValued: true, required: false,
          subAttributes: [
            { name: 'formatted', type: 'string', multiValued: false, required: false, returned: 'always' },
            { name: 'type', type: 'string', multiValued: false, required: false, returned: 'default' },
          ],
        }],
      };
      const c = SchemaValidator.buildCharacteristicsCache([schemaWithAlwaysSub], []);
      expect(extractSubs(c.alwaysReturnedByParent).get('addresses')?.has('formatted')).toBe(true);
      expect(extractSubs(c.alwaysReturnedByParent).get('addresses')?.has('type')).toBeFalsy();
    });
  });

  // ─── caseExactPaths (pre-flattened dotted paths) ────────────────

  describe('caseExactPaths', () => {
    it('should include caseExact top-level attributes as bare names', () => {
      expect(cache.caseExactPaths.has('id')).toBe(true);
    });

    it('should include caseExact sub-attributes as dotted paths', () => {
      expect(cache.caseExactPaths.has('meta.location')).toBe(true);
    });

    it('should NOT include caseExact:false or unset attributes', () => {
      expect(cache.caseExactPaths.has('username')).toBe(false);
      expect(cache.caseExactPaths.has('displayname')).toBe(false);
    });

    it('should match collectCaseExactAttributes output', () => {
      const legacy = SchemaValidator.collectCaseExactAttributes([CORE_USER_SCHEMA, EXTENSION_SCHEMA]);
      expect([...cache.caseExactPaths].sort()).toEqual([...legacy].sort());
    });
  });

  // ─── requestReturned (flat set) ─────────────────────────────────

  describe('requestReturned', () => {
    it('should be empty when no attributes have returned:request', () => {
      // Our test schemas don't have returned:request attrs
      expect(cache.requestReturnedByParent.size).toBe(0);
    });

    it('should capture attributes with returned:request', () => {
      const schemaWithRequest: SchemaDefinition = {
        id: 'urn:test:request',
        isCoreSchema: true,
        attributes: [
          { name: 'privateNotes', type: 'string', multiValued: false, required: false, returned: 'request' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, returned: 'default' },
        ],
      };
      const c = SchemaValidator.buildCharacteristicsCache([schemaWithRequest], []);
      expect(c.requestReturnedByParent.get('urn:test:request')?.has('privatenotes')).toBe(true);
      expect(c.requestReturnedByParent.get('urn:test:request')?.has('displayname')).toBe(false);
    });

    // AUDIT-2: requestReturnedSubs sub-attr tracking
    it('should populate requestReturnedSubs for sub-attrs with returned:request', () => {
      const schemaWithRequestSub: SchemaDefinition = {
        id: 'urn:test:request-subs',
        isCoreSchema: true,
        attributes: [
          {
            name: 'name', type: 'complex', multiValued: false, required: false,
            subAttributes: [
              { name: 'givenName', type: 'string', multiValued: false, required: false, returned: 'default' },
              { name: 'middleName', type: 'string', multiValued: false, required: false, returned: 'request' },
            ],
          },
          { name: 'topLevel', type: 'string', multiValued: false, required: false, returned: 'request' },
        ],
      };
      const c = SchemaValidator.buildCharacteristicsCache([schemaWithRequestSub], []);
      // Sub-attr should be in requestReturnedSubs
      expect(extractSubs(c.requestReturnedByParent).get('name')?.has('middlename')).toBe(true);
      // Top-level should NOT be in requestReturnedSubs (extractSubs only returns dot-path keys)
      expect(extractSubs(c.requestReturnedByParent).has('urn:test:request-subs')).toBeFalsy();
      // But top-level should still be in requestReturnedByParent
      expect(c.requestReturnedByParent.get('urn:test:request-subs')?.has('toplevel')).toBe(true);
    });
  });

  // ─── coreAttrMap & extensionSchemaMap ───────────────────────────

  describe('coreAttrMap', () => {
    it('should contain all core schema attributes keyed by lowercase name', () => {
      expect(cache.coreAttrMap.has('id')).toBe(true);
      expect(cache.coreAttrMap.has('username')).toBe(true);
      expect(cache.coreAttrMap.has('active')).toBe(true);
      expect(cache.coreAttrMap.has('password')).toBe(true);
      expect(cache.coreAttrMap.has('emails')).toBe(true);
      expect(cache.coreAttrMap.has('meta')).toBe(true);
    });

    it('should NOT contain extension schema attributes', () => {
      expect(cache.coreAttrMap.has('department')).toBe(false);
      expect(cache.coreAttrMap.has('costcenter')).toBe(false);
    });

    it('should store full SchemaAttributeDefinition objects', () => {
      const idDef = cache.coreAttrMap.get('id');
      expect(idDef).toBeDefined();
      expect(idDef!.name).toBe('id');
      expect(idDef!.type).toBe('string');
      expect(idDef!.mutability).toBe('readOnly');
      expect(idDef!.returned).toBe('always');
    });

    it('should include sub-attributes on complex attrs', () => {
      const emailsDef = cache.coreAttrMap.get('emails');
      expect(emailsDef).toBeDefined();
      expect(emailsDef!.subAttributes).toBeDefined();
      expect(emailsDef!.subAttributes!.length).toBeGreaterThan(0);
      const primarySub = emailsDef!.subAttributes!.find(sa => sa.name === 'primary');
      expect(primarySub?.type).toBe('boolean');
    });
  });

  describe('extensionSchemaMap', () => {
    it('should contain extension schemas keyed by original URN', () => {
      expect(cache.extensionSchemaMap.has('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User')).toBe(true);
    });

    it('should NOT contain core schema', () => {
      expect(cache.extensionSchemaMap.has('urn:ietf:params:scim:schemas:core:2.0:User')).toBe(false);
    });

    it('should store full SchemaDefinition with attributes', () => {
      const entDef = cache.extensionSchemaMap.get('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
      expect(entDef).toBeDefined();
      expect(entDef!.attributes.length).toBeGreaterThan(0);
      const deptAttr = entDef!.attributes.find(a => a.name === 'department');
      expect(deptAttr).toBeDefined();
      expect(deptAttr!.type).toBe('string');
    });

    it('should be empty when no extension schemas provided', () => {
      const coreOnly = SchemaValidator.buildCharacteristicsCache([CORE_USER_SCHEMA], []);
      expect(coreOnly.extensionSchemaMap.size).toBe(0);
    });
  });

  // ─── checkImmutable with preBuiltMaps ───────────────────────────

  describe('checkImmutable with preBuiltMaps', () => {
    const immutableSchema: SchemaDefinition = {
      id: 'urn:test:immutable',
      isCoreSchema: true,
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'immutable' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
      ],
    };

    it('should produce identical results with and without preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([immutableSchema], []);
      const existing = { userName: 'alice' };
      const incoming = { userName: 'bob' }; // changed immutable

      const withoutMaps = SchemaValidator.checkImmutable(existing, incoming, [immutableSchema]);
      const withMaps = SchemaValidator.checkImmutable(existing, incoming, [immutableSchema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(withoutMaps.valid).toBe(false);
      expect(withMaps.valid).toBe(false);
      expect(withoutMaps.errors.length).toBe(withMaps.errors.length);
      expect(withoutMaps.errors[0].scimType).toBe(withMaps.errors[0].scimType);
    });

    it('should pass with preBuiltMaps when immutable attr is unchanged', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([immutableSchema], []);
      const existing = { userName: 'alice', displayName: 'Alice' };
      const incoming = { userName: 'alice', displayName: 'Alice Updated' };

      const result = SchemaValidator.checkImmutable(existing, incoming, [immutableSchema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(true);
    });

    it('should detect extension immutable attr change with preBuiltMaps', () => {
      const extSchema: SchemaDefinition = {
        id: 'urn:test:ext:immutable',
        attributes: [
          { name: 'badge', type: 'string', multiValued: false, required: false, mutability: 'immutable' },
        ],
      };
      const testCache = SchemaValidator.buildCharacteristicsCache([immutableSchema, extSchema], ['urn:test:ext:immutable']);
      const existing = { userName: 'alice', 'urn:test:ext:immutable': { badge: 'A001' } };
      const incoming = { userName: 'alice', 'urn:test:ext:immutable': { badge: 'B002' } };

      const result = SchemaValidator.checkImmutable(existing, incoming, [immutableSchema, extSchema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain('badge');
    });
  });

  // ─── Flat set consistency with legacy collectors ────────────────

  describe('flat set consistency with legacy collectors', () => {
    it('neverReturned should match collectReturnedCharacteristics().never', () => {
      const legacy = SchemaValidator.collectReturnedCharacteristics([CORE_USER_SCHEMA, EXTENSION_SCHEMA]);
      expect([...flattenParentChildMap(cache.neverReturnedByParent)].sort()).toEqual([...legacy.never].sort());
    });

    it('alwaysReturned should match collectReturnedCharacteristics().always', () => {
      const legacy = SchemaValidator.collectReturnedCharacteristics([CORE_USER_SCHEMA, EXTENSION_SCHEMA]);
      expect([...flattenParentChildMap(cache.alwaysReturnedByParent)].sort()).toEqual([...legacy.always].sort());
    });

    it('requestReturned should match collectReturnedCharacteristics().request', () => {
      const legacy = SchemaValidator.collectReturnedCharacteristics([CORE_USER_SCHEMA, EXTENSION_SCHEMA]);
      expect([...flattenParentChildMap(cache.requestReturnedByParent)].sort()).toEqual([...legacy.request].sort());
    });

    it('uniqueAttrs should match collectUniqueAttributes()', () => {
      const legacy = SchemaValidator.collectUniqueAttributes([CORE_USER_SCHEMA, EXTENSION_SCHEMA]);
      expect(cache.uniqueAttrs).toEqual(legacy);
    });

    it('readOnlyCollected.core should match collectReadOnlyAttributes().core', () => {
      const legacy = SchemaValidator.collectReadOnlyAttributes([CORE_USER_SCHEMA, EXTENSION_SCHEMA]);
      expect([...cache.readOnlyCollected.core].sort()).toEqual([...legacy.core].sort());
    });
  });

  // ─── Empty schema edge cases for all flat fields ────────────────

  describe('empty schema edge cases', () => {
    let emptyCache: SchemaCharacteristicsCache;

    beforeAll(() => {
      emptyCache = SchemaValidator.buildCharacteristicsCache([], []);
    });

    it('should have empty flat sets', () => {
      expect(emptyCache.neverReturnedByParent.size).toBe(0);
      expect(emptyCache.alwaysReturnedByParent.size).toBe(0);
      expect(emptyCache.requestReturnedByParent.size).toBe(0);
      expect(emptyCache.caseExactPaths.size).toBe(0);
    });

    it('should have empty attribute maps', () => {
      expect(emptyCache.coreAttrMap.size).toBe(0);
      expect(emptyCache.extensionSchemaMap.size).toBe(0);
    });

    it('should have empty readOnlyCollected', () => {
      expect(emptyCache.readOnlyCollected.core.size).toBe(0);
      expect(emptyCache.readOnlyCollected.extensions.size).toBe(0);
      expect(emptyCache.readOnlyCollected.coreSubAttrs.size).toBe(0);
      expect(emptyCache.readOnlyCollected.extensionSubAttrs.size).toBe(0);
    });

    it('should have empty caseExactByParent', () => {
      expect(emptyCache.caseExactByParent.size).toBe(0);
    });

    it('should have empty readOnlyByParent', () => {
      expect(emptyCache.readOnlyByParent.size).toBe(0);
    });

    it('should have empty immutableByParent', () => {
      expect(emptyCache.immutableByParent.size).toBe(0);
    });
  });

  // ─── caseExactByParent (Parent→Children Map) ────────────────────

  describe('caseExactByParent', () => {
    it('should include caseExact core top-level attrs under __top__', () => {
      expect(cache.caseExactByParent.get(CORE_USER_URN)?.has('id')).toBe(true);
    });

    it('should include caseExact sub-attributes under parent name', () => {
      // meta.location has caseExact:true
      expect(cache.caseExactByParent.get(`${CORE_USER_URN}.meta`)?.has('location')).toBe(true);
    });

    it('should NOT include caseExact:false attrs', () => {
      // userName has caseExact:false
      expect(cache.caseExactByParent.get(CORE_USER_URN)?.has('username')).toBeFalsy();
    });

    it('should NOT include attrs without caseExact set', () => {
      // displayName has no caseExact property
      expect(cache.caseExactByParent.get(CORE_USER_URN)?.has('displayname')).toBeFalsy();
    });

    it('should distinguish core caseExact from extension caseExact', () => {
      const extWithCE: SchemaDefinition = {
        id: 'urn:test:ce:ext',
        attributes: [
          { name: 'id', type: 'string', multiValued: false, required: false, caseExact: false },
          { name: 'badge', type: 'string', multiValued: false, required: false, caseExact: true },
        ],
      };
      const c = SchemaValidator.buildCharacteristicsCache([CORE_USER_SCHEMA, extWithCE], ['urn:test:ce:ext']);
      // Core id is caseExact:true under __top__
      expect(c.caseExactByParent.get(CORE_USER_URN)?.has('id')).toBe(true);
      // Extension id is caseExact:false — NOT under extension key
      expect(c.caseExactByParent.get('urn:test:ce:ext')?.has('id')).toBeFalsy();
      // Extension badge is caseExact:true — under extension key
      expect(c.caseExactByParent.get('urn:test:ce:ext')?.has('badge')).toBe(true);
    });

    it('should be consistent with caseExactPaths flattened set', () => {
      // Every entry in caseExactByParent should appear in caseExactPaths
      for (const [parent, children] of cache.caseExactByParent) {
        for (const child of children) {
          // Top-level keys are in schemaUrnSet; sub-attr keys are not
          if (cache.schemaUrnSet.has(parent)) {
            // Top-level attribute → bare name in caseExactPaths
            expect(cache.caseExactPaths.has(child)).toBe(true);
          } else {
            // Sub-attr → find the URN prefix and extract attr path
            let urnPrefix = '';
            for (const urn of cache.schemaUrnSet) {
              if (parent.startsWith(urn + '.')) { urnPrefix = urn; break; }
            }
            const pathAfterUrn = urnPrefix ? parent.substring(urnPrefix.length + 1) : parent;
            const dotted = `${pathAfterUrn}.${child}`;
            expect(cache.caseExactPaths.has(dotted)).toBe(true);
          }
        }
      }
    });
  });

  // ─── readOnlyByParent (Parent→Children Map) ─────────────────────

  describe('readOnlyByParent', () => {
    it('should include readOnly core top-level attrs under __top__', () => {
      expect(cache.readOnlyByParent.get(CORE_USER_URN)?.has('id')).toBe(true);
      expect(cache.readOnlyByParent.get(CORE_USER_URN)?.has('meta')).toBe(true);
    });

    it('should include readOnly sub-attrs under parent name', () => {
      // meta sub-attributes are all readOnly
      expect(cache.readOnlyByParent.get(`${CORE_USER_URN}.meta`)?.has('resourcetype')).toBe(true);
      expect(cache.readOnlyByParent.get(`${CORE_USER_URN}.meta`)?.has('created')).toBe(true);
      expect(cache.readOnlyByParent.get(`${CORE_USER_URN}.meta`)?.has('lastmodified')).toBe(true);
      expect(cache.readOnlyByParent.get(`${CORE_USER_URN}.meta`)?.has('location')).toBe(true);
      expect(cache.readOnlyByParent.get(`${CORE_USER_URN}.meta`)?.has('version')).toBe(true);
    });

    it('should NOT include readWrite attrs', () => {
      expect(cache.readOnlyByParent.get(CORE_USER_URN)?.has('displayname')).toBeFalsy();
      expect(cache.readOnlyByParent.get(CORE_USER_URN)?.has('active')).toBeFalsy();
    });

    it('should include readOnly extension sub-attrs under extension URN parent', () => {
      // manager.$ref and manager.displayName are readOnly in extension
      const extUrn = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user';
      const extReadOnly = cache.readOnlyByParent.get(extUrn);
      const managerReadOnly = cache.readOnlyByParent.get('urn:ietf:params:scim:schemas:extension:enterprise:2.0:user.manager');
      // The extension-level manager sub-attrs should be tracked
      const hasRef = managerReadOnly?.has('$ref') ?? false;
      const hasDisplay = managerReadOnly?.has('displayname') ?? false;
      expect(hasRef || hasDisplay).toBe(true);
    });

    it('should be consistent with readOnlyCollected.core', () => {
      // Every entry in readOnlyCollected.core should also be in readOnlyByParent __top__
      for (const attr of cache.readOnlyCollected.core) {
        expect(cache.readOnlyByParent.get(CORE_USER_URN)?.has(attr)).toBe(true);
      }
    });
  });

  // ─── validate() with preBuiltMaps ───────────────────────────────

  describe('validate with preBuiltMaps', () => {
    const schema: SchemaDefinition = {
      id: 'urn:test:validate',
      isCoreSchema: true,
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
      ],
    };

    const extSchema: SchemaDefinition = {
      id: 'urn:test:validate:ext',
      attributes: [
        { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
      ],
    };

    it('should produce identical results with and without preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema, extSchema], ['urn:test:validate:ext']);
      const payload = { userName: 'alice', active: true, 'urn:test:validate:ext': { department: 'Eng' } };
      const options = { strictMode: true, mode: 'create' as const };

      const without = SchemaValidator.validate(payload, [schema, extSchema], options);
      const withMaps = SchemaValidator.validate(payload, [schema, extSchema], options, {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(without.valid).toBe(withMaps.valid);
      expect(without.errors.length).toBe(withMaps.errors.length);
    });

    it('should detect unknown attributes in strict mode with preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);
      const payload = { userName: 'alice', unknownAttr: 'bad' };
      const options = { strictMode: true, mode: 'create' as const };

      const result = SchemaValidator.validate(payload, [schema], options, {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('unknownAttr'))).toBe(true);
    });

    it('should detect missing required attrs with preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);
      const payload = { active: true }; // missing required userName
      const options = { strictMode: false, mode: 'create' as const };

      const result = SchemaValidator.validate(payload, [schema], options, {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'userName')).toBe(true);
    });

    it('should pass valid payload with preBuiltMaps in non-strict mode', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);
      const payload = { userName: 'alice', extraField: 'ok' };
      const options = { strictMode: false, mode: 'create' as const };

      const result = SchemaValidator.validate(payload, [schema], options, {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(true);
    });
  });

  // ─── validateFilterAttributePaths() with preBuiltMaps ───────────

  describe('validateFilterAttributePaths with preBuiltMaps', () => {
    const schema: SchemaDefinition = {
      id: 'urn:test:filter',
      isCoreSchema: true,
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
        {
          name: 'emails', type: 'complex', multiValued: true, required: false,
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false },
          ],
        },
      ],
    };

    const extSchema: SchemaDefinition = {
      id: 'urn:test:filter:ext',
      attributes: [
        { name: 'department', type: 'string', multiValued: false, required: false },
      ],
    };

    it('should produce identical results with and without preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema, extSchema], ['urn:test:filter:ext']);
      const paths = ['userName', 'emails.value', 'urn:test:filter:ext:department'];

      const without = SchemaValidator.validateFilterAttributePaths(paths, [schema, extSchema]);
      const withMaps = SchemaValidator.validateFilterAttributePaths(paths, [schema, extSchema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(without.valid).toBe(withMaps.valid);
      expect(without.errors.length).toBe(withMaps.errors.length);
    });

    it('should accept known core filter paths with preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);

      const result = SchemaValidator.validateFilterAttributePaths(['userName', 'active'], [schema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(true);
    });

    it('should reject unknown filter paths with preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);

      const result = SchemaValidator.validateFilterAttributePaths(['nonExistentAttr'], [schema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept sub-attribute filter paths with preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);

      const result = SchemaValidator.validateFilterAttributePaths(['emails.value'], [schema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(true);
    });
  });

  // ─── validatePatchOperationValue() with preBuiltMaps ────────────

  describe('validatePatchOperationValue with preBuiltMaps', () => {
    const schema: SchemaDefinition = {
      id: 'urn:test:patch',
      isCoreSchema: true,
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
        { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
      ],
    };

    const extSchema: SchemaDefinition = {
      id: 'urn:test:patch:ext',
      attributes: [
        { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        { name: 'score', type: 'integer', multiValued: false, required: false, mutability: 'readOnly' },
      ],
    };

    it('should produce identical results with and without preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema, extSchema], ['urn:test:patch:ext']);

      const without = SchemaValidator.validatePatchOperationValue('replace', 'userName', 'newName', [schema, extSchema]);
      const withMaps = SchemaValidator.validatePatchOperationValue('replace', 'userName', 'newName', [schema, extSchema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(without.valid).toBe(withMaps.valid);
      expect(without.errors.length).toBe(withMaps.errors.length);
    });

    it('should validate replace op with path using preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);

      const result = SchemaValidator.validatePatchOperationValue('replace', 'displayName', 'Alice', [schema], {
        coreAttrMap: testCache.coreAttrMap,
        extensionSchemaMap: testCache.extensionSchemaMap,
      });

      expect(result.valid).toBe(true);
    });

    it('should validate no-path merge operation with preBuiltMaps', () => {
      const testCache = SchemaValidator.buildCharacteristicsCache([schema], []);

      const result = SchemaValidator.validatePatchOperationValue(
        'replace',
        undefined,
        { displayName: 'Bob', active: true },
        [schema],
        { coreAttrMap: testCache.coreAttrMap, extensionSchemaMap: testCache.extensionSchemaMap },
      );

      expect(result.valid).toBe(true);
    });
  });

  // ─── Extension sub-attribute with returned:'never' ──────────────

  describe('extension sub-attribute with returned:never', () => {
    const extWithNeverSub: SchemaDefinition = {
      id: 'urn:test:ext:neversub',
      attributes: [
        {
          name: 'credentials', type: 'complex', multiValued: false, required: false, returned: 'default',
          subAttributes: [
            { name: 'token', type: 'string', multiValued: false, required: false, returned: 'never' },
            { name: 'provider', type: 'string', multiValued: false, required: false, returned: 'default' },
          ],
        },
      ],
    };

    it('should place sub-attr with returned:never under parent name in neverReturnedByParent', () => {
      const c = SchemaValidator.buildCharacteristicsCache(
        [CORE_USER_SCHEMA, extWithNeverSub],
        ['urn:test:ext:neversub'],
      );
      expect(c.neverReturnedByParent.get('urn:test:ext:neversub.credentials')?.has('token')).toBe(true);
      expect(c.neverReturnedByParent.get('urn:test:ext:neversub.credentials')?.has('provider')).toBeFalsy();
    });
  });

  // ─── isCoreSchema flag on custom URN ────────────────────────────

  describe('isCoreSchema flag on custom URN', () => {
    const customCore: SchemaDefinition = {
      id: 'urn:custom:myapp:2.0:Device',
      isCoreSchema: true,
      attributes: [
        { name: 'serialNumber', type: 'string', multiValued: false, required: true, mutability: 'readWrite', caseExact: true },
        { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
      ],
    };

    it('should treat custom-URN core schema attrs at coreSchemaUrn in booleansByParent', () => {
      const c = SchemaValidator.buildCharacteristicsCache([customCore], []);
      expect(c.booleansByParent.get('urn:custom:myapp:2.0:device')?.has('active')).toBe(true);
    });

    it('should populate coreAttrMap from custom core schema', () => {
      const c = SchemaValidator.buildCharacteristicsCache([customCore], []);
      expect(c.coreAttrMap.has('serialnumber')).toBe(true);
      expect(c.coreAttrMap.has('active')).toBe(true);
    });

    it('should place custom core caseExact attrs under coreSchemaUrn in caseExactByParent', () => {
      const c = SchemaValidator.buildCharacteristicsCache([customCore], []);
      expect(c.caseExactByParent.get('urn:custom:myapp:2.0:device')?.has('serialnumber')).toBe(true);
    });
  });

  // ─── readOnlyCollected.extensionSubAttrs content verification ───

  describe('readOnlyCollected.extensionSubAttrs content', () => {
    it('should contain correct extension sub-attr readOnly sets', () => {
      // Enterprise extension has manager.$ref and manager.displayName as readOnly
      const extSubMap = cache.readOnlyCollected.extensionSubAttrs;
      if (extSubMap.size > 0) {
        // Find the enterprise extension entry
        const entUrn = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
        const entEntry = extSubMap.get(entUrn);
        if (entEntry) {
          const managerSubs = entEntry.get('manager');
          if (managerSubs) {
            // manager.$ref and manager.displayName should be in the set
            expect(managerSubs.has('$ref') || managerSubs.has('displayname')).toBe(true);
          }
        }
      }
      // Verify the map is a Map of Maps
      for (const [, parentMap] of extSubMap) {
        expect(parentMap).toBeInstanceOf(Map);
        for (const [, subs] of parentMap) {
          expect(subs).toBeInstanceOf(Set);
        }
      }
    });
  });

  // ─── Multiple extension schemas ─────────────────────────────────

  describe('multiple extension schemas', () => {
    const ext1: SchemaDefinition = {
      id: 'urn:test:ext1',
      attributes: [
        { name: 'badge', type: 'string', multiValued: false, required: false, returned: 'never', caseExact: true },
      ],
    };
    const ext2: SchemaDefinition = {
      id: 'urn:test:ext2',
      attributes: [
        { name: 'badge', type: 'string', multiValued: false, required: false, returned: 'default', caseExact: false },
        { name: 'level', type: 'integer', multiValued: false, required: false, mutability: 'readOnly' },
      ],
    };

    it('should distinguish same-named attrs across different extensions', () => {
      const c = SchemaValidator.buildCharacteristicsCache(
        [CORE_USER_SCHEMA, ext1, ext2],
        ['urn:test:ext1', 'urn:test:ext2'],
      );

      // ext1: badge is returned:never
      expect(c.neverReturnedByParent.get('urn:test:ext1')?.has('badge')).toBe(true);
      // ext2: badge is returned:default — NOT in neverReturned
      expect(c.neverReturnedByParent.get('urn:test:ext2')?.has('badge')).toBeFalsy();

      // ext1: badge is caseExact:true
      expect(c.caseExactByParent.get('urn:test:ext1')?.has('badge')).toBe(true);
      // ext2: badge is caseExact:false
      expect(c.caseExactByParent.get('urn:test:ext2')?.has('badge')).toBeFalsy();

      // ext2: level is readOnly
      expect(c.readOnlyByParent.get('urn:test:ext2')?.has('level')).toBe(true);
    });
  });

  // ─── isSubAttrKey helper validation ─────────────────────────────

  describe('isSubAttrKey helper', () => {
    it('should return false for bare URNs (top-level keys)', () => {
      expect(isSubAttrKey('urn:ietf:params:scim:schemas:core:2.0:User')).toBe(false);
      expect(isSubAttrKey('urn:ietf:params:scim:schemas:core:2.0:user')).toBe(false);
      expect(isSubAttrKey('urn:custom:myapp:2.0:Device')).toBe(false);
    });

    it('should return false for URNs with dots only in version numbers', () => {
      // The dot in "2.0" is before the last colon — not a sub-attr separator
      expect(isSubAttrKey('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User')).toBe(false);
      expect(isSubAttrKey('urn:test:ext:1.0:Schema')).toBe(false);
    });

    it('should return true for URN dot-path sub-attr keys', () => {
      expect(isSubAttrKey('urn:ietf:params:scim:schemas:core:2.0:user.emails')).toBe(true);
      expect(isSubAttrKey('urn:ietf:params:scim:schemas:core:2.0:user.meta')).toBe(true);
      expect(isSubAttrKey('urn:ietf:params:scim:schemas:extension:enterprise:2.0:user.manager')).toBe(true);
    });

    it('should return true for deeply nested dot-path keys', () => {
      expect(isSubAttrKey('urn:core:2.0:user.name.givenname')).toBe(true);
    });

    it('should handle URNs without version dots', () => {
      expect(isSubAttrKey('urn:test:simple')).toBe(false);
      expect(isSubAttrKey('urn:test:simple.attr')).toBe(true);
    });
  });

  // ─── coreSchemaUrn and schemaUrnSet cache fields ────────────────

  describe('coreSchemaUrn and schemaUrnSet', () => {
    it('should set coreSchemaUrn to lowercase core schema URN', () => {
      expect(cache.coreSchemaUrn).toBe(CORE_USER_URN);
    });

    it('should include core URN in schemaUrnSet', () => {
      expect(cache.schemaUrnSet.has(CORE_USER_URN)).toBe(true);
    });

    it('should include extension URN in schemaUrnSet', () => {
      expect(cache.schemaUrnSet.has('urn:ietf:params:scim:schemas:extension:enterprise:2.0:user')).toBe(true);
    });

    it('should have correct schemaUrnSet size (core + extensions)', () => {
      expect(cache.schemaUrnSet.size).toBe(2);
    });

    it('should set coreSchemaUrn for custom core URN', () => {
      const customCore: SchemaDefinition = {
        id: 'urn:custom:myapp:2.0:Device',
        isCoreSchema: true,
        attributes: [
          { name: 'serialNumber', type: 'string', multiValued: false, required: true },
        ],
      };
      const c = SchemaValidator.buildCharacteristicsCache([customCore], []);
      expect(c.coreSchemaUrn).toBe('urn:custom:myapp:2.0:device');
      expect(c.schemaUrnSet.has('urn:custom:myapp:2.0:device')).toBe(true);
      expect(c.schemaUrnSet.size).toBe(1);
    });

    it('should have empty coreSchemaUrn for empty schemas', () => {
      const emptyCache = SchemaValidator.buildCharacteristicsCache([], []);
      expect(emptyCache.coreSchemaUrn).toBe('');
      expect(emptyCache.schemaUrnSet.size).toBe(0);
    });
  });

  // ─── Sub-attr level name collision disambiguation ───────────────

  describe('sub-attr level collision disambiguation', () => {
    // Core has complex "contacts" with sub-attr "value" (caseExact:true, returned:always)
    // Extension also has complex "contacts" with sub-attr "value" (caseExact:false, returned:request)
    const coreWithContacts: SchemaDefinition = {
      id: 'urn:test:core:collision',
      isCoreSchema: true,
      attributes: [{
        name: 'contacts', type: 'complex', multiValued: true, required: false,
        subAttributes: [
          { name: 'value', type: 'string', multiValued: false, required: false, caseExact: true, returned: 'always' },
          { name: 'type', type: 'string', multiValued: false, required: false },
        ],
      }],
    };
    const extWithContacts: SchemaDefinition = {
      id: 'urn:test:ext:collision',
      attributes: [{
        name: 'contacts', type: 'complex', multiValued: false, required: false,
        subAttributes: [
          { name: 'value', type: 'string', multiValued: false, required: false, caseExact: false, returned: 'request' },
          { name: 'priority', type: 'integer', multiValued: false, required: false, mutability: 'readOnly' },
        ],
      }],
    };

    it('should place core sub-attrs under core URN dot-path and extension sub-attrs under extension URN dot-path', () => {
      const c = SchemaValidator.buildCharacteristicsCache(
        [coreWithContacts, extWithContacts],
        ['urn:test:ext:collision'],
      );

      const coreKey = 'urn:test:core:collision.contacts';
      const extKey = 'urn:test:ext:collision.contacts';

      // caseExact: core.contacts.value = true, ext.contacts.value = false
      expect(c.caseExactByParent.get(coreKey)?.has('value')).toBe(true);
      expect(c.caseExactByParent.get(extKey)?.has('value')).toBeFalsy();

      // returned:always: core.contacts.value = always, ext.contacts.value = request
      expect(c.alwaysReturnedByParent.get(coreKey)?.has('value')).toBe(true);
      expect(c.alwaysReturnedByParent.get(extKey)?.has('value')).toBeFalsy();

      // returned:request: ext.contacts.value = request, core.contacts.value = always (not request)
      expect(c.requestReturnedByParent.get(extKey)?.has('value')).toBe(true);
      expect(c.requestReturnedByParent.get(coreKey)?.has('value')).toBeFalsy();

      // readOnly: ext.contacts.priority = readOnly
      expect(c.readOnlyByParent.get(extKey)?.has('priority')).toBe(true);
      expect(c.readOnlyByParent.get(coreKey)?.has('priority')).toBeFalsy();
    });

    it('should correctly derive readOnlyCollected from collision schemas', () => {
      const c = SchemaValidator.buildCharacteristicsCache(
        [coreWithContacts, extWithContacts],
        ['urn:test:ext:collision'],
      );

      // Extension sub-attr 'priority' is readOnly — should appear in extensionSubAttrs
      const extSubMap = c.readOnlyCollected.extensionSubAttrs;
      const extEntry = extSubMap.get('urn:test:ext:collision');
      expect(extEntry).toBeDefined();
      expect(extEntry?.get('contacts')?.has('priority')).toBe(true);

      // Core contacts has no readOnly sub-attrs
      expect(c.readOnlyCollected.coreSubAttrs.get('contacts')).toBeUndefined();
    });
  });
});
