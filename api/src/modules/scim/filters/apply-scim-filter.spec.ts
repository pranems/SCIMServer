/**
 * apply-scim-filter Module Tests
 *
 * Tests the SCIM filter → Prisma where-clause bridge logic:
 * - buildUserFilter / buildGroupFilter
 * - tryPushToDb (DB push-down for simple eq filters)
 * - In-memory fallback for complex filters
 *
 * Phase 3: Column maps use actual column names (userName, displayName) because
 * PostgreSQL CITEXT handles case-insensitive comparison. Values are passed as-is.
 */

import { buildUserFilter, buildGroupFilter } from './apply-scim-filter';

describe('apply-scim-filter', () => {
  // ── buildUserFilter ────────────────────────────────────────────────────────

  describe('buildUserFilter', () => {
    it('should return empty filter when no filter string provided', () => {
      const result = buildUserFilter();
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    it('should return empty filter for undefined filter', () => {
      const result = buildUserFilter(undefined);
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(false);
    });

    it('should push eq filter on userName to DB', () => {
      const result = buildUserFilter('userName eq "john@example.com"');
      expect(result.dbWhere).toEqual({ userName: 'john@example.com' });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    it('should push eq filter on externalId to DB', () => {
      const result = buildUserFilter('externalId eq "ext-123"');
      expect(result.dbWhere).toEqual({ externalId: 'ext-123' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push eq filter on id to DB (maps to scimId)', () => {
      const result = buildUserFilter('id eq "abc-123"');
      expect(result.dbWhere).toEqual({ scimId: 'abc-123' });
      expect(result.fetchAll).toBe(false);
    });

    it('should be case-insensitive on attribute name for DB push', () => {
      const result = buildUserFilter('UserName eq "test"');
      expect(result.dbWhere).toEqual({ userName: 'test' });
      expect(result.fetchAll).toBe(false);
    });

    it('should preserve value case (CITEXT handles case-insensitivity)', () => {
      const result = buildUserFilter('userName eq "John@Example.COM"');
      expect(result.dbWhere).toEqual({ userName: 'John@Example.COM' });
    });

    it('should fall back to in-memory for non-eq operators', () => {
      const result = buildUserFilter('userName co "john"');
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should fall back to in-memory for complex filters (and)', () => {
      const result = buildUserFilter('userName eq "john" and active eq true');
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should fall back to in-memory for non-indexed attributes', () => {
      const result = buildUserFilter('displayName eq "John Doe"');
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should throw on invalid filter syntax', () => {
      expect(() => buildUserFilter('not a valid filter :::')).toThrow(/Invalid filter/);
    });

    it('in-memory filter should correctly match resource', () => {
      const result = buildUserFilter('displayName co "John"');
      expect(result.inMemoryFilter).toBeDefined();
      expect(result.inMemoryFilter!({ displayName: 'John Doe' })).toBe(true);
      expect(result.inMemoryFilter!({ displayName: 'Jane Doe' })).toBe(false);
    });

    it('should fall back for sw operator', () => {
      const result = buildUserFilter('userName sw "j"');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });
  });

  // ── buildGroupFilter ───────────────────────────────────────────────────────

  describe('buildGroupFilter', () => {
    it('should return empty filter when no filter string provided', () => {
      const result = buildGroupFilter();
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    it('should push eq filter on displayName to DB', () => {
      const result = buildGroupFilter('displayName eq "Engineering"');
      expect(result.dbWhere).toEqual({ displayName: 'Engineering' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push eq filter on externalId to DB', () => {
      const result = buildGroupFilter('externalId eq "grp-ext-1"');
      expect(result.dbWhere).toEqual({ externalId: 'grp-ext-1' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push eq filter on id to DB (maps to scimId)', () => {
      const result = buildGroupFilter('id eq "group-uuid-1"');
      expect(result.dbWhere).toEqual({ scimId: 'group-uuid-1' });
      expect(result.fetchAll).toBe(false);
    });

    it('should be case-insensitive on attribute name', () => {
      const result = buildGroupFilter('DISPLAYNAME eq "Ops"');
      expect(result.dbWhere).toEqual({ displayName: 'Ops' });
    });

    it('should preserve value case (CITEXT handles case-insensitivity)', () => {
      const result = buildGroupFilter('displayName eq "Engineering Team"');
      expect(result.dbWhere).toEqual({ displayName: 'Engineering Team' });
    });

    it('should fall back to in-memory for non-eq operators', () => {
      const result = buildGroupFilter('displayName co "Eng"');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should fall back for userName (not in Group column map)', () => {
      const result = buildGroupFilter('userName eq "test"');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should throw on invalid filter syntax', () => {
      expect(() => buildGroupFilter('invalid ::: filter')).toThrow(/Invalid filter/);
    });

    it('in-memory filter should correctly evaluate group resources', () => {
      const result = buildGroupFilter('displayName sw "Eng"');
      expect(result.inMemoryFilter).toBeDefined();
      expect(result.inMemoryFilter!({ displayName: 'Engineering' })).toBe(true);
      expect(result.inMemoryFilter!({ displayName: 'Marketing' })).toBe(false);
    });
  });
});
