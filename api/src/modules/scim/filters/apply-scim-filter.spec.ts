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

import { buildUserFilter, buildGroupFilter, buildGenericFilter } from './apply-scim-filter';

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
      expect(result.dbWhere).toEqual({ userName: { equals: 'john@example.com', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    it('should push eq filter on externalId to DB', () => {
      const result = buildUserFilter('externalId eq "ext-123"');
      expect(result.dbWhere).toEqual({ externalId: 'ext-123' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push eq filter on id to DB (maps to scimId)', () => {
      const result = buildUserFilter('id eq "a1b2c3d4-e5f6-7890-abcd-ef1234567890"');
      expect(result.dbWhere).toEqual({ scimId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
      expect(result.fetchAll).toBe(false);
    });

    it('should return zero-result filter when id eq value is not a valid UUID', () => {
      const result = buildUserFilter('id eq "not-a-uuid"');
      // Non-UUID values can never match a @db.Uuid column — guard returns
      // a contradictory filter instead of crashing PostgreSQL.
      expect(result.dbWhere).toBeDefined();
      expect(result.fetchAll).toBe(false);
      // The dbWhere should NOT contain the raw non-UUID value
      expect(JSON.stringify(result.dbWhere)).not.toContain('not-a-uuid');
    });

    it('should be case-insensitive on attribute name for DB push', () => {
      const result = buildUserFilter('UserName eq "test"');
      expect(result.dbWhere).toEqual({ userName: { equals: 'test', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should preserve value case (CITEXT handles case-insensitivity)', () => {
      const result = buildUserFilter('userName eq "John@Example.COM"');
      expect(result.dbWhere).toEqual({ userName: { equals: 'John@Example.COM', mode: 'insensitive' } });
    });

    // ─── Phase 4: displayName now in User column map ───────────────────

    it('should push eq on displayName to DB (Phase 4: added to column map)', () => {
      const result = buildUserFilter('displayName eq "John Doe"');
      expect(result.dbWhere).toEqual({ displayName: { equals: 'John Doe', mode: 'insensitive' } });
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
      expect(result.dbWhere).toEqual({ userName: { not: 'admin', mode: 'insensitive' } });
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
          { userName: { equals: 'john', mode: 'insensitive' } },
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
          { userName: { equals: 'john', mode: 'insensitive' } },
          { displayName: { equals: 'John', mode: 'insensitive' } },
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
      expect(result.dbWhere).toEqual({ displayName: { equals: 'Engineering', mode: 'insensitive' } });
      expect(result.fetchAll).toBe(false);
    });

    it('should push eq filter on externalId to DB', () => {
      const result = buildGroupFilter('externalId eq "grp-ext-1"');
      expect(result.dbWhere).toEqual({ externalId: 'grp-ext-1' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push eq filter on id to DB (maps to scimId)', () => {
      const result = buildGroupFilter('id eq "a1b2c3d4-e5f6-7890-abcd-ef1234567890"');
      expect(result.dbWhere).toEqual({ scimId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
      expect(result.fetchAll).toBe(false);
    });

    it('should return zero-result filter when id eq value is not a valid UUID (Groups)', () => {
      const result = buildGroupFilter('id eq "group-uuid-1"');
      expect(result.dbWhere).toBeDefined();
      expect(result.fetchAll).toBe(false);
      expect(JSON.stringify(result.dbWhere)).not.toContain('group-uuid-1');
    });

    it('should be case-insensitive on attribute name', () => {
      const result = buildGroupFilter('DISPLAYNAME eq "Ops"');
      expect(result.dbWhere).toEqual({ displayName: { equals: 'Ops', mode: 'insensitive' } });
    });

    it('should preserve value case (CITEXT handles case-insensitivity)', () => {
      const result = buildGroupFilter('displayName eq "Engineering Team"');
      expect(result.dbWhere).toEqual({ displayName: { equals: 'Engineering Team', mode: 'insensitive' } });
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
      expect(result.dbWhere).toEqual({ displayName: { not: 'Admin', mode: 'insensitive' } });
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

  // ── buildGenericFilter ─────────────────────────────────────────────────────

  describe('buildGenericFilter', () => {
    it('should return empty filter when no filter string provided', () => {
      const result = buildGenericFilter();
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(false);
      expect(result.inMemoryFilter).toBeUndefined();
    });

    // ─── eq push-down ──────────────────────────────────────────────────

    it('should push displayName eq to DB (citext, case-insensitive)', () => {
      const result = buildGenericFilter('displayName eq "TestDevice"');
      expect(result.dbWhere).toEqual({
        displayName: { equals: 'TestDevice', mode: 'insensitive' },
      });
      expect(result.fetchAll).toBe(false);
    });

    it('should push externalId eq to DB (text, case-sensitive)', () => {
      const result = buildGenericFilter('externalId eq "ext-123"');
      expect(result.dbWhere).toEqual({ externalId: 'ext-123' });
      expect(result.fetchAll).toBe(false);
    });

    it('should push id eq to DB (uuid)', () => {
      const result = buildGenericFilter('id eq "a1b2c3d4-e5f6-7890-abcd-ef1234567890"');
      expect(result.dbWhere).toEqual({ scimId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
      expect(result.fetchAll).toBe(false);
    });

    it('should return zero-result filter when id eq value is not a valid UUID (Generic)', () => {
      const result = buildGenericFilter('id eq "abc-123"');
      expect(result.dbWhere).toBeDefined();
      expect(result.fetchAll).toBe(false);
      expect(JSON.stringify(result.dbWhere)).not.toContain('abc-123');
    });

    // ─── co/sw/ew push-down ────────────────────────────────────────────

    it('should push displayName co to DB (case-insensitive)', () => {
      const result = buildGenericFilter('displayName co "test"');
      expect(result.dbWhere).toEqual({
        displayName: { contains: 'test', mode: 'insensitive' },
      });
      expect(result.fetchAll).toBe(false);
    });

    it('should push displayName sw to DB', () => {
      const result = buildGenericFilter('displayName sw "Pre"');
      expect(result.dbWhere).toEqual({
        displayName: { startsWith: 'Pre', mode: 'insensitive' },
      });
      expect(result.fetchAll).toBe(false);
    });

    it('should push externalId sw to DB (case-sensitive)', () => {
      const result = buildGenericFilter('externalId sw "ext-"');
      expect(result.dbWhere).toEqual({ externalId: { startsWith: 'ext-' } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── ne push-down ──────────────────────────────────────────────────

    it('should push displayName ne to DB', () => {
      const result = buildGenericFilter('displayName ne "OldDevice"');
      expect(result.dbWhere).toEqual({
        displayName: { not: 'OldDevice', mode: 'insensitive' },
      });
      expect(result.fetchAll).toBe(false);
    });

    // ─── pr (presence) push-down ───────────────────────────────────────

    it('should push externalId pr to DB', () => {
      const result = buildGenericFilter('externalId pr');
      expect(result.dbWhere).toEqual({ externalId: { not: null } });
      expect(result.fetchAll).toBe(false);
    });

    // ─── AND/OR compound ───────────────────────────────────────────────

    it('should push AND compound filter to DB', () => {
      const result = buildGenericFilter('displayName eq "Device" and externalId eq "ext-1"');
      expect(result.dbWhere).toEqual({
        AND: [
          { displayName: { equals: 'Device', mode: 'insensitive' } },
          { externalId: 'ext-1' },
        ],
      });
      expect(result.fetchAll).toBe(false);
    });

    it('should push OR compound filter to DB', () => {
      const result = buildGenericFilter('displayName eq "A" or displayName eq "B"');
      expect(result.dbWhere).toEqual({
        OR: [
          { displayName: { equals: 'A', mode: 'insensitive' } },
          { displayName: { equals: 'B', mode: 'insensitive' } },
        ],
      });
      expect(result.fetchAll).toBe(false);
    });

    // ─── In-memory fallback ────────────────────────────────────────────

    it('should fall back to in-memory for un-mapped attribute', () => {
      const result = buildGenericFilter('active eq true');
      expect(result.dbWhere).toEqual({});
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should fall back to in-memory for not() expression', () => {
      const result = buildGenericFilter('not (displayName eq "X")');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    it('should fall back when AND has one un-pushable side', () => {
      const result = buildGenericFilter('displayName eq "X" and active eq true');
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
    });

    // ─── Invalid filter ────────────────────────────────────────────────

    it('should throw for syntactically invalid filter', () => {
      expect(() => buildGenericFilter('(((')).toThrow();
    });


    // ─── caseExact attrs ───────────────────────────────────────────────

    it('should pass through caseExactAttrs to in-memory evaluator', () => {
      const caseExactAttrs = new Set(['customfield']);
      const result = buildGenericFilter('customField eq "Exact"', caseExactAttrs);
      expect(result.fetchAll).toBe(true);
      expect(result.inMemoryFilter).toBeDefined();
      // In-memory evaluator should use caseExact for customField
    });
  });
});
