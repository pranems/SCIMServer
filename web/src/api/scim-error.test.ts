/**
 * scim-error.test.ts - Phase K3 error parser + catalog contract.
 *
 * Locks the behavior of:
 *   - `ScimApiError` (the Error subclass thrown by fetchWithAuth)
 *   - `parseScimError(unknown)` (pure normalizer for any caught value)
 *   - `SCIM_ERROR_CATALOG` (the scimType -> plain-English entry table)
 *
 * The catalog is the single source of truth for the operator-facing
 * copy in <ScimErrorMessage />; this spec asserts every RFC 7644
 * Table 9 keyword + the project's published vocabulary
 * ([docs/LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md](../../../docs/LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md) S16)
 * has a non-empty entry. Future RFC additions land here first; the
 * `it.each(KNOWN_KEYWORDS)` block fails until the catalog is updated.
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S5.7
 * @see docs/PHASE_K3_SMART_ERROR_EXPLAINER.md
 */
import { describe, it, expect } from 'vitest';
import {
  ScimApiError,
  parseScimError,
  SCIM_ERROR_CATALOG,
  type ScimErrorCatalogEntry,
  type ParsedScimError,
} from './scim-error';

// ─── Vocabulary lock ────────────────────────────────────────────────
//
// Every keyword the API can emit must have a plain-English explanation.
// New keywords from a future RFC update or new server-side error path
// MUST be added to SCIM_ERROR_CATALOG before this test will pass.

const RFC_7644_KEYWORDS = [
  'uniqueness',
  'invalidFilter',
  'invalidSyntax',
  'invalidPath',
  'noTarget',
  'invalidValue',
  'mutability',
  'invalidVers',
  'sensitive',
  'tooMany',
] as const;

const PROJECT_KEYWORDS = [
  'versionMismatch', // RFC 7644 §3.14 ETag - server emits this on 412
  'tooLarge',        // Phase 9 Bulk - server emits this on 400 oversize body
] as const;

describe('Phase K3 - SCIM error catalog contract', () => {
  it.each([...RFC_7644_KEYWORDS, ...PROJECT_KEYWORDS])(
    'has a catalog entry for scimType %s',
    (keyword) => {
      const entry: ScimErrorCatalogEntry | undefined = SCIM_ERROR_CATALOG[keyword];
      expect(entry, `missing SCIM_ERROR_CATALOG entry for '${keyword}'`).toBeDefined();
      expect(entry!.title.length, `'${keyword}' title is empty`).toBeGreaterThan(0);
      expect(
        entry!.explanation.length,
        `'${keyword}' explanation is empty`,
      ).toBeGreaterThan(20); // anything shorter is not actually plain-English
    },
  );

  it('every catalog entry has a non-empty title and explanation', () => {
    for (const [keyword, entry] of Object.entries(SCIM_ERROR_CATALOG)) {
      expect(entry.title, `${keyword}.title`).toBeTruthy();
      expect(entry.explanation, `${keyword}.explanation`).toBeTruthy();
    }
  });

  it('entries that have a docsUrl point at an https:// url (no relative or http paths)', () => {
    for (const [keyword, entry] of Object.entries(SCIM_ERROR_CATALOG)) {
      if (entry.docsUrl !== undefined) {
        expect(entry.docsUrl, `${keyword}.docsUrl`).toMatch(/^https:\/\//);
      }
    }
  });
});

// ─── ScimApiError class ─────────────────────────────────────────────

describe('Phase K3 - ScimApiError', () => {
  it('is an instance of Error so existing `err instanceof Error` checks keep working', () => {
    const e = new ScimApiError({ status: 500, detail: 'boom' });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ScimApiError);
  });

  it('exposes status / scimType / detail / rawBody / requestId fields', () => {
    const e = new ScimApiError({
      status: 409,
      scimType: 'uniqueness',
      detail: 'userName already taken',
      rawBody: { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '409' },
      requestId: 'req-abc',
    });
    expect(e.status).toBe(409);
    expect(e.scimType).toBe('uniqueness');
    expect(e.detail).toBe('userName already taken');
    expect(e.rawBody).toEqual({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '409' });
    expect(e.requestId).toBe('req-abc');
  });

  it('uses detail as the Error.message so legacy try/catch surfaces still display the SCIM detail', () => {
    const e = new ScimApiError({ status: 400, detail: 'detail wins' });
    expect(e.message).toBe('detail wins');
  });

  it('falls back to "HTTP <status>" when detail is missing', () => {
    const e = new ScimApiError({ status: 500 });
    expect(e.message).toBe('HTTP 500');
  });
});

// ─── parseScimError pure function ───────────────────────────────────

describe('Phase K3 - parseScimError', () => {
  it('returns the canonical shape when given a ScimApiError', () => {
    const e = new ScimApiError({ status: 409, scimType: 'uniqueness', detail: 'dup' });
    const parsed: ParsedScimError = parseScimError(e);
    expect(parsed.status).toBe(409);
    expect(parsed.scimType).toBe('uniqueness');
    expect(parsed.detail).toBe('dup');
    expect(parsed.catalogEntry?.title).toBe(SCIM_ERROR_CATALOG.uniqueness.title);
  });

  it('returns a generic shape when given a plain Error (no SCIM context)', () => {
    const parsed = parseScimError(new Error('Network failure'));
    expect(parsed.status).toBeUndefined();
    expect(parsed.scimType).toBeUndefined();
    expect(parsed.detail).toBe('Network failure');
    // Still has a catalog entry under the generic key so the UI can
    // render a humane message instead of falling through to raw text.
    expect(parsed.catalogEntry?.title).toBeTruthy();
  });

  it('parses a string error (legacy code path that throws a string)', () => {
    const parsed = parseScimError('Something went wrong');
    expect(parsed.detail).toBe('Something went wrong');
    expect(parsed.catalogEntry?.title).toBeTruthy();
  });

  it('parses null / undefined gracefully (no crash, generic catalog entry)', () => {
    const a = parseScimError(null);
    const b = parseScimError(undefined);
    expect(a.catalogEntry?.title).toBeTruthy();
    expect(b.catalogEntry?.title).toBeTruthy();
    expect(a.detail).toBe('An unknown error occurred');
    expect(b.detail).toBe('An unknown error occurred');
  });

  it('looks up the catalog by scimType when present', () => {
    const e = new ScimApiError({ status: 400, scimType: 'mutability', detail: 'readOnly attempted' });
    const parsed = parseScimError(e);
    expect(parsed.catalogEntry).toBe(SCIM_ERROR_CATALOG.mutability);
  });

  it('falls back to the auth catalog entry on 401 even without a scimType', () => {
    const e = new ScimApiError({ status: 401, detail: 'Authentication required' });
    const parsed = parseScimError(e);
    expect(parsed.catalogEntry?.title).toMatch(/auth/i);
  });

  it('falls back to the forbidden catalog entry on 403 even without a scimType', () => {
    const e = new ScimApiError({ status: 403, detail: 'Forbidden' });
    const parsed = parseScimError(e);
    expect(parsed.catalogEntry?.title).toMatch(/forbidden|permission/i);
  });

  it('falls back to the precondition catalog entry on 428 (RequireIfMatch)', () => {
    const e = new ScimApiError({ status: 428, detail: 'If-Match required' });
    const parsed = parseScimError(e);
    expect(parsed.catalogEntry?.title).toMatch(/match|precondition/i);
  });

  it('falls back to the server-error catalog entry on 5xx without scimType', () => {
    const e = new ScimApiError({ status: 503, detail: 'Service unavailable' });
    const parsed = parseScimError(e);
    expect(parsed.catalogEntry?.title).toMatch(/server|unavailable/i);
  });

  it('preserves the rawBody so the UI can render a "View JSON" expander', () => {
    const body = { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], scimType: 'uniqueness' };
    const e = new ScimApiError({ status: 409, scimType: 'uniqueness', detail: 'dup', rawBody: body });
    const parsed = parseScimError(e);
    expect(parsed.rawBody).toEqual(body);
  });
});
