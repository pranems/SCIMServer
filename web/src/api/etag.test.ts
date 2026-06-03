/**
 * etag.test.ts - Phase K5 ETag helper contract.
 *
 * Asserts:
 *   - `parseResourceEtag(resource)` extracts the version-N integer
 *     from a SCIM resource's `meta.version` field (`W/"v3"` -> 3).
 *   - Tolerates legacy timestamp ETags (`W/"<ISO>"`) by returning
 *     the raw string as `displayVersion` and a null `versionNumber`.
 *   - Returns null/null when meta is absent or malformed.
 *   - `formatIfMatchValue(parsed)` round-trips back to the wire
 *     format the server expects on the If-Match header.
 *   - `compareForcedOverwriteEnabled` policy: only allowed when the
 *     parsed ETag carries a version number (refusing it for
 *     legacy/unknown ETags so we never silently overwrite a resource
 *     whose version we can't reason about).
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S4.10
 * @see docs/PHASE_K5_ETAG_AND_REQUIREIFMATCH.md
 */
import { describe, it, expect } from 'vitest';
import {
  parseResourceEtag,
  formatIfMatchValue,
  isForceOverwriteSafe,
  type ParsedEtag,
} from './etag';

describe('parseResourceEtag', () => {
  it('parses W/"v3" into versionNumber=3 + displayVersion=v3', () => {
    const r = parseResourceEtag({ id: 'x', meta: { version: 'W/"v3"' } });
    expect(r.rawEtag).toBe('W/"v3"');
    expect(r.versionNumber).toBe(3);
    expect(r.displayVersion).toBe('v3');
    expect(r.kind).toBe<ParsedEtag['kind']>('version');
  });

  it('parses W/"v123" into versionNumber=123', () => {
    const r = parseResourceEtag({ id: 'x', meta: { version: 'W/"v123"' } });
    expect(r.versionNumber).toBe(123);
    expect(r.displayVersion).toBe('v123');
  });

  it('tolerates strong ETag form (no W/) - "v5"', () => {
    const r = parseResourceEtag({ id: 'x', meta: { version: '"v5"' } });
    expect(r.versionNumber).toBe(5);
    expect(r.displayVersion).toBe('v5');
  });

  it('returns kind="legacy" + null versionNumber for an ISO-timestamp ETag', () => {
    const iso = '2026-05-01T12:00:00Z';
    const r = parseResourceEtag({ id: 'x', meta: { version: `W/"${iso}"` } });
    expect(r.versionNumber).toBeNull();
    expect(r.displayVersion).toBe(iso);
    expect(r.kind).toBe<ParsedEtag['kind']>('legacy');
  });

  it('returns kind="missing" when meta is undefined', () => {
    const r = parseResourceEtag({ id: 'x' });
    expect(r.versionNumber).toBeNull();
    expect(r.displayVersion).toBeNull();
    expect(r.rawEtag).toBeNull();
    expect(r.kind).toBe<ParsedEtag['kind']>('missing');
  });

  it('returns kind="missing" when meta.version is undefined', () => {
    const r = parseResourceEtag({ id: 'x', meta: {} });
    expect(r.versionNumber).toBeNull();
    expect(r.displayVersion).toBeNull();
    expect(r.kind).toBe<ParsedEtag['kind']>('missing');
  });

  it('returns kind="missing" when meta.version is an empty string', () => {
    const r = parseResourceEtag({ id: 'x', meta: { version: '' } });
    expect(r.kind).toBe<ParsedEtag['kind']>('missing');
  });

  it('handles a null resource defensively', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = parseResourceEtag(null as any);
    expect(r.kind).toBe<ParsedEtag['kind']>('missing');
  });
});

describe('formatIfMatchValue', () => {
  it('returns the rawEtag verbatim for the version kind', () => {
    const parsed: ParsedEtag = {
      rawEtag: 'W/"v7"',
      versionNumber: 7,
      displayVersion: 'v7',
      kind: 'version',
    };
    expect(formatIfMatchValue(parsed)).toBe('W/"v7"');
  });

  it('returns the rawEtag verbatim for the legacy kind (so the server can still match it)', () => {
    const parsed: ParsedEtag = {
      rawEtag: 'W/"2026-05-01T12:00:00Z"',
      versionNumber: null,
      displayVersion: '2026-05-01T12:00:00Z',
      kind: 'legacy',
    };
    expect(formatIfMatchValue(parsed)).toBe('W/"2026-05-01T12:00:00Z"');
  });

  it('returns undefined when no rawEtag is available', () => {
    const parsed: ParsedEtag = {
      rawEtag: null,
      versionNumber: null,
      displayVersion: null,
      kind: 'missing',
    };
    expect(formatIfMatchValue(parsed)).toBeUndefined();
  });
});

describe('isForceOverwriteSafe', () => {
  it('refuses force overwrite when ETag is missing (we cannot reason about whose data we will clobber)', () => {
    expect(isForceOverwriteSafe({
      rawEtag: null, versionNumber: null, displayVersion: null, kind: 'missing',
    })).toBe(false);
  });

  it('allows force overwrite when ETag is a known version', () => {
    expect(isForceOverwriteSafe({
      rawEtag: 'W/"v3"', versionNumber: 3, displayVersion: 'v3', kind: 'version',
    })).toBe(true);
  });

  it('allows force overwrite for legacy ETags too (rare case but still better than silent failure)', () => {
    expect(isForceOverwriteSafe({
      rawEtag: 'W/"2026-05-01T12:00:00Z"', versionNumber: null, displayVersion: '2026-05-01T12:00:00Z', kind: 'legacy',
    })).toBe(true);
  });
});
