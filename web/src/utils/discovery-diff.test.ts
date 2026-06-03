/**
 * Phase L5 - Discovery Explorer diff reducer tests.
 *
 * The diff reducer is a pure function that compares two values for a
 * single attribute characteristic and classifies the relationship as
 * one of:
 *
 *   - 'unchanged'    A and B are equal (or both undefined)
 *   - 'tighten'      B is strictly tighter than A using the API
 *                    partial order (mirrors
 *                    api/src/modules/scim/endpoint-profile/tighten-only-validator.ts)
 *   - 'relax'        B is strictly looser than A
 *   - 'incomparable' Both are present but neither is comparable
 *                    (no shared partial order, e.g. type/multiValued)
 *   - 'missing-a'    Only present on B (B added it)
 *   - 'missing-b'    Only present on A (B dropped it)
 *
 * For boolean characteristics (required, caseExact) "tighten" means
 * false -> true. For mutability "tighten" means lower MUTABILITY_RANK
 * (readWrite > immutable > readOnly so tightening MOVES the rank
 * lower). For uniqueness "tighten" means lower UNIQUENESS_RANK
 * (none > server > global). For returned, RFC 7643 §7 rules:
 * `never` is the most-restrictive sink; `always` is the most-visible.
 *
 * Tests cover:
 *   1. equality (string and bool) on each characteristic
 *   2. tightening direction for required, caseExact, mutability,
 *      uniqueness, returned
 *   3. relaxing direction (must invert)
 *   4. missing-on-one-side semantics (substitute RFC §2.2 default
 *      before classifying so the helper does not produce noise)
 *   5. incomparable (type / multiValued change is structural)
 *   6. compareSchemas: top-level walks all attributes and yields one
 *      row per attribute name across the union of A and B
 */
import { describe, it, expect } from 'vitest';
import {
  classifyCharacteristic,
  compareSchemas,
  RFC_DEFAULTS,
  type DiffStatus,
  type ScimAttributeForDiff,
  type ScimSchemaForDiff,
} from './discovery-diff';

describe('Phase L5 - classifyCharacteristic (pure diff reducer)', () => {
  // ─── 1. Equality on each characteristic ──────────────────────────

  it('equal scalars produce "unchanged"', () => {
    expect(classifyCharacteristic('mutability', 'readWrite', 'readWrite')).toBe<DiffStatus>('unchanged');
    expect(classifyCharacteristic('uniqueness', 'server', 'server')).toBe<DiffStatus>('unchanged');
    expect(classifyCharacteristic('returned', 'default', 'default')).toBe<DiffStatus>('unchanged');
    expect(classifyCharacteristic('required', true, true)).toBe<DiffStatus>('unchanged');
    expect(classifyCharacteristic('required', false, false)).toBe<DiffStatus>('unchanged');
    expect(classifyCharacteristic('caseExact', false, false)).toBe<DiffStatus>('unchanged');
    expect(classifyCharacteristic('type', 'string', 'string')).toBe<DiffStatus>('unchanged');
    expect(classifyCharacteristic('multiValued', false, false)).toBe<DiffStatus>('unchanged');
  });

  // ─── 2. Tightening direction ─────────────────────────────────────

  it('required: false -> true is "tighten"', () => {
    expect(classifyCharacteristic('required', false, true)).toBe<DiffStatus>('tighten');
  });

  it('caseExact: false -> true is "tighten"', () => {
    expect(classifyCharacteristic('caseExact', false, true)).toBe<DiffStatus>('tighten');
  });

  it('mutability: readWrite -> immutable -> readOnly is "tighten"', () => {
    expect(classifyCharacteristic('mutability', 'readWrite', 'immutable')).toBe<DiffStatus>('tighten');
    expect(classifyCharacteristic('mutability', 'immutable', 'readOnly')).toBe<DiffStatus>('tighten');
    expect(classifyCharacteristic('mutability', 'readWrite', 'readOnly')).toBe<DiffStatus>('tighten');
  });

  it('uniqueness: none -> server -> global is "tighten"', () => {
    expect(classifyCharacteristic('uniqueness', 'none', 'server')).toBe<DiffStatus>('tighten');
    expect(classifyCharacteristic('uniqueness', 'server', 'global')).toBe<DiffStatus>('tighten');
    expect(classifyCharacteristic('uniqueness', 'none', 'global')).toBe<DiffStatus>('tighten');
  });

  it('returned: any -> never is "tighten" (never is the most restrictive sink)', () => {
    expect(classifyCharacteristic('returned', 'default', 'never')).toBe<DiffStatus>('tighten');
    expect(classifyCharacteristic('returned', 'always', 'never')).toBe<DiffStatus>('tighten');
    expect(classifyCharacteristic('returned', 'request', 'never')).toBe<DiffStatus>('tighten');
  });

  // ─── 3. Relaxing direction (inverse of tightening) ───────────────

  it('required: true -> false is "relax"', () => {
    expect(classifyCharacteristic('required', true, false)).toBe<DiffStatus>('relax');
  });

  it('caseExact: true -> false is "relax"', () => {
    expect(classifyCharacteristic('caseExact', true, false)).toBe<DiffStatus>('relax');
  });

  it('mutability: readOnly -> immutable -> readWrite is "relax"', () => {
    expect(classifyCharacteristic('mutability', 'readOnly', 'immutable')).toBe<DiffStatus>('relax');
    expect(classifyCharacteristic('mutability', 'immutable', 'readWrite')).toBe<DiffStatus>('relax');
    expect(classifyCharacteristic('mutability', 'readOnly', 'readWrite')).toBe<DiffStatus>('relax');
  });

  it('uniqueness: global -> server -> none is "relax"', () => {
    expect(classifyCharacteristic('uniqueness', 'global', 'server')).toBe<DiffStatus>('relax');
    expect(classifyCharacteristic('uniqueness', 'server', 'none')).toBe<DiffStatus>('relax');
    expect(classifyCharacteristic('uniqueness', 'global', 'none')).toBe<DiffStatus>('relax');
  });

  it('returned: never -> any is "relax" (loosens the sink)', () => {
    expect(classifyCharacteristic('returned', 'never', 'default')).toBe<DiffStatus>('relax');
    expect(classifyCharacteristic('returned', 'never', 'always')).toBe<DiffStatus>('relax');
  });

  // ─── 4. Missing on one side substitutes the RFC §2.2 default ─────

  it('RFC_DEFAULTS table exposes the §2.2 defaults', () => {
    expect(RFC_DEFAULTS.required).toBe(false);
    expect(RFC_DEFAULTS.caseExact).toBe(false);
    expect(RFC_DEFAULTS.mutability).toBe('readWrite');
    expect(RFC_DEFAULTS.returned).toBe('default');
    expect(RFC_DEFAULTS.uniqueness).toBe('none');
    expect(RFC_DEFAULTS.multiValued).toBe(false);
  });

  it('uniqueness undefined on A vs "server" on B classifies as "tighten" (substitutes none)', () => {
    expect(classifyCharacteristic('uniqueness', undefined, 'server')).toBe<DiffStatus>('tighten');
  });

  it('mutability "readOnly" on A vs undefined on B classifies as "relax" (substitutes readWrite)', () => {
    expect(classifyCharacteristic('mutability', 'readOnly', undefined)).toBe<DiffStatus>('relax');
  });

  it('required undefined on both sides is "unchanged" (both default to false)', () => {
    expect(classifyCharacteristic('required', undefined, undefined)).toBe<DiffStatus>('unchanged');
  });

  // ─── 5. Incomparable (structural) characteristics ────────────────

  it('type change is "incomparable" (structural per RFC 7643 §7)', () => {
    expect(classifyCharacteristic('type', 'string', 'integer')).toBe<DiffStatus>('incomparable');
  });

  it('multiValued change is "incomparable"', () => {
    expect(classifyCharacteristic('multiValued', false, true)).toBe<DiffStatus>('incomparable');
  });
});

describe('Phase L5 - compareSchemas (cross-attribute walker)', () => {
  const baseAttr: ScimAttributeForDiff = {
    name: 'userName',
    type: 'string',
    required: true,
    mutability: 'readWrite',
    returned: 'default',
    uniqueness: 'server',
    multiValued: false,
    caseExact: false,
  };

  it('returns one row per attribute name across the union of A and B', () => {
    const a: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [
        { ...baseAttr, name: 'userName' },
        { ...baseAttr, name: 'displayName' },
      ],
    };
    const b: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [
        { ...baseAttr, name: 'userName' },
        { ...baseAttr, name: 'nickName' },
      ],
    };
    const diff = compareSchemas(a, b);
    const names = diff.rows.map((r) => r.name).sort();
    expect(names).toEqual(['displayName', 'nickName', 'userName']);
  });

  it('row for an attribute on both sides classifies each characteristic and the row presence is "both"', () => {
    const a: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [{ ...baseAttr, uniqueness: 'none' }],
    };
    const b: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [{ ...baseAttr, uniqueness: 'server' }],
    };
    const diff = compareSchemas(a, b);
    expect(diff.rows).toHaveLength(1);
    const row = diff.rows[0];
    expect(row.presence).toBe('both');
    expect(row.characteristics.uniqueness).toBe<DiffStatus>('tighten');
    expect(row.characteristics.required).toBe<DiffStatus>('unchanged');
    expect(row.characteristics.mutability).toBe<DiffStatus>('unchanged');
  });

  it('row for an attribute only on A is presence="only-a" (B dropped it)', () => {
    const a: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [baseAttr],
    };
    const b: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [],
    };
    const diff = compareSchemas(a, b);
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0].presence).toBe('only-a');
  });

  it('row for an attribute only on B is presence="only-b" (B added it)', () => {
    const a: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [],
    };
    const b: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [baseAttr],
    };
    const diff = compareSchemas(a, b);
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0].presence).toBe('only-b');
  });

  it('summary counts tally tighten / relax / unchanged across all classified cells', () => {
    const a: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [
        { ...baseAttr, name: 'a', uniqueness: 'none' },
        { ...baseAttr, name: 'b', mutability: 'readOnly' },
        { ...baseAttr, name: 'c' },
      ],
    };
    const b: ScimSchemaForDiff = {
      id: 'urn:scim:User',
      attributes: [
        { ...baseAttr, name: 'a', uniqueness: 'server' }, // tighten
        { ...baseAttr, name: 'b', mutability: 'readWrite' }, // relax
        { ...baseAttr, name: 'c' }, // unchanged across all chars
      ],
    };
    const diff = compareSchemas(a, b);
    expect(diff.summary.tightenCount).toBeGreaterThanOrEqual(1);
    expect(diff.summary.relaxCount).toBeGreaterThanOrEqual(1);
    // unchanged tally counts each unchanged characteristic cell, not just rows.
    expect(diff.summary.unchangedCount).toBeGreaterThanOrEqual(1);
  });
});
