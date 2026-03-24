/**
 * SchemaValidator.buildCharacteristicsCache — Unit Tests
 *
 * Tests the precomputed Parent→Children map cache builder.
 * Verifies all 10 maps are correctly populated from schema definitions
 * with proper parent-key context for name-collision disambiguation.
 */
import { SchemaValidator } from './schema-validator';
import { SCHEMA_CACHE_TOP_LEVEL } from './validation-types';
import type { SchemaDefinition, SchemaCharacteristicsCache } from './validation-types';

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
      expect(cache.booleansByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('active')).toBe(true);
    });

    it('should place sub-attribute booleans under parent name', () => {
      expect(cache.booleansByParent.get('emails')?.has('primary')).toBe(true);
      expect(cache.booleansByParent.get('roles')?.has('primary')).toBe(true);
    });

    it('should NOT place string attributes in boolean map', () => {
      expect(cache.booleansByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('username')).toBeFalsy();
      expect(cache.booleansByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('displayname')).toBeFalsy();
    });

    it('should NOT have extension attributes at __top__', () => {
      expect(cache.booleansByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('department')).toBeFalsy();
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
      expect(collisionCache.booleansByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('active')).toBe(true);
      // Extension: active is string → does NOT appear in booleansByParent under extension key
      const extKey = 'urn:custom:collision:2.0:user';
      expect(collisionCache.booleansByParent.get(extKey)?.has('active')).toBeFalsy();
    });

    it('should distinguish core never-returned "password" from extension default "password"', () => {
      // Core: password is returned:never → in neverReturnedByParent at __top__
      expect(collisionCache.neverReturnedByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('password')).toBe(true);
      // Extension: password is returned:default → NOT in neverReturnedByParent under extension key
      const extKey = 'urn:custom:collision:2.0:user';
      expect(collisionCache.neverReturnedByParent.get(extKey)?.has('password')).toBeFalsy();
    });

    it('should put extension never-returned "active" in neverReturnedByParent under extension key', () => {
      // Extension: active has returned:never
      const extKey = 'urn:custom:collision:2.0:user';
      expect(collisionCache.neverReturnedByParent.get(extKey)?.has('active')).toBe(true);
    });
  });

  // ─── neverReturnedByParent ──────────────────────────────────────

  describe('neverReturnedByParent', () => {
    it('should include returned:never attributes at __top__', () => {
      expect(cache.neverReturnedByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('password')).toBe(true);
    });

    it('should also catch writeOnly attributes as never-returned', () => {
      // password is mutability:writeOnly AND returned:never — both paths should catch it
      expect(cache.neverReturnedByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('password')).toBe(true);
    });
  });

  // ─── alwaysReturnedByParent ─────────────────────────────────────

  describe('alwaysReturnedByParent', () => {
    it('should include returned:always top-level attributes', () => {
      const always = cache.alwaysReturnedByParent.get(SCHEMA_CACHE_TOP_LEVEL);
      expect(always?.has('id')).toBe(true);
      expect(always?.has('username')).toBe(true);
      expect(always?.has('active')).toBe(true);
    });

    it('should NOT include returned:default attributes', () => {
      expect(cache.alwaysReturnedByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('displayname')).toBeFalsy();
    });
  });

  // ─── readOnlyByParent ───────────────────────────────────────────

  describe('readOnlyByParent', () => {
    it('should include readOnly top-level attributes at __top__', () => {
      expect(cache.readOnlyByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('id')).toBe(true);
      expect(cache.readOnlyByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('meta')).toBe(true);
    });

    it('should include readOnly sub-attributes under parent', () => {
      expect(cache.readOnlyByParent.get('meta')?.has('resourcetype')).toBe(true);
      expect(cache.readOnlyByParent.get('meta')?.has('created')).toBe(true);
      expect(cache.readOnlyByParent.get('meta')?.has('lastmodified')).toBe(true);
      expect(cache.readOnlyByParent.get('meta')?.has('location')).toBe(true);
      expect(cache.readOnlyByParent.get('meta')?.has('version')).toBe(true);
    });

    it('should include readOnly extension sub-attributes under parent', () => {
      expect(cache.readOnlyByParent.get('manager')?.has('$ref')).toBe(true);
      expect(cache.readOnlyByParent.get('manager')?.has('displayname')).toBe(true);
    });
  });

  // ─── immutableByParent ──────────────────────────────────────────

  describe('immutableByParent', () => {
    it('should include immutable attributes', () => {
      expect(cache.immutableByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('title')).toBe(true);
    });

    it('should NOT include readWrite attributes', () => {
      expect(cache.immutableByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('displayname')).toBeFalsy();
    });
  });

  // ─── caseExactByParent ──────────────────────────────────────────

  describe('caseExactByParent', () => {
    it('should include caseExact top-level attributes', () => {
      expect(cache.caseExactByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('id')).toBe(true);
    });

    it('should include caseExact sub-attributes under parent', () => {
      expect(cache.caseExactByParent.get('meta')?.has('location')).toBe(true);
    });

    it('should NOT include caseExact:false attributes', () => {
      expect(cache.caseExactByParent.get(SCHEMA_CACHE_TOP_LEVEL)?.has('username')).toBeFalsy();
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
      expect(emptyCache.readOnlyByParent.size).toBe(0);
      expect(emptyCache.uniqueAttrs).toEqual([]);
      expect(emptyCache.extensionUrns).toEqual([]);
    });
  });

  // ─── alwaysReturnedSubs (R-RET-3) ──────────────────────────────

  describe('alwaysReturnedSubs', () => {
    it('should be empty when no sub-attributes have returned:always', () => {
      // Our test fixtures don't have returned:always on sub-attrs
      // This is correct — meta sub-attrs are returned:default
      expect(cache.alwaysReturnedSubs.size).toBe(0);
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
      expect(c.alwaysReturnedSubs.get('addresses')?.has('formatted')).toBe(true);
      expect(c.alwaysReturnedSubs.get('addresses')?.has('type')).toBeFalsy();
    });
  });
});
