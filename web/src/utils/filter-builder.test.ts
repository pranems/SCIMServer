/**
 * Phase M1 - filter-builder pure module tests.
 *
 * RFC 7644 §3.4.2.2 SCIM filter expression builder. Operates on a
 * structured `FilterClause` tree (one or more atoms joined by AND/OR)
 * and emits a SCIM filter string the server understands. Inverse:
 * a thin parser that turns a flat string back into a single-atom
 * tree so the operator can edit a free-typed filter visually.
 *
 * Properties under test:
 *   1. Empty / null tree -> empty string
 *   2. Every RFC 7644 operator emits the canonical token
 *      (eq / ne / co / sw / ew / pr / gt / ge / lt / le)
 *   3. String values are quoted; booleans + numbers + null are NOT
 *   4. `pr` is a unary operator (no value rendered)
 *   5. AND / OR with multiple atoms wraps with parentheses where needed
 *   6. Quote-escape: a value containing " becomes \"
 *   7. parseSimpleFilter accepts the canonical 'attr op value' form
 *      (single atom; compound parsing is deferred to N6)
 *   8. parseSimpleFilter is the inverse of buildFilterString for
 *      every supported operator
 */
import { describe, it, expect } from 'vitest';
import {
  buildFilterString,
  parseSimpleFilter,
  FILTER_OPERATORS,
  type FilterClause,
  type FilterAtom,
} from './filter-builder';

function atom(o: Partial<FilterAtom> & Pick<FilterAtom, 'attribute' | 'operator'>): FilterAtom {
  return {
    attribute: o.attribute,
    operator: o.operator,
    value: o.value,
  };
}

describe('Phase M1 - filter-builder (pure RFC 7644 §3.4.2.2 emitter)', () => {
  it('exposes the 10 RFC 7644 operators', () => {
    expect(FILTER_OPERATORS).toEqual([
      'eq', 'ne', 'co', 'sw', 'ew', 'pr', 'gt', 'ge', 'lt', 'le',
    ]);
  });

  it('empty tree -> empty string', () => {
    expect(buildFilterString(undefined)).toBe('');
    expect(buildFilterString(null)).toBe('');
  });

  it('quotes string values', () => {
    const c: FilterClause = { kind: 'atom', atom: atom({ attribute: 'userName', operator: 'eq', value: 'alice@x.com' }) };
    expect(buildFilterString(c)).toBe('userName eq "alice@x.com"');
  });

  it('does NOT quote boolean values', () => {
    const c: FilterClause = { kind: 'atom', atom: atom({ attribute: 'active', operator: 'eq', value: true }) };
    expect(buildFilterString(c)).toBe('active eq true');
  });

  it('does NOT quote number values', () => {
    const c: FilterClause = { kind: 'atom', atom: atom({ attribute: 'count', operator: 'gt', value: 5 }) };
    expect(buildFilterString(c)).toBe('count gt 5');
  });

  it('renders pr as a unary operator (no value, no spaces after)', () => {
    const c: FilterClause = { kind: 'atom', atom: atom({ attribute: 'externalId', operator: 'pr' }) };
    expect(buildFilterString(c)).toBe('externalId pr');
  });

  it('escapes embedded double-quotes per RFC 7644 §3.4.2.2', () => {
    const c: FilterClause = { kind: 'atom', atom: atom({ attribute: 'displayName', operator: 'co', value: 'She said "hi"' }) };
    expect(buildFilterString(c)).toBe('displayName co "She said \\"hi\\""');
  });

  it('emits AND with multiple atoms wrapped in parentheses', () => {
    const c: FilterClause = {
      kind: 'compound',
      conjunction: 'and',
      clauses: [
        { kind: 'atom', atom: atom({ attribute: 'userName', operator: 'sw', value: 'a' }) },
        { kind: 'atom', atom: atom({ attribute: 'active', operator: 'eq', value: true }) },
      ],
    };
    expect(buildFilterString(c)).toBe('(userName sw "a") and (active eq true)');
  });

  it('emits OR with multiple atoms', () => {
    const c: FilterClause = {
      kind: 'compound',
      conjunction: 'or',
      clauses: [
        { kind: 'atom', atom: atom({ attribute: 'userName', operator: 'co', value: 'admin' }) },
        { kind: 'atom', atom: atom({ attribute: 'externalId', operator: 'pr' }) },
      ],
    };
    expect(buildFilterString(c)).toBe('(userName co "admin") or (externalId pr)');
  });

  it('compound with a single child unwraps to the child string', () => {
    const c: FilterClause = {
      kind: 'compound',
      conjunction: 'and',
      clauses: [
        { kind: 'atom', atom: atom({ attribute: 'userName', operator: 'eq', value: 'alice' }) },
      ],
    };
    expect(buildFilterString(c)).toBe('userName eq "alice"');
  });

  it('compound with zero children -> empty string', () => {
    const c: FilterClause = { kind: 'compound', conjunction: 'and', clauses: [] };
    expect(buildFilterString(c)).toBe('');
  });

  // ─── parseSimpleFilter inverse ────────────────────────────────────

  it('parseSimpleFilter parses a single string-quoted atom', () => {
    const c = parseSimpleFilter('userName eq "alice@x.com"');
    expect(c?.kind).toBe('atom');
    if (c?.kind === 'atom') {
      expect(c.atom.attribute).toBe('userName');
      expect(c.atom.operator).toBe('eq');
      expect(c.atom.value).toBe('alice@x.com');
    }
  });

  it('parseSimpleFilter parses a unary pr atom', () => {
    const c = parseSimpleFilter('externalId pr');
    expect(c?.kind).toBe('atom');
    if (c?.kind === 'atom') {
      expect(c.atom.attribute).toBe('externalId');
      expect(c.atom.operator).toBe('pr');
      expect(c.atom.value).toBeUndefined();
    }
  });

  it('parseSimpleFilter parses a numeric atom (unquoted)', () => {
    const c = parseSimpleFilter('count gt 5');
    expect(c?.kind).toBe('atom');
    if (c?.kind === 'atom') {
      expect(c.atom.attribute).toBe('count');
      expect(c.atom.operator).toBe('gt');
      expect(c.atom.value).toBe(5);
    }
  });

  it('parseSimpleFilter parses a boolean atom (unquoted)', () => {
    const c = parseSimpleFilter('active eq true');
    expect(c?.kind).toBe('atom');
    if (c?.kind === 'atom') {
      expect(c.atom.value).toBe(true);
    }
  });

  it('parseSimpleFilter returns null for empty / whitespace input', () => {
    expect(parseSimpleFilter('')).toBeNull();
    expect(parseSimpleFilter('   ')).toBeNull();
  });

  it('parseSimpleFilter returns null for unrecognized operator', () => {
    expect(parseSimpleFilter('userName foo "x"')).toBeNull();
  });

  it('round-trip: every supported operator parses back to the same atom', () => {
    const cases: FilterAtom[] = [
      { attribute: 'userName', operator: 'eq', value: 'a' },
      { attribute: 'userName', operator: 'ne', value: 'b' },
      { attribute: 'userName', operator: 'co', value: 'c' },
      { attribute: 'userName', operator: 'sw', value: 'd' },
      { attribute: 'userName', operator: 'ew', value: 'e' },
      { attribute: 'externalId', operator: 'pr' },
      { attribute: 'count', operator: 'gt', value: 10 },
      { attribute: 'count', operator: 'ge', value: 10 },
      { attribute: 'count', operator: 'lt', value: 10 },
      { attribute: 'count', operator: 'le', value: 10 },
      { attribute: 'active', operator: 'eq', value: true },
    ];
    for (const a of cases) {
      const built = buildFilterString({ kind: 'atom', atom: a });
      const reparsed = parseSimpleFilter(built);
      expect(reparsed?.kind, `failed for ${built}`).toBe('atom');
      if (reparsed?.kind === 'atom') {
        expect(reparsed.atom).toEqual(a);
      }
    }
  });
});
