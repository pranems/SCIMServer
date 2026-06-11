/**
 * Phase M1 - patch-builder pure module tests.
 *
 * RFC 7644 §3.5.2 SCIM PatchOp envelope assembly. Operates on an
 * array of structured `PatchOperation` objects (op + path + value)
 * and emits the canonical envelope:
 *   { schemas: [PatchOpURN], Operations: [...] }
 *
 * Properties under test:
 *   1. Empty operations -> envelope with empty Operations[]
 *   2. Schemas URN is always the canonical RFC 7644 PatchOp URN
 *   3. add / remove / replace ops emit correctly
 *   4. `remove` op without value still serializes (value is omitted, not null)
 *   5. `path` is preserved verbatim (no normalization)
 *   6. Value pass-through for primitives, arrays, objects
 *   7. validatePatchOp catches invalid op names, missing path on remove,
 *      missing value on add/replace
 *   8. parseCurlPatchBody is the inverse - takes a JSON string + returns
 *      the structured operations or null on parse failure
 */
import { describe, it, expect } from 'vitest';
import {
  buildPatchEnvelope,
  validatePatchOp,
  parseCurlPatchBody,
  PATCH_OP_SCHEMA_URN,
  PATCH_OP_NAMES,
  type PatchOperation,
} from './patch-builder';

describe('Phase M1 - patch-builder (pure RFC 7644 §3.5.2 emitter)', () => {
  it('exposes the canonical PatchOp URN', () => {
    expect(PATCH_OP_SCHEMA_URN).toBe('urn:ietf:params:scim:api:messages:2.0:PatchOp');
  });

  it('exposes the 3 RFC PatchOp names', () => {
    expect(PATCH_OP_NAMES).toEqual(['add', 'remove', 'replace']);
  });

  it('empty ops -> envelope with empty Operations[]', () => {
    const env = buildPatchEnvelope([]);
    expect(env).toEqual({
      schemas: [PATCH_OP_SCHEMA_URN],
      Operations: [],
    });
  });

  it('builds a single replace op envelope', () => {
    const env = buildPatchEnvelope([
      { op: 'replace', path: 'displayName', value: 'New Name' },
    ]);
    expect(env).toEqual({
      schemas: [PATCH_OP_SCHEMA_URN],
      Operations: [{ op: 'replace', path: 'displayName', value: 'New Name' }],
    });
  });

  it('builds an add op with array value', () => {
    const env = buildPatchEnvelope([
      { op: 'add', path: 'emails', value: [{ value: 'x@y.com', primary: true }] },
    ]);
    expect(env.Operations[0]).toEqual({
      op: 'add',
      path: 'emails',
      value: [{ value: 'x@y.com', primary: true }],
    });
  });

  it('remove op without value omits the value field (does NOT serialize value:null)', () => {
    const env = buildPatchEnvelope([{ op: 'remove', path: 'manager' }]);
    expect(env.Operations[0]).toEqual({ op: 'remove', path: 'manager' });
    expect(env.Operations[0]).not.toHaveProperty('value');
  });

  it('preserves path verbatim - no normalization', () => {
    const env = buildPatchEnvelope([
      { op: 'replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Eng' },
    ]);
    expect(env.Operations[0].path).toBe('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department');
  });

  it('multi-op envelope preserves order', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'displayName', value: 'A' },
      { op: 'remove', path: 'manager' },
      { op: 'add', path: 'emails', value: [{ value: 'a@b.com' }] },
    ];
    const env = buildPatchEnvelope(ops);
    expect(env.Operations.map((o) => o.op)).toEqual(['replace', 'remove', 'add']);
  });

  // ─── validatePatchOp ──────────────────────────────────────────────

  it('validatePatchOp accepts a well-formed replace op', () => {
    const errs = validatePatchOp({ op: 'replace', path: 'displayName', value: 'X' });
    expect(errs).toEqual([]);
  });

  it('validatePatchOp rejects unknown op name', () => {
    const errs = validatePatchOp({ op: 'foo' as 'add', path: 'displayName', value: 'X' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/op/i);
  });

  it('validatePatchOp rejects remove without path', () => {
    const errs = validatePatchOp({ op: 'remove', path: '' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/path/i);
  });

  it('validatePatchOp rejects add without value', () => {
    const errs = validatePatchOp({ op: 'add', path: 'displayName', value: undefined });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/value/i);
  });

  it('validatePatchOp rejects replace without value', () => {
    const errs = validatePatchOp({ op: 'replace', path: 'displayName', value: undefined });
    expect(errs.length).toBeGreaterThan(0);
  });

  it('validatePatchOp accepts add at path-less root with object value', () => {
    // Path is optional on `add` at the root per RFC 7644 §3.5.2.1.
    const errs = validatePatchOp({ op: 'add', path: '', value: { displayName: 'X' } });
    expect(errs).toEqual([]);
  });

  // ─── parseCurlPatchBody ───────────────────────────────────────────

  it('parseCurlPatchBody returns the operations from a valid envelope JSON', () => {
    const body = JSON.stringify({
      schemas: [PATCH_OP_SCHEMA_URN],
      Operations: [{ op: 'replace', path: 'displayName', value: 'Y' }],
    });
    const ops = parseCurlPatchBody(body);
    expect(ops).toEqual([{ op: 'replace', path: 'displayName', value: 'Y' }]);
  });

  it('parseCurlPatchBody returns null for invalid JSON', () => {
    expect(parseCurlPatchBody('not json')).toBeNull();
  });

  it('parseCurlPatchBody returns null when Operations is missing or not an array', () => {
    expect(parseCurlPatchBody('{}')).toBeNull();
    expect(parseCurlPatchBody('{"Operations":"nope"}')).toBeNull();
  });

  it('parseCurlPatchBody preserves Operations order', () => {
    const body = JSON.stringify({
      schemas: [PATCH_OP_SCHEMA_URN],
      Operations: [
        { op: 'add', path: 'emails', value: [] },
        { op: 'remove', path: 'manager' },
      ],
    });
    const ops = parseCurlPatchBody(body);
    expect(ops?.map((o) => o.op)).toEqual(['add', 'remove']);
  });
});
