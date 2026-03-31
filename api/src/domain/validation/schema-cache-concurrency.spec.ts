/**
 * Schema Characteristics Cache — Concurrency & Isolation Tests
 *
 * Validates that the _schemaCaches on EndpointProfile is safe under all
 * concurrent access patterns:
 *
 * Level 1 — Pure function: buildCharacteristicsCache idempotency
 * Level 2 — Profile mutation: lazy cache write on shared profile object
 * Level 3 — AsyncLocalStorage isolation: per-request profile references
 * Level 4 — Interleaved async: simulated concurrent SCIM requests
 * Level 5 — Cache invalidation: admin profile update during active requests
 * Level 6 — Serialization guard: instanceof Map rejects JSON artifacts
 * Level 7 — readOnlyCollected consistency: derived shape matches source
 */
import { AsyncLocalStorage } from 'async_hooks';
import { SchemaValidator } from './schema-validator';
import type { SchemaDefinition, SchemaCharacteristicsCache } from './validation-types';
import { flattenParentChildMap } from '../../modules/scim/common/scim-service-helpers';
import type { EndpointProfile } from '../../modules/scim/endpoint-profile/endpoint-profile.types';

// Test cache key — simulates the coreSchemaUrn used in production
const TEST_KEY = 'urn:ietf:params:scim:schemas:core:2.0:User';

/** Helper: set cache on profile under the test key */
function setProfileCache(profile: EndpointProfile, cache: SchemaCharacteristicsCache, key = TEST_KEY): void {
  if (!profile._schemaCaches) profile._schemaCaches = {};
  profile._schemaCaches[key] = cache;
}

/** Helper: get cache from profile under the test key */
function getProfileCache(profile: EndpointProfile, key = TEST_KEY): SchemaCharacteristicsCache | undefined {
  return profile._schemaCaches?.[key];
}

// ─── Test Fixtures ────────────────────────────────────────────────────

const CORE_SCHEMA: SchemaDefinition = {
  id: 'urn:ietf:params:scim:schemas:core:2.0:User',
  isCoreSchema: true,
  attributes: [
    { name: 'id', type: 'string', multiValued: false, required: true, mutability: 'readOnly', returned: 'always', caseExact: true, uniqueness: 'server' },
    { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'always', caseExact: false, uniqueness: 'server' },
    { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'always' },
    { name: 'password', type: 'string', multiValued: false, required: false, mutability: 'writeOnly', returned: 'never' },
    { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
    {
      name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
      ],
    },
    {
      name: 'meta', type: 'complex', multiValued: false, required: false, mutability: 'readOnly', returned: 'default',
      subAttributes: [
        { name: 'resourceType', type: 'string', multiValued: false, required: false, mutability: 'readOnly' },
        { name: 'created', type: 'dateTime', multiValued: false, required: false, mutability: 'readOnly' },
        { name: 'lastModified', type: 'dateTime', multiValued: false, required: false, mutability: 'readOnly' },
      ],
    },
  ],
};

const EXTENSION_SCHEMA: SchemaDefinition = {
  id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  attributes: [
    { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
    { name: 'costCenter', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
    {
      name: 'manager', type: 'complex', multiValued: false, required: false, mutability: 'readWrite',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readOnly' },
      ],
    },
  ],
};

const ALL_SCHEMAS = [CORE_SCHEMA, EXTENSION_SCHEMA];
const EXT_URNS = ['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];

/** Build a minimal EndpointProfile with schemas for testing */
function buildMockProfile(schemas = ALL_SCHEMAS): EndpointProfile {
  return {
    schemas: schemas as any,
    resourceTypes: [],
    serviceProviderConfig: {} as any,
    settings: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Level 1: Pure Function — buildCharacteristicsCache Idempotency
// ═══════════════════════════════════════════════════════════════════════

describe('Level 1: buildCharacteristicsCache idempotency', () => {
  it('should produce identical caches from the same schemas', () => {
    const cache1 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const cache2 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);

    // Structural equality — same keys, same values
    expect([...cache1.booleansByParent.keys()].sort()).toEqual([...cache2.booleansByParent.keys()].sort());
    for (const [key, set1] of cache1.booleansByParent) {
      const set2 = cache2.booleansByParent.get(key);
      expect(set2).toBeDefined();
      expect([...set1].sort()).toEqual([...set2!].sort());
    }

    expect([...flattenParentChildMap(cache1.neverReturnedByParent)].sort()).toEqual([...flattenParentChildMap(cache2.neverReturnedByParent)].sort());
    expect(cache1.uniqueAttrs).toEqual(cache2.uniqueAttrs);
    expect(cache1.extensionUrns).toEqual(cache2.extensionUrns);
  });

  it('should produce independent Map instances (no shared state)', () => {
    const cache1 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const cache2 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);

    // Verify they are different object references
    expect(cache1.booleansByParent).not.toBe(cache2.booleansByParent);
    expect(cache1.neverReturnedByParent).not.toBe(cache2.neverReturnedByParent);
    expect(cache1.readOnlyCollected.core).not.toBe(cache2.readOnlyCollected.core);

    // Mutating one does not affect the other
    cache1.booleansByParent.set('__test__', new Set(['testAttr']));
    expect(cache2.booleansByParent.has('__test__')).toBe(false);
  });

  it('should produce consistent readOnlyCollected shape', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);

    // readOnlyCollected.core should contain top-level readOnly attrs
    expect(cache.readOnlyCollected.core.has('id')).toBe(true);
    expect(cache.readOnlyCollected.core.has('meta')).toBe(true);
    // readWrite attrs should NOT be in core readOnly
    expect(cache.readOnlyCollected.core.has('username')).toBe(false);
  });

  it('readOnlyCollected extension sub-attrs should match expected shape', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);

    // At minimum, meta sub-attrs (readOnly) should be in coreSubAttrs
    expect(cache.readOnlyCollected.coreSubAttrs.has('meta')).toBe(true);
    const metaSubs = cache.readOnlyCollected.coreSubAttrs.get('meta');
    expect(metaSubs?.has('resourcetype')).toBe(true);
    expect(metaSubs?.has('created')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 2: Profile Mutation — Lazy Cache Write on Shared Object
// ═══════════════════════════════════════════════════════════════════════

describe('Level 2: lazy cache write on shared profile object', () => {
  it('should attach _schemaCaches to profile on first access', () => {
    const profile = buildMockProfile();
    expect(getProfileCache(profile)).toBeUndefined();

    // Simulate getSchemaCache() behavior
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    setProfileCache(profile, cache);

    expect(getProfileCache(profile)).toBeDefined();
    expect(getProfileCache(profile)!.booleansByParent instanceof Map).toBe(true);
  });

  it('should reuse attached cache on subsequent accesses', () => {
    const profile = buildMockProfile();
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    setProfileCache(profile, cache);

    // Simulate second getSchemaCache() call — should return same reference
    const cachedRef = getProfileCache(profile);
    expect(cachedRef).toBe(cache);
    expect(cachedRef!.booleansByParent).toBe(cache.booleansByParent);
  });

  it('should allow overwrite of _schemaCaches entry (last-write-wins)', () => {
    const profile = buildMockProfile();
    const cache1 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const cache2 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    setProfileCache(profile, cache1);
    setProfileCache(profile, cache2);

    // Last write wins — cache2 is the current value
    expect(getProfileCache(profile)).toBe(cache2);
    expect(getProfileCache(profile)).not.toBe(cache1);
    // Both caches have identical content — no data loss
    expect([...cache1.booleansByParent.keys()].sort()).toEqual([...cache2.booleansByParent.keys()].sort());
  });

  it('should not share _schemaCaches between different profile objects', () => {
    const profile1 = buildMockProfile();
    const profile2 = buildMockProfile();
    const cache1 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);

    setProfileCache(profile1, cache1);

    expect(getProfileCache(profile1)).toBeDefined();
    expect(getProfileCache(profile2)).toBeUndefined();
  });

  it('should isolate caches for different resource types on same profile', () => {
    const profile = buildMockProfile();
    const userCache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const groupCache = SchemaValidator.buildCharacteristicsCache([CORE_SCHEMA], []);

    const USER_KEY = 'urn:ietf:params:scim:schemas:core:2.0:User';
    const GROUP_KEY = 'urn:ietf:params:scim:schemas:core:2.0:Group';

    setProfileCache(profile, userCache, USER_KEY);
    setProfileCache(profile, groupCache, GROUP_KEY);

    // Each key returns its own cache
    expect(getProfileCache(profile, USER_KEY)).toBe(userCache);
    expect(getProfileCache(profile, GROUP_KEY)).toBe(groupCache);
    expect(getProfileCache(profile, USER_KEY)).not.toBe(getProfileCache(profile, GROUP_KEY));

    // User cache has extensions, Group cache does not
    expect(getProfileCache(profile, USER_KEY)!.extensionUrns.length).toBeGreaterThan(0);
    expect(getProfileCache(profile, GROUP_KEY)!.extensionUrns.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 3: AsyncLocalStorage Isolation — Per-Request Profile References
// ═══════════════════════════════════════════════════════════════════════

describe('Level 3: AsyncLocalStorage per-request isolation', () => {
  const als = new AsyncLocalStorage<{ profile: EndpointProfile }>();

  it('should give each run() its own profile reference', () => {
    const sharedProfile = buildMockProfile();
    const refs: EndpointProfile[] = [];

    als.run({ profile: sharedProfile }, () => {
      refs.push(als.getStore()!.profile);
    });

    als.run({ profile: sharedProfile }, () => {
      refs.push(als.getStore()!.profile);
    });

    // Both runs see the same profile (shared ref)
    expect(refs[0]).toBe(refs[1]);
    expect(refs[0]).toBe(sharedProfile);
  });

  it('should isolate different profiles across run() calls', () => {
    const profile1 = buildMockProfile();
    const profile2 = buildMockProfile();
    const refs: EndpointProfile[] = [];

    als.run({ profile: profile1 }, () => {
      refs.push(als.getStore()!.profile);
    });

    als.run({ profile: profile2 }, () => {
      refs.push(als.getStore()!.profile);
    });

    expect(refs[0]).toBe(profile1);
    expect(refs[1]).toBe(profile2);
    expect(refs[0]).not.toBe(refs[1]);
  });

  it('should preserve _schemaCaches written during request within that request context', () => {
    const profile = buildMockProfile();

    als.run({ profile }, () => {
      const ctx = als.getStore()!;
      expect(getProfileCache(ctx.profile)).toBeUndefined();

      // Simulate lazy cache build
      const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
      setProfileCache(ctx.profile, cache);

      // Within same context, cache is visible
      expect(getProfileCache(ctx.profile)).toBe(cache);
      expect(getProfileCache(ctx.profile)!.booleansByParent instanceof Map).toBe(true);
    });
  });

  it('should see cache written by first request when profile object is shared', () => {
    const sharedProfile = buildMockProfile();

    // Request 1: writes cache
    als.run({ profile: sharedProfile }, () => {
      const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
      setProfileCache(als.getStore()!.profile, cache);
    });

    // Request 2: same profile ref → sees the cache
    als.run({ profile: sharedProfile }, () => {
      expect(getProfileCache(als.getStore()!.profile)).toBeDefined();
      expect(getProfileCache(als.getStore()!.profile)!.booleansByParent instanceof Map).toBe(true);
    });
  });

  it('should NOT see cache when fresh profile object is used', () => {
    const profile1 = buildMockProfile();
    const profile2 = buildMockProfile();

    // Request 1: writes cache on profile1
    als.run({ profile: profile1 }, () => {
      setProfileCache(profile1, SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS));
    });

    // Request 2: uses profile2 → no cache
    als.run({ profile: profile2 }, () => {
      expect(getProfileCache(als.getStore()!.profile)).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 4: Interleaved Async — Simulated Concurrent SCIM Requests
// ═══════════════════════════════════════════════════════════════════════

describe('Level 4: interleaved async requests on shared profile', () => {
  const als = new AsyncLocalStorage<{ profile: EndpointProfile; requestId: string }>();

  it('should handle two concurrent cache builds on same profile without corruption', async () => {
    const sharedProfile = buildMockProfile();
    const results: SchemaCharacteristicsCache[] = [];

    // Simulate two concurrent requests with shared profile
    const request1 = new Promise<void>((resolve) => {
      als.run({ profile: sharedProfile, requestId: 'req-1' }, () => {
        const ctx = als.getStore()!;
        // Build cache (simulates first access)
        const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
        setProfileCache(ctx.profile, cache);
        results.push(cache);
        resolve();
      });
    });

    const request2 = new Promise<void>((resolve) => {
      als.run({ profile: sharedProfile, requestId: 'req-2' }, () => {
        const ctx = als.getStore()!;
        // Build another cache (simulates concurrent first access)
        const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
        setProfileCache(ctx.profile, cache);
        results.push(cache);
        resolve();
      });
    });

    await Promise.all([request1, request2]);

    // Both caches should have identical content (idempotent)
    expect(results.length).toBe(2);
    const [c1, c2] = results;
    expect([...c1.booleansByParent.keys()].sort()).toEqual([...c2.booleansByParent.keys()].sort());
    expect(c1.uniqueAttrs).toEqual(c2.uniqueAttrs);

    // The profile's _schemaCaches has an entry for the test key (last-write-wins)
    expect(getProfileCache(sharedProfile)).toBeDefined();
    expect(getProfileCache(sharedProfile)!.booleansByParent instanceof Map).toBe(true);
  });

  it('should keep requestId isolated per ALS context even with shared profile', async () => {
    const sharedProfile = buildMockProfile();
    const seenIds: string[] = [];

    const req1 = new Promise<void>((resolve) => {
      als.run({ profile: sharedProfile, requestId: 'r1' }, async () => {
        await new Promise(r => setTimeout(r, 5)); // yield
        seenIds.push(als.getStore()!.requestId);
        resolve();
      });
    });

    const req2 = new Promise<void>((resolve) => {
      als.run({ profile: sharedProfile, requestId: 'r2' }, async () => {
        await new Promise(r => setTimeout(r, 2)); // yield
        seenIds.push(als.getStore()!.requestId);
        resolve();
      });
    });

    await Promise.all([req1, req2]);

    // Each context preserved its own requestId
    expect(seenIds).toContain('r1');
    expect(seenIds).toContain('r2');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 5: Cache Invalidation — Profile Update During Active Requests
// ═══════════════════════════════════════════════════════════════════════

describe('Level 5: profile update during active requests', () => {
  const als = new AsyncLocalStorage<{ profile: EndpointProfile }>();

  it('should not affect in-flight request when endpoint cache is replaced', async () => {
    const profileV1 = buildMockProfile();
    const cacheV1 = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    setProfileCache(profileV1, cacheV1);

    // Simulated endpoint cache (like EndpointService.cacheById)
    const endpointCache = { current: profileV1 };

    let inFlightCacheRef: SchemaCharacteristicsCache | undefined;

    // Start "SCIM request" using profileV1
    const scimRequest = new Promise<void>((resolve) => {
      als.run({ profile: endpointCache.current }, async () => {
        // Request gets profile reference at start
        const reqProfile = als.getStore()!.profile;
        expect(reqProfile).toBe(profileV1);

        await new Promise(r => setTimeout(r, 10)); // simulate work

        // Mid-request: admin updates the endpoint → replaces profile in cache
        const profileV2 = buildMockProfile();
        endpointCache.current = profileV2; // endpoint cache now points to v2

        await new Promise(r => setTimeout(r, 10)); // more work

        // The in-flight request still sees profileV1 via ALS
        inFlightCacheRef = getProfileCache(als.getStore()!.profile);
        expect(als.getStore()!.profile).toBe(profileV1); // same ref
        expect(getProfileCache(als.getStore()!.profile)).toBe(cacheV1); // unchanged

        resolve();
      });
    });

    await scimRequest;

    // After request completes:
    // - endpoint cache points to profileV2 (no _schemaCaches)
    expect(endpointCache.current).not.toBe(profileV1);
    expect(getProfileCache(endpointCache.current)).toBeUndefined();
    // - in-flight request used cacheV1 consistently
    expect(inFlightCacheRef).toBe(cacheV1);
  });

  it('next request after profile update should build fresh cache', () => {
    const profileV1 = buildMockProfile();
    setProfileCache(profileV1, SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS));

    // Admin replaces profile with new object (no _schemaCaches)
    const profileV2 = buildMockProfile();

    als.run({ profile: profileV2 }, () => {
      const ctx = als.getStore()!;
      // Cache check should miss (no _schemaCaches on new profile)
      expect(getProfileCache(ctx.profile)).toBeUndefined();

      // Build fresh cache for new profile
      const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
      setProfileCache(ctx.profile, cache);
      expect(getProfileCache(ctx.profile)!.booleansByParent instanceof Map).toBe(true);
    });

    // Original profileV1 cache is untouched
    expect(getProfileCache(profileV1)!.booleansByParent instanceof Map).toBe(true);
  });

  it('should handle rapid sequential profile updates without stale cache', () => {
    const profiles: EndpointProfile[] = [];
    for (let i = 0; i < 5; i++) {
      profiles.push(buildMockProfile());
    }

    // Each profile should be independent
    for (let i = 0; i < 5; i++) {
      expect(getProfileCache(profiles[i])).toBeUndefined();
      setProfileCache(profiles[i], SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS));
      expect(getProfileCache(profiles[i])!.booleansByParent instanceof Map).toBe(true);
    }

    // Each has its own cache instance
    for (let i = 1; i < 5; i++) {
      expect(getProfileCache(profiles[i])).not.toBe(getProfileCache(profiles[i - 1]));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 6: Serialization Guard — instanceof Map Rejects JSON Artifacts
// ═══════════════════════════════════════════════════════════════════════

describe('Level 6: instanceof Map serialization guard', () => {
  it('should reject JSON.parse-d cache (plain objects, not Maps)', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const profile = buildMockProfile();
    setProfileCache(profile, cache);

    // Simulate DB round-trip: JSON.stringify → JSON.parse
    const serialized = JSON.stringify(profile);
    const deserialized = JSON.parse(serialized) as EndpointProfile;

    // The deserialized _schemaCaches has plain objects, not Maps
    expect(deserialized._schemaCaches).toBeDefined();
    const deserializedCache = deserialized._schemaCaches?.[TEST_KEY] as any;
    expect(deserializedCache).toBeDefined();
    expect(deserializedCache.booleansByParent instanceof Map).toBe(false);
  });

  it('should trigger rebuild when instanceof Map check fails on deserialized data', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const profile = buildMockProfile();
    setProfileCache(profile, cache);

    // Roundtrip
    const deserialized = JSON.parse(JSON.stringify(profile)) as EndpointProfile;

    // Simulate getSchemaCache() guard
    const deserializedCache = deserialized._schemaCaches?.[TEST_KEY] as any;
    const isValidCache = deserializedCache?.booleansByParent instanceof Map;
    expect(isValidCache).toBe(false);

    // Rebuild should produce valid cache
    const freshCache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    setProfileCache(deserialized, freshCache);
    expect(getProfileCache(deserialized)!.booleansByParent instanceof Map).toBe(true);
  });

  it('should correctly identify valid cache with instanceof Map', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    expect(cache.booleansByParent instanceof Map).toBe(true);
    expect(cache.neverReturnedByParent instanceof Map).toBe(true);
    expect(cache.alwaysReturnedByParent instanceof Map).toBe(true);
    expect(cache.caseExactPaths instanceof Set).toBe(true);
    expect(cache.readOnlyCollected.core instanceof Set).toBe(true);
    expect(cache.readOnlyCollected.extensions instanceof Map).toBe(true);
  });

  it('should strip _schemaCaches via delete (simulates toResponse)', () => {
    const profile = buildMockProfile();
    setProfileCache(profile, SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS));
    expect(getProfileCache(profile)).toBeDefined();

    // Simulate toResponse() stripping
    if (profile._schemaCaches) {
      delete profile._schemaCaches;
    }
    expect(getProfileCache(profile)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 7: readOnlyCollected Consistency with collectReadOnlyAttributes
// ═══════════════════════════════════════════════════════════════════════

describe('Level 7: readOnlyCollected vs collectReadOnlyAttributes consistency', () => {
  it('should produce identical core readOnly sets', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const legacy = SchemaValidator.collectReadOnlyAttributes(ALL_SCHEMAS);

    // Core readOnly should match
    expect([...cache.readOnlyCollected.core].sort()).toEqual([...legacy.core].sort());
  });

  it('should produce identical extension readOnly sets', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const legacy = SchemaValidator.collectReadOnlyAttributes(ALL_SCHEMAS);

    // Extension readOnly should match (compare by lowercase URN key)
    for (const [urn, legacySet] of legacy.extensions) {
      const cacheSet = cache.readOnlyCollected.extensions.get(urn.toLowerCase());
      expect(cacheSet).toBeDefined();
      expect([...cacheSet!].sort()).toEqual([...legacySet].sort());
    }
  });

  it('should produce identical core sub-attr readOnly maps', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const legacy = SchemaValidator.collectReadOnlyAttributes(ALL_SCHEMAS);

    for (const [parent, legacySubs] of legacy.coreSubAttrs) {
      const cacheSubs = cache.readOnlyCollected.coreSubAttrs.get(parent);
      expect(cacheSubs).toBeDefined();
      expect([...cacheSubs!].sort()).toEqual([...legacySubs].sort());
    }
  });

  it('should match returned characteristics between cache flatten and legacy collector', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const legacy = SchemaValidator.collectReturnedCharacteristics(ALL_SCHEMAS);

    // Compare flat sets directly
    expect([...flattenParentChildMap(cache.neverReturnedByParent)].sort()).toEqual([...legacy.never].sort());

    const cacheAlways = flattenParentChildMap(cache.alwaysReturnedByParent);
    expect([...cacheAlways].sort()).toEqual([...legacy.always].sort());

    const cacheRequest = flattenParentChildMap(cache.requestReturnedByParent);
    expect([...cacheRequest].sort()).toEqual([...legacy.request].sort());
  });

  it('should match caseExact attributes between cache flatten and legacy collector', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const legacy = SchemaValidator.collectCaseExactAttributes(ALL_SCHEMAS);

    // caseExactPaths is already pre-flattened as dotted paths
    const cachePaths = cache.caseExactPaths;
    expect([...cachePaths].sort()).toEqual([...legacy].sort());
  });

  it('should match uniqueAttrs between cache and legacy collector', () => {
    const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
    const legacy = SchemaValidator.collectUniqueAttributes(ALL_SCHEMAS);

    expect(cache.uniqueAttrs).toEqual(legacy);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 8: Multi-Endpoint Isolation
// ═══════════════════════════════════════════════════════════════════════

describe('Level 8: multi-endpoint cache isolation', () => {
  const als = new AsyncLocalStorage<{ profile: EndpointProfile; endpointId: string }>();

  it('should maintain independent caches for different endpoints', async () => {
    const profileA = buildMockProfile(ALL_SCHEMAS);
    const profileB = buildMockProfile([CORE_SCHEMA]); // different schema set

    const caches: Map<string, SchemaCharacteristicsCache> = new Map();

    const reqA = new Promise<void>((resolve) => {
      als.run({ profile: profileA, endpointId: 'ep-A' }, () => {
        const cache = SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS);
        setProfileCache(als.getStore()!.profile, cache);
        caches.set('ep-A', cache);
        resolve();
      });
    });

    const reqB = new Promise<void>((resolve) => {
      als.run({ profile: profileB, endpointId: 'ep-B' }, () => {
        const cache = SchemaValidator.buildCharacteristicsCache([CORE_SCHEMA], []);
        setProfileCache(als.getStore()!.profile, cache);
        caches.set('ep-B', cache);
        resolve();
      });
    });

    await Promise.all([reqA, reqB]);

    // Endpoint A has extension data, endpoint B does not
    const cacheA = caches.get('ep-A')!;
    const cacheB = caches.get('ep-B')!;

    expect(cacheA.extensionUrns.length).toBeGreaterThan(0);
    expect(cacheB.extensionUrns.length).toBe(0);

    // Profile objects are independent
    expect(getProfileCache(profileA)).not.toBe(getProfileCache(profileB));
  });

  it('should not cross-contaminate caches between endpoints via ALS', async () => {
    const profileA = buildMockProfile();
    const profileB = buildMockProfile();

    const seenProfiles: string[] = [];

    const reqA = new Promise<void>((resolve) => {
      als.run({ profile: profileA, endpointId: 'ep-1' }, async () => {
        setProfileCache(profileA, SchemaValidator.buildCharacteristicsCache(ALL_SCHEMAS, EXT_URNS));
        await new Promise(r => setTimeout(r, 5)); // yield
        seenProfiles.push(als.getStore()!.endpointId);
        // Should still see ep-1's profile, not ep-2's
        expect(als.getStore()!.profile).toBe(profileA);
        resolve();
      });
    });

    const reqB = new Promise<void>((resolve) => {
      als.run({ profile: profileB, endpointId: 'ep-2' }, async () => {
        setProfileCache(profileB, SchemaValidator.buildCharacteristicsCache([CORE_SCHEMA], []));
        await new Promise(r => setTimeout(r, 2)); // yield
        seenProfiles.push(als.getStore()!.endpointId);
        expect(als.getStore()!.profile).toBe(profileB);
        resolve();
      });
    });

    await Promise.all([reqA, reqB]);
    expect(seenProfiles).toContain('ep-1');
    expect(seenProfiles).toContain('ep-2');
  });
});
