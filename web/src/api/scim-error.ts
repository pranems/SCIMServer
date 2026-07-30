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

  // ─── WI-D8: auth-failure reason codes (mirror the API WI-D2 catalog) ─
  // Keyed by the `reason_code` an OAuth token error / auth-decision carries.
  // parseScimError prefers a reasonCode hit over scimType / status fallback so
  // an operator sees the specific auth remediation, not a generic 401/403.
  wif_no_trust_configured: {
    title: 'No federated-identity trust configured',
    explanation:
      'This endpoint has no WIF trust. Create a WIF credential and enable WifCredentialsEnabled, then retry.',
  },
  wif_no_trust_accepted: {
    title: 'No WIF trust accepted the assertion',
    explanation:
      'Multi-trust: none of the configured trusts matched the assertion. Check which trust should match the assertion issuer, and use the assertion debugger in the Credentials WIF sub-tab to see the per-check diff.',
  },
  jwks_host_not_allowlisted: {
    title: 'JWKS host not allow-listed',
    explanation:
      "The trust's JWKS host is not permitted by the server allowlist. Add or edit the host under Settings > JWKS host allowlist.",
  },
  jwks_scheme_not_https: {
    title: 'JWKS URI must use https',
    explanation: 'Fix the trust jwksUri to an https URL.',
  },
  jwks_unreachable: {
    title: 'Identity-provider key set unreachable',
    explanation:
      "The identity provider's JWKS could not be retrieved. Transient or network/allowlist issue; retry and verify the JWKS URL resolves.",
  },
  assertion_malformed: {
    title: 'Client assertion is malformed',
    explanation: 'The client assertion is not a well-formed JWT. Verify the IdP is sending a compact JWS.',
  },
  assertion_signature_invalid: {
    title: 'Assertion signature did not verify',
    explanation:
      'The assertion signature did not verify against the IdP keys. Likely key rotation or a wrong jwksUri; confirm the IdP signing key is published at that JWKS.',
  },
  assertion_alg_not_allowed: {
    title: 'Assertion algorithm not permitted',
    explanation: 'The assertion signing algorithm is not permitted (RS256/ES256 only). The IdP must sign with RS256 or ES256.',
  },
  assertion_expired: {
    title: 'Assertion expired or not yet valid',
    explanation: 'The client assertion is expired or not yet valid. Check clock skew and request a fresh assertion.',
  },
  wif_issuer_mismatch: {
    title: 'Assertion issuer mismatch',
    explanation:
      "The assertion issuer did not match the trust expectedIssuer. Align expectedIssuer with the IdP's iss (v2.0 vs v1.0 differs).",
  },
  wif_subject_mismatch: {
    title: 'Assertion subject mismatch',
    explanation: 'The assertion subject did not match the trust expectedSubject. Align expectedSubject with the service-principal object id.',
  },
  wif_audience_mismatch: {
    title: 'Assertion audience mismatch',
    explanation:
      "The assertion audience did not match the trust expectedAudience. Align expectedAudience; in Entra set the resource app's Application ID URI.",
  },
  wif_tenant_mismatch: {
    title: 'Assertion tenant mismatch',
    explanation: 'The assertion tenant did not match the trust allowedTenantId. Align allowedTenantId with the IdP tid.',
  },
  wif_missing_role: {
    title: 'Assertion missing a required role',
    explanation: 'The assertion is missing a required role. Grant the app role in the IdP, or remove it from requiredRoles.',
  },
  assertion_missing_claim: {
    title: 'Assertion missing a required claim',
    explanation: 'The assertion is missing a required claim. Ensure the IdP emits sub/aud/iss/tid.',
  },
  oauth_client_auth_failed: {
    title: 'Client authentication failed',
    explanation:
      'The client id or secret is wrong (the two are deliberately indistinguishable on the wire). Re-copy the client credentials from the Connect tab and retry.',
  },
  grant_type_unsupported: {
    title: 'Unsupported grant type',
    explanation: 'Only client_credentials is supported. Send grant_type=client_credentials.',
  },
  missing_credentials: {
    title: 'No client credentials presented',
    explanation: 'Provide client_secret (oauth_client) or client_assertion (WIF jwt-bearer).',
  },
  mutually_exclusive_credentials: {
    title: 'Both secret and assertion presented',
    explanation: 'Send exactly one of client_secret or client_assertion, not both.',
  },
  unsupported_assertion_type: {
    title: 'Wrong client_assertion_type',
    explanation:
      'Set client_assertion_type to urn:ietf:params:oauth:client-assertion-type:jwt-bearer.',
  },
  bearer_missing: {
    title: 'No bearer token presented',
    explanation: 'Send an Authorization: Bearer <token> header.',
  },
  bearer_token_scoped_other_endpoint: {
    title: 'Token scoped to a different endpoint',
    explanation:
      'This bearer token was minted for another endpoint (its endpoint_id claim does not match this URL). Use a token minted for THIS endpoint from its Connect tab.',
  },
  bearer_shared_secret_refused: {
    title: 'Global shared secret refused here',
    explanation:
      'This endpoint does not accept the global SCIM shared secret (SharedSecretBearerAuthEnabled is off). Use a per-endpoint bearer or OAuth token, or re-enable the flag in Settings.',
  },
  bearer_oauth_expired: {
    title: 'Bearer token expired',
    explanation: 'The bearer token is expired. Mint a fresh token at the token endpoint and retry.',
  },
  bearer_oauth_signature_invalid: {
    title: 'Bearer token signature did not verify',
    explanation: 'The bearer token signature did not verify (the signing key may have rotated). Mint a fresh token and retry.',
  },
  bearer_invalid: {
    title: 'Invalid bearer token',
    explanation: 'The bearer token is not valid. Mint a fresh token at the token endpoint and retry.',
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
  /** WI-D8: the auth-failure reason_code from an OAuth token error body. */
  reasonCode?: string;
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
  /** WI-D8: the auth-failure reason_code from an OAuth token error body. */
  readonly reasonCode?: string;

  constructor(options: ScimApiErrorOptions) {
    super(options.detail ?? `HTTP ${options.status}`);
    this.name = 'ScimApiError';
    this.status = options.status;
    this.scimType = options.scimType;
    this.detail = options.detail;
    this.rawBody = options.rawBody;
    this.requestId = options.requestId;
    this.reasonCode = options.reasonCode;
  }
}

// ─── Parser ─────────────────────────────────────────────────────────

export interface ParsedScimError {
  /** HTTP status code if known. */
  status?: number;
  /** RFC 7644 scimType keyword if present on the response. */
  scimType?: string;
  /** WI-D8: auth-failure reason_code if present on an OAuth token error. */
  reasonCode?: string;
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
      (err.reasonCode && SCIM_ERROR_CATALOG[err.reasonCode]) ||
      (err.scimType && SCIM_ERROR_CATALOG[err.scimType]) ||
      lookupStatusFallback(err.status);
    return {
      status: err.status,
      scimType: err.scimType,
      reasonCode: err.reasonCode,
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
