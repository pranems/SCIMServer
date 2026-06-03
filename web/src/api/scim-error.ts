/**
 * scim-error.ts - Phase K3 structured error layer.
 *
 * Three exports collaborate to give the redesigned UI a single, humane
 * error-handling surface:
 *
 *   1. `ScimApiError` - subclass of Error thrown by `fetchWithAuth`.
 *      Carries `status`, optional `scimType`, server `detail`, raw
 *      response body, and request id for the diagnostics extension.
 *
 *   2. `SCIM_ERROR_CATALOG` - per-`scimType` (and a few HTTP-status
 *      fallbacks) plain-English title + explanation + optional RFC
 *      docs URL. Locked by [scim-error.test.ts](./scim-error.test.ts)
 *      against RFC 7644 Table 9 + the project's published vocabulary
 *      ([docs/LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md](../../../docs/LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md) S16).
 *
 *   3. `parseScimError(unknown)` - pure normalizer that converts any
 *      caught value into a `ParsedScimError` shape the
 *      `<ScimErrorMessage />` primitive can render unconditionally.
 *      Handles `ScimApiError`, plain `Error`, string, null, undefined.
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S5.7
 * @see docs/PHASE_K3_SMART_ERROR_EXPLAINER.md
 * @see docs/LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md S16-S18
 */

// ─── Catalog data type ──────────────────────────────────────────────

export interface ScimErrorCatalogEntry {
  /** Short title shown in the MessageBar header. */
  title: string;
  /** Plain-English one-sentence operator-readable explanation. */
  explanation: string;
  /** Optional external docs link (must start with https:// when present). */
  docsUrl?: string;
}

/**
 * The per-scimType + per-status catalog. Keys are SCIM `scimType`
 * keywords from RFC 7644 Table 9 plus the project's extensions
 * (`versionMismatch`, `tooLarge`), plus numeric-string HTTP-status
 * fallbacks for surfaces that lack a `scimType` (auth failures,
 * server errors, precondition required).
 */
export const SCIM_ERROR_CATALOG: Record<string, ScimErrorCatalogEntry> = {
  // ─── RFC 7644 Table 9 vocabulary ─────────────────────────────────
  uniqueness: {
    title: 'Duplicate value',
    explanation:
      'A unique attribute (for example userName, externalId, or displayName) already exists on another resource. Pick a different value or look up the existing record.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.12',
  },
  invalidFilter: {
    title: 'Invalid filter syntax',
    explanation:
      'The SCIM filter expression in the request could not be parsed. Common causes: missing quotes around string values, unknown attribute name, or unsupported operator.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2',
  },
  invalidSyntax: {
    title: 'Invalid request body',
    explanation:
      'The request body is not valid JSON or does not match the expected SCIM payload shape. Check the schemas[] array and required attributes for the resource type.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.12',
  },
  invalidPath: {
    title: 'Invalid attribute path',
    explanation:
      'A PATCH operation referenced a path the server does not recognise. Verify the attribute exists in /Schemas and that any value-filter syntax (for example emails[type eq "work"]) is correct.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.5.2',
  },
  noTarget: {
    title: 'No matching target',
    explanation:
      'A PATCH op or filtered request targeted an attribute or value-filter that did not match anything on the resource.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.12',
  },
  invalidValue: {
    title: 'Invalid attribute value',
    explanation:
      'The value supplied for an attribute does not satisfy the schema (wrong type, out of canonical-values list, or invalid format).',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7643#section-2.2',
  },
  mutability: {
    title: 'Read-only or immutable attribute',
    explanation:
      'The request tried to set or modify an attribute that the schema declares as readOnly or immutable. Check the attribute mutability via /Schemas.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7643#section-2.2',
  },
  invalidVers: {
    title: 'Unsupported SCIM version',
    explanation:
      'The endpoint URL referenced a SCIM version this server does not implement. SCIMServer publishes its supported version on /ServiceProviderConfig.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.12',
  },
  sensitive: {
    title: 'Sensitive operation rejected',
    explanation:
      'The server refused to honour the request because it would expose or alter sensitive data through an unsafe channel.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.12',
  },
  tooMany: {
    title: 'Too many results',
    explanation:
      'The query would return more results than the server allows. Apply a more specific filter or use pagination (startIndex + count).',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2',
  },

  // ─── Project-level extensions (server emits these too) ───────────
  versionMismatch: {
    title: 'Resource changed since last read',
    explanation:
      'The If-Match ETag did not match the resource\'s current version. Reload the resource and reapply your edits, or use "Force overwrite".',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.14',
  },
  tooLarge: {
    title: 'Request body too large',
    explanation:
      'The Bulk request exceeded the 1 MB / 1000-operation limit. Split the batch into smaller chunks.',
  },

  // ─── Numeric-status fallbacks (no scimType present) ──────────────
  '__http_401__': {
    title: 'Authentication required',
    explanation:
      'Your bearer token is missing, expired, or invalid. The token dialog will open so you can paste a fresh one.',
  },
  '__http_403__': {
    title: 'Permission denied',
    explanation:
      'The token is valid but does not have permission for this action. Check the endpoint\'s per-credential scope or the global SCIM_SHARED_SECRET configuration.',
  },
  '__http_404__': {
    title: 'Not found',
    explanation:
      'The resource you requested does not exist at this endpoint. It may have been deleted, or you may be looking at the wrong endpoint scope.',
  },
  '__http_412__': {
    title: 'Precondition failed',
    explanation:
      'The If-Match header you sent did not match the server\'s current version. Reload and retry.',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644#section-3.14',
  },
  '__http_415__': {
    title: 'Unsupported media type',
    explanation:
      'SCIM requires application/json or application/scim+json. Set the Content-Type header on your request.',
  },
  '__http_428__': {
    title: 'If-Match required',
    explanation:
      'This endpoint enforces RequireIfMatch. Provide an If-Match header carrying the resource\'s current ETag (e.g. W/"v3").',
    docsUrl: 'https://datatracker.ietf.org/doc/html/rfc6585#section-3',
  },
  '__http_5xx__': {
    title: 'Server error',
    explanation:
      'The server encountered an unexpected condition. Check /admin/log-config/recent for the structured error entry, then look up the requestId in the ring buffer.',
  },
  '__generic__': {
    title: 'Something went wrong',
    explanation:
      'An unexpected error occurred. Open the View details expander or the network tab for the raw response.',
  },
} as const;

// ─── Error class ────────────────────────────────────────────────────

export interface ScimApiErrorOptions {
  status: number;
  scimType?: string;
  detail?: string;
  rawBody?: unknown;
  requestId?: string;
}

/**
 * Subclass of Error thrown by `fetchWithAuth` for every non-OK
 * response. Existing `err instanceof Error` guards continue to match
 * (subclass relationship) so this is fully backward-compatible.
 */
export class ScimApiError extends Error {
  readonly status: number;
  readonly scimType?: string;
  readonly detail?: string;
  readonly rawBody?: unknown;
  readonly requestId?: string;

  constructor(options: ScimApiErrorOptions) {
    super(options.detail ?? `HTTP ${options.status}`);
    this.name = 'ScimApiError';
    this.status = options.status;
    this.scimType = options.scimType;
    this.detail = options.detail;
    this.rawBody = options.rawBody;
    this.requestId = options.requestId;
  }
}

// ─── Parser ─────────────────────────────────────────────────────────

export interface ParsedScimError {
  /** HTTP status code if known. */
  status?: number;
  /** RFC 7644 scimType keyword if present on the response. */
  scimType?: string;
  /** Server-provided `detail` string (or message of a non-API Error). */
  detail: string;
  /** Catalog entry for the operator-facing copy (always non-undefined). */
  catalogEntry: ScimErrorCatalogEntry;
  /** Raw error body (when available) so the UI can render a JSON expander. */
  rawBody?: unknown;
  /** Request id correlator (when present). */
  requestId?: string;
}

/**
 * Resolve a status-fallback catalog entry for a given HTTP status code.
 * Prefers exact 4xx mapping; collapses all 5xx onto the shared entry.
 */
function lookupStatusFallback(status: number | undefined): ScimErrorCatalogEntry {
  if (status === undefined) return SCIM_ERROR_CATALOG.__generic__;
  if (status === 401) return SCIM_ERROR_CATALOG.__http_401__;
  if (status === 403) return SCIM_ERROR_CATALOG.__http_403__;
  if (status === 404) return SCIM_ERROR_CATALOG.__http_404__;
  if (status === 412) return SCIM_ERROR_CATALOG.__http_412__;
  if (status === 415) return SCIM_ERROR_CATALOG.__http_415__;
  if (status === 428) return SCIM_ERROR_CATALOG.__http_428__;
  if (status >= 500 && status < 600) return SCIM_ERROR_CATALOG.__http_5xx__;
  return SCIM_ERROR_CATALOG.__generic__;
}

/**
 * Convert any caught value into a renderable `ParsedScimError`.
 * Pure - no side effects, no React.
 */
export function parseScimError(err: unknown): ParsedScimError {
  // ── 1. ScimApiError (the common case) ──────────────────────────
  if (err instanceof ScimApiError) {
    const catalogEntry =
      (err.scimType && SCIM_ERROR_CATALOG[err.scimType]) ||
      lookupStatusFallback(err.status);
    return {
      status: err.status,
      scimType: err.scimType,
      detail: err.detail ?? err.message,
      catalogEntry,
      rawBody: err.rawBody,
      requestId: err.requestId,
    };
  }

  // ── 2. Plain Error (network failure, JSON parse error, etc.) ──
  if (err instanceof Error) {
    return {
      detail: err.message,
      catalogEntry: SCIM_ERROR_CATALOG.__generic__,
    };
  }

  // ── 3. String error ─────────────────────────────────────────────
  if (typeof err === 'string') {
    return {
      detail: err,
      catalogEntry: SCIM_ERROR_CATALOG.__generic__,
    };
  }

  // ── 4. null / undefined / unknown shape ─────────────────────────
  return {
    detail: 'An unknown error occurred',
    catalogEntry: SCIM_ERROR_CATALOG.__generic__,
  };
}
