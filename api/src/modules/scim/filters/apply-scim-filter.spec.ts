/**
 * apply-scim-filter Module Tests
 *
 * Tests the SCIM filter → Prisma where-clause bridge logic:
 * - buildUserFilter / buildGroupFilter
 * - Full operator push-down (eq/ne/co/sw/ew/gt/ge/lt/le/pr)
 * - Compound AND/OR filter push-down
 * - In-memory fallback for un-pushable filters (valuePath, not, un-mapped attrs)
 *
 * Phase 3: Column maps use actual column names (userName, displayName) because
 * PostgreSQL CITEXT handles case-insensitive comparison. Values are passed as-is.
 *
 * Phase 4: Full operator push-down + AND/OR compound expressions. Most filters
 * that previously fell back to in-memory are now pushed to Prisma/PostgreSQL.
 */

import { buildUserFilter, buildGroupFilter } from './apply-scim-filter';

describe('apply-scim-filter', () => {
  // ── buildUserFilter ────────────────────────────────────────────────────────

  describe('buildUserFilter', () => {
    // ─── No Filter ─────────────────────────────────────────────────────

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

    // ─── eq operator (DB push-down) ────────────────────────────────────

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

    // ─── Phase 4: displayName now in User column map ───────────────────

    it('should push eq on displayName to DB (Phase 4: added to column map)', () => {
      const result = buildUserFilter('displayName eq "John Doe"');
      expect(result.dbWhere).toEqual({ displayName: 'John Doe' });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    // ─── Phase 4: co operator (DB push-down via contains) ──────────────

    it('should push co filter on userName to DB', () => {
      const result = buildUserFilter('userName co "john"');
      expect(result.dbWhere).toEqual({ userName: { contains: 'john', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    // ─── Phase 4: sw operator (DB push-down via startsWith) ────────────

    it('should push sw filter on userName to DB', () => {
      const result = buildUserFilter('userName sw "j"');
      expect(result.dbWhere).toEqual({ userName: { startsWith: 'j', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    // ─── Phase 4: ew operator (DB push-down via endsWith) ──────────────

    it('should push ew filter on userName to DB', () => {
      const result = buildUserFilter('userName ew ".com"');
      expect(result.dbWhere).toEqual({ userName: { endsWith: '.com', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Phase 4: ne operator ──────────────────────────────────────────

    it('should push ne filter on userName to DB', () => {
      const result = buildUserFilter('userName ne "admin"');
      expect(result.dbWhere).toEqual({ userName: { not: 'admin' } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Phase 4: gt/ge/lt/le operators ────────────────────────────────

    it('should push gt filter to DB', () => {
      const result = buildUserFilter('userName gt "m"');
      expect(result.dbWhere).toEqual({ userName: { gt: 'm' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should push ge filter to DB', () => {
      const result = buildUserFilter('userName ge "m"');
      expect(result.dbWhere).toEqual({ userName: { gte: 'm' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should push lt filter to DB', () => {
      const result = buildUserFilter('userName lt "m"');
      expect(result.dbWhere).toEqual({ userName: { lt: 'm' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should push le filter to DB', () => {
      const result = buildUserFilter('userName le "m"');
      expect(result.dbWhere).toEqual({ userName: { lte: 'm' } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Phase 4: pr (presence) operator ───────────────────────────────

    it('should push pr filter to DB', () => {
      const result = buildUserFilter('userName pr');
      expect(result.dbWhere).toEqual({ userName: { not: null } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Phase 4: active (boolean) filter ──────────────────────────────

    it('should push active eq true to DB', () => {
      const result = buildUserFilter('active eq true');
      expect(result.dbWhere).toEqual({ active: true });
      expect(result.fetchAll).toBe(false);
    });

    it('should push active eq false to DB', () => {
      const result = buildUserFilter('active eq false');
      expect(result.dbWhere).toEqual({ active: false });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Phase 4: compound AND filter (DB push-down) ───────────────────

    it('should push AND compound filter to DB when both sides are pushable', () => {
      const result = buildUserFilter('userName eq "john" and active eq true');
      expect(result.dbWhere).toEqual({
        AND: [
          { userName: 'john' },
          { active: true },
        ],
      });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    // ─── Phase 4: compound OR filter (DB push-down) ────────────────────

    it('should push OR compound filter to DB when both sides are pushable', () => {
      const result = buildUserFilter('userName eq "john" or displayName eq "John"');
      expect(result.dbWhere).toEqual({
        OR: [
          { userName: 'john' },
          { displayName: 'John' },
        ],
      });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Phase 4: mixed compound with string operators ─────────────────

    it('should push AND with co and eq operators to DB', () => {
      const result = buildUserFilter('userName co "john" and active eq true');
      expect(result.dbWhere).toEqual({
        AND: [
          { userName: { contains: 'john', mode: 'insensitive' } },
          { active: true },
        ],
      });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Fallbacks (still in-memory) ───────────────────────────────────

    it('should fall back to in-memory for non-indexed attributes', () => {
      const result = buildUserFilter('emails.value eq "x@y.com"');
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should fall back when AND has un-pushable side', () => {
      const result = buildUserFilter('userName eq "john" and emails.value eq "x@y.com"');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should fall back when OR has un-pushable side', () => {
      const result = buildUserFilter('userName eq "john" or emails.value eq "x@y.com"');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should throw on invalid filter syntax', () => {
      expect(() => buildUserFilter('not a valid filter :::')).toThrow(/Invalid filter/);
    });

    it('in-memory filter should correctly match resource', () => {
      // emails.value is not in column map → falls back to in-memory
      const result = buildUserFilter('name.givenName co "John"');
      expect(result.inMemoryFilter).toBeDefined();
      expect(result.inMemoryFilter!({ name: { givenName: 'John Doe' } })).toBe(true);
      expect(result.inMemoryFilter!({ name: { givenName: 'Jane Doe' } })).toBe(false);
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

    // ─── Phase 4: co/sw/ew operators pushed to DB ──────────────────────

    it('should push co filter on displayName to DB', () => {
      const result = buildGroupFilter('displayName co "Eng"');
      expect(result.dbWhere).toEqual({ displayName: { contains: 'Eng', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    it('should push sw filter on displayName to DB', () => {
      const result = buildGroupFilter('displayName sw "Eng"');
      expect(result.dbWhere).toEqual({ displayName: { startsWith: 'Eng', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Phase 4: ne / pr operators ────────────────────────────────────

    it('should push ne filter on displayName to DB', () => {
      const result = buildGroupFilter('displayName ne "Admin"');
      expect(result.dbWhere).toEqual({ displayName: { not: 'Admin' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should push pr filter on externalId to DB', () => {
      const result = buildGroupFilter('externalId pr');
      expect(result.dbWhere).toEqual({ externalId: { not: null } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── Fallbacks ─────────────────────────────────────────────────────

    it('should fall back for userName (not in Group column map)', () => {
      const result = buildGroupFilter('userName eq "test"');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should throw on invalid filter syntax', () => {
      expect(() => buildGroupFilter('invalid ::: filter')).toThrow(/Invalid filter/);
    });

    it('in-memory filter should correctly evaluate group resources', () => {
      // members is not in column map → falls back
      const result = buildGroupFilter('members.value eq "user-123"');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    // ─── SCIM Validator: externalId (caseExact=true per RFC 7643 §3.1) ──────────

    it('should preserve value case for externalId eq (TEXT — case-sensitive)', () => {
      const result = buildGroupFilter('externalId eq "ABC-DEF-1234"');
      expect(result.dbWhere).toEqual({ externalId: 'ABC-DEF-1234' });
      expect(result.fetchAll).toBe(false);
      // Value is passed as-is — TEXT column does case-sensitive comparison
    });

    it('should push externalId eq with mixed case to DB without lowering', () => {
      const result = buildGroupFilter('externalId eq "MiXeD-CaSe-GrOuP"');
      expect(result.dbWhere).toEqual({ externalId: 'MiXeD-CaSe-GrOuP' });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    it('should push externalId eq with uppercase attribute name to DB', () => {
      const result = buildGroupFilter('EXTERNALID eq "ext-grp-99"');
      expect(result.dbWhere).toEqual({ externalId: 'ext-grp-99' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push co filter on externalId to DB (case-sensitive — caseExact=true)', () => {
      const result = buildGroupFilter('externalId co "grp"');
      expect(result.dbWhere).toEqual({ externalId: { contains: 'grp' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should push sw filter on externalId to DB (case-sensitive — caseExact=true)', () => {
      const result = buildGroupFilter('externalId sw "ext-"');
      expect(result.dbWhere).toEqual({ externalId: { startsWith: 'ext-' } });
      expect(result.fetchAll).toBe(false);
    });
  });

  // ── SCIM Validator: User externalId (caseExact=true per RFC 7643 §3.1) ────

  describe('User externalId case-sensitive filtering', () => {
    it('should push eq filter on externalId with uppercase value to DB', () => {
      const result = buildUserFilter('externalId eq "EXT-USER-ABC"');
      expect(result.dbWhere).toEqual({ externalId: 'EXT-USER-ABC' });
      expect(result.fetchAll).toBe(false);
      // TEXT column does case-sensitive matching at the DB level
    });

    it('should push externalId eq with UPPERCASE attribute name to DB', () => {
      const result = buildUserFilter('EXTERNALID eq "ext-123"');
      expect(result.dbWhere).toEqual({ externalId: 'ext-123' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push co filter on user externalId to DB (case-sensitive)', () => {
      const result = buildUserFilter('externalId co "USER"');
      expect(result.dbWhere).toEqual({ externalId: { contains: 'USER' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should push sw filter on user externalId to DB (case-sensitive)', () => {
      const result = buildUserFilter('externalId sw "ext-"');
      expect(result.dbWhere).toEqual({ externalId: { startsWith: 'ext-' } });
      expect(result.fetchAll).toBe(false);
    });
  });
});
