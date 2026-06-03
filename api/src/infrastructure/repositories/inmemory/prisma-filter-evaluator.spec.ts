/**
 * Prisma Filter Evaluator Tests
 *
 * Phase 4: Tests for the in-memory Prisma WHERE clause evaluator used by
 * InMemory repositories to interpret Prisma-style filter objects produced
 * by the expanded filter push-down in apply-scim-filter.ts.
 */

import { matchesPrismaFilter } from './prisma-filter-evaluator';

describe('matchesPrismaFilter', () => {
  // ── Simple equality ────────────────────────────────────────────────────────

  describe('simple equality', () => {
    it('should match string equality', () => {
      expect(matchesPrismaFilter({ userName: 'john' }, { userName: 'john' })).toBe(true);
    });

    it('should match string equality case-sensitively (TEXT column behavior)', () => {
      expect(matchesPrismaFilter({ externalId: 'ABC-123' }, { externalId: 'ABC-123' })).toBe(true);
      expect(matchesPrismaFilter({ externalId: 'ABC-123' }, { externalId: 'abc-123' })).toBe(false);
      expect(matchesPrismaFilter({ externalId: 'abc-123' }, { externalId: 'ABC-123' })).toBe(false);
    });

    it('should not match different string values', () => {
      expect(matchesPrismaFilter({ userName: 'jane' }, { userName: 'john' })).toBe(false);
    });

    it('should match boolean equality', () => {
      expect(matchesPrismaFilter({ active: true }, { active: true })).toBe(true);
      expect(matchesPrismaFilter({ active: false }, { active: false })).toBe(true);
    });

    it('should not match different boolean values', () => {
      expect(matchesPrismaFilter({ active: true }, { active: false })).toBe(false);
    });

    it('should match multiple simple equalities', () => {
      const record = { userName: 'john', active: true };
      expect(matchesPrismaFilter(record, { userName: 'john', active: true })).toBe(true);
      expect(matchesPrismaFilter(record, { userName: 'john', active: false })).toBe(false);
    });

    it('should match empty filter (no conditions)', () => {
      expect(matchesPrismaFilter({ userName: 'john' }, {})).toBe(true);
    });
  });

  // ── equals operator with mode ──────────────────────────────────────────────

  describe('equals operator (CITEXT mode)', () => {
    it('should match case-insensitively with mode:insensitive', () => {
      expect(matchesPrismaFilter(
        { userName: 'John' },
        { userName: { equals: 'john', mode: 'insensitive' } },
      )).toBe(true);
      expect(matchesPrismaFilter(
        { userName: 'JOHN' },
        { userName: { equals: 'john', mode: 'insensitive' } },
      )).toBe(true);
    });

    it('should match case-sensitively without mode flag', () => {
      expect(matchesPrismaFilter(
        { userName: 'John' },
        { userName: { equals: 'john' } },
      )).toBe(false);
      expect(matchesPrismaFilter(
        { userName: 'john' },
        { userName: { equals: 'john' } },
      )).toBe(true);
    });
  });

  // ── not operator ───────────────────────────────────────────────────────────

  describe('not operator', () => {
    it('should match when value differs from not condition', () => {
      expect(matchesPrismaFilter({ userName: 'jane' }, { userName: { not: 'john' } })).toBe(true);
    });

    it('should not match when value equals not condition', () => {
      expect(matchesPrismaFilter({ userName: 'john' }, { userName: { not: 'john' } })).toBe(false);
    });

    it('should handle case-insensitive not with mode:insensitive', () => {
      expect(matchesPrismaFilter(
        { userName: 'JOHN' },
        { userName: { not: 'john', mode: 'insensitive' } },
      )).toBe(false);
      expect(matchesPrismaFilter(
        { userName: 'jane' },
        { userName: { not: 'john', mode: 'insensitive' } },
      )).toBe(true);
    });

    it('should handle case-sensitive not without mode', () => {
      expect(matchesPrismaFilter(
        { externalId: 'ABC' },
        { externalId: { not: 'abc' } },
      )).toBe(true);
      expect(matchesPrismaFilter(
        { externalId: 'abc' },
        { externalId: { not: 'abc' } },
      )).toBe(false);
    });

    it('should handle { not: null } as presence check', () => {
      expect(matchesPrismaFilter({ externalId: 'ext-1' }, { externalId: { not: null } })).toBe(true);
      expect(matchesPrismaFilter({ externalId: null }, { externalId: { not: null } })).toBe(false);
      expect(matchesPrismaFilter({ externalId: undefined }, { externalId: { not: null } })).toBe(false);
    });

    it('should handle { not: null } when field is missing', () => {
      expect(matchesPrismaFilter({}, { externalId: { not: null } })).toBe(false);
    });
  });

  // ── contains operator ──────────────────────────────────────────────────────

  describe('contains operator', () => {
    it('should match substring (case-insensitive)', () => {
      expect(matchesPrismaFilter(
        { userName: 'john.doe@example.com' },
        { userName: { contains: 'john', mode: 'insensitive' } },
      )).toBe(true);
    });

    it('should match substring case-insensitively', () => {
      expect(matchesPrismaFilter(
        { userName: 'John.Doe@Example.com' },
        { userName: { contains: 'john', mode: 'insensitive' } },
      )).toBe(true);
    });

    it('should not match when substring is absent', () => {
      expect(matchesPrismaFilter(
        { userName: 'jane@example.com' },
        { userName: { contains: 'john', mode: 'insensitive' } },
      )).toBe(false);
    });

    it('should return false for non-string stored value', () => {
      expect(matchesPrismaFilter(
        { userName: 42 },
        { userName: { contains: 'john', mode: 'insensitive' } },
      )).toBe(false);
    });

    it('should match case-sensitively without mode flag', () => {
      expect(matchesPrismaFilter(
        { userName: 'John' },
        { userName: { contains: 'john' } },
      )).toBe(false);
      expect(matchesPrismaFilter(
        { userName: 'john' },
        { userName: { contains: 'john' } },
      )).toBe(true);
    });
  });

  // ── startsWith operator ────────────────────────────────────────────────────

  describe('startsWith operator', () => {
    it('should match prefix (case-insensitive)', () => {
      expect(matchesPrismaFilter(
        { userName: 'john.doe' },
        { userName: { startsWith: 'john', mode: 'insensitive' } },
      )).toBe(true);
    });

    it('should not match non-prefix', () => {
      expect(matchesPrismaFilter(
        { userName: 'doe.john' },
        { userName: { startsWith: 'john', mode: 'insensitive' } },
      )).toBe(false);
    });
  });

  // ── endsWith operator ──────────────────────────────────────────────────────

  describe('endsWith operator', () => {
    it('should match suffix (case-insensitive)', () => {
      expect(matchesPrismaFilter(
        { userName: 'john@example.com' },
        { userName: { endsWith: '.com', mode: 'insensitive' } },
      )).toBe(true);
    });

    it('should not match non-suffix', () => {
      expect(matchesPrismaFilter(
        { userName: 'john@example.org' },
        { userName: { endsWith: '.com', mode: 'insensitive' } },
      )).toBe(false);
    });
  });

  // ── gt / gte / lt / lte operators ──────────────────────────────────────────

  describe('ordered comparisons', () => {
    it('should handle gt with numbers', () => {
      expect(matchesPrismaFilter({ age: 25 }, { age: { gt: 20 } })).toBe(true);
      expect(matchesPrismaFilter({ age: 20 }, { age: { gt: 20 } })).toBe(false);
    });

    it('should handle gte with numbers', () => {
      expect(matchesPrismaFilter({ age: 20 }, { age: { gte: 20 } })).toBe(true);
      expect(matchesPrismaFilter({ age: 19 }, { age: { gte: 20 } })).toBe(false);
    });

    it('should handle lt with numbers', () => {
      expect(matchesPrismaFilter({ age: 15 }, { age: { lt: 20 } })).toBe(true);
      expect(matchesPrismaFilter({ age: 20 }, { age: { lt: 20 } })).toBe(false);
    });

    it('should handle lte with numbers', () => {
      expect(matchesPrismaFilter({ age: 20 }, { age: { lte: 20 } })).toBe(true);
      expect(matchesPrismaFilter({ age: 21 }, { age: { lte: 20 } })).toBe(false);
    });

    it('should handle gt with strings (case-insensitive)', () => {
      expect(matchesPrismaFilter({ userName: 'z' }, { userName: { gt: 'm' } })).toBe(true);
      expect(matchesPrismaFilter({ userName: 'a' }, { userName: { gt: 'm' } })).toBe(false);
    });

    it('should handle gte with strings', () => {
      expect(matchesPrismaFilter({ userName: 'm' }, { userName: { gte: 'm' } })).toBe(true);
    });
  });

  // ── AND compound ───────────────────────────────────────────────────────────

  describe('AND compound', () => {
    it('should match when all AND clauses match', () => {
      const record = { userName: 'john', active: true };
      const filter = { AND: [{ userName: 'john' }, { active: true }] };
      expect(matchesPrismaFilter(record, filter)).toBe(true);
    });

    it('should not match when any AND clause fails', () => {
      const record = { userName: 'john', active: false };
      const filter = { AND: [{ userName: 'john' }, { active: true }] };
      expect(matchesPrismaFilter(record, filter)).toBe(false);
    });

    it('should handle nested operator objects in AND', () => {
      const record = { userName: 'john.doe', active: true };
      const filter = {
        AND: [
          { userName: { contains: 'john', mode: 'insensitive' } },
          { active: true },
        ],
      };
      expect(matchesPrismaFilter(record, filter)).toBe(true);
    });
  });

  // ── OR compound ────────────────────────────────────────────────────────────

  describe('OR compound', () => {
    it('should match when any OR clause matches', () => {
      const record = { userName: 'john', displayName: 'Jane' };
      const filter = { OR: [{ userName: 'john' }, { displayName: 'Other' }] };
      expect(matchesPrismaFilter(record, filter)).toBe(true);
    });

    it('should not match when no OR clause matches', () => {
      const record = { userName: 'bob', displayName: 'Bob' };
      const filter = { OR: [{ userName: 'john' }, { displayName: 'Jane' }] };
      expect(matchesPrismaFilter(record, filter)).toBe(false);
    });
  });

  // ── Mixed / nested compound ────────────────────────────────────────────────

  describe('nested compound expressions', () => {
    it('should handle AND containing OR', () => {
      const record = { userName: 'john', active: true, displayName: 'John Doe' };
      const filter = {
        AND: [
          { active: true },
          { OR: [{ userName: 'john' }, { displayName: 'Jane' }] },
        ],
      };
      expect(matchesPrismaFilter(record, filter)).toBe(true);
    });
  });
});
