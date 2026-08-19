/**
 * WI-D2: The auth-failure reason-code catalog.
 *
 * A stable, bounded allowlist of reason codes that every auth-failure surface
 * (the on-the-wire token error, the AUTH log event, and the admin UI diagnostics
 * panel) derives from, so the wire code, the human description, the log, and the
 * UI can never drift. Codes are ADDITIVE and never repurposed - clients, docs,
 * and the UI rely on their stability.
 *
 * See docs/auth/AUTH_ERROR_DIAGNOSTICS_AND_OBSERVABILITY.md Part 7 (the catalog)
 * and Part 8 (the visibility tiers).
 */

/**
 * The RFC-6749 top-level `error` value a reason maps to on the token endpoint.
 * We never invent new top-level `error` values (P1) - specificity lives in the
 * `reason_code` + `error_description`, exactly as Entra does.
 */
export type WireError =
  | 'invalid_client'
  | 'invalid_request'
  | 'unsupported_grant_type'
  | 'invalid_token';

/**
 * Visibility tier (Part 8). Governs how much of the reason reaches the actor on
 * the wire. The admin UI + logs always get full fidelity.
 * - T1 config-transparent: safe to reveal (caller proved IdP-key control).
 * - T2 protocol: request-shape errors, no secret content.
 * - T3 secret-opaque: must not distinguish existence vs correctness of a secret.
 * - T4 internal: server-internal faults, generic on wire, full detail log-only.
 */
export type VisibilityTier = 'T1' | 'T2' | 'T3' | 'T4';

/** Which auth plane a reason belongs to. */
export type AuthPlane = 'wif' | 'oauth_client' | 'bearer';

export interface AuthReasonEntry {
  /** The stable catalog code (never repurposed). */
  reasonCode: string;
  /** The RFC-6749 / RFC-6750 wire error this maps to. */
  wireError: WireError;
  /** The plane this reason belongs to. */
  plane: AuthPlane;
  /** The visibility tier that governs wire exposure. */
  tier: VisibilityTier;
  /**
   * The fixed one-line description shown to the ACTOR on the wire (T1/T2 only;
   * T3 is merged and T4 is generic - see `wireDescriptionFor`).
   */
  actorDescription: string;
  /** The admin/UI remediation hint (always full fidelity, never on the actor wire). */
  remediation: string;
}

/**
 * The complete catalog. Ordered by plane then by check order so the reference
 * endpoint reads top-to-bottom like the validation pipeline.
 */
export const AUTH_REASON_CATALOG: readonly AuthReasonEntry[] = [
  // 7.1 Token-mint plane - WIF jwt-bearer
  {
    reasonCode: 'wif_no_trust_configured',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'No federated-identity trust is configured for this endpoint.',
    remediation: 'Create a WIF credential, or enable WifCredentialsEnabled.',
  },
  {
    reasonCode: 'wif_no_trust_accepted',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'No configured WIF trust accepted the assertion.',
    remediation: "Multi-trust: check which trust should match the assertion's issuer.",
  },
  {
    reasonCode: 'jwks_host_not_allowlisted',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: "The trust's JWKS host is not permitted by the server allowlist.",
    remediation:
      'Add or edit the host in Settings > JWKS host allowlist (the well-known IdP seed is prepopulated as editable rows). Use POST /scim/admin/settings/jwks-hosts to add, PUT /scim/admin/settings/jwks-hosts/{id} to edit, or PATCH /scim/admin/settings/jwks-hosts to selectively add/remove.',
  },
  {
    reasonCode: 'jwks_scheme_not_https',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: "The trust's JWKS URI must use https.",
    remediation: 'Fix jwksUri to an https URL.',
  },
  {
    reasonCode: 'jwks_unreachable',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: "The identity provider's key set could not be retrieved.",
    remediation: 'Transient or network/allowlist issue; retry, verify the JWKS URL resolves.',
  },
  {
    reasonCode: 'assertion_malformed',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The client assertion is not a well-formed JWT.',
    remediation: 'Verify the IdP is sending a compact JWS.',
  },
  {
    reasonCode: 'assertion_signature_invalid',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The client assertion signature did not verify against the IdP keys.',
    remediation:
      'Key rotation or wrong jwksUri; confirm the IdP signing key is published at that JWKS.',
  },
  {
    reasonCode: 'assertion_alg_not_allowed',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The assertion signing algorithm is not permitted (RS256/ES256 only).',
    remediation: 'The IdP must sign with RS256 or ES256.',
  },
  {
    reasonCode: 'assertion_expired',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The client assertion is expired or not yet valid.',
    remediation: 'Check clock skew; request a fresh assertion.',
  },
  {
    reasonCode: 'wif_issuer_mismatch',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The assertion issuer did not match the configured expected issuer.',
    remediation: "Align expectedIssuer with the IdP's iss (v2.0 vs v1.0 differs).",
  },
  {
    reasonCode: 'wif_subject_mismatch',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The assertion subject did not match the configured expected subject.',
    remediation: 'Align expectedSubject with the service-principal object id.',
  },
  {
    reasonCode: 'wif_audience_mismatch',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The assertion audience did not match the configured expected audience.',
    remediation:
      "Align expectedAudience; in Entra set the resource app's Application ID URI. " +
      'If this started without a config change, the caller may have switched acquisition chain: ' +
      'SyncFabric emits api://<appId> on one and api://<appId>/<host> on the other. ' +
      'Register BOTH shapes as two WIF trusts on the endpoint - each still matches exactly.',
  },
  {
    reasonCode: 'wif_tenant_mismatch',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The assertion tenant did not match the configured allowed tenant.',
    remediation: 'Align allowedTenantId with the IdP tid.',
  },
  {
    reasonCode: 'wif_missing_role',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The assertion is missing a required role.',
    remediation: 'Grant the app role in the IdP, or remove it from requiredRoles.',
  },
  {
    reasonCode: 'assertion_missing_claim',
    wireError: 'invalid_client',
    plane: 'wif',
    tier: 'T1',
    actorDescription: 'The assertion is missing a required claim.',
    remediation: 'Ensure the IdP emits sub/aud/iss/tid.',
  },

  // 7.2 Token-mint plane - oauth_client and shared
  {
    reasonCode: 'oauth_client_auth_failed',
    wireError: 'invalid_client',
    plane: 'oauth_client',
    tier: 'T3',
    actorDescription: 'Client authentication failed.',
    remediation:
      'Deliberately merged (P2): client-not-found and secret-mismatch are indistinguishable on the wire; the log records credentialFound.',
  },
  {
    reasonCode: 'grant_type_unsupported',
    wireError: 'unsupported_grant_type',
    plane: 'oauth_client',
    tier: 'T2',
    actorDescription: 'Only client_credentials is supported.',
    remediation: 'Send grant_type=client_credentials.',
  },
  {
    reasonCode: 'missing_credentials',
    wireError: 'invalid_request',
    plane: 'oauth_client',
    tier: 'T2',
    actorDescription: 'Neither client_secret nor client_assertion present.',
    remediation: 'Provide client_secret (oauth_client) or client_assertion (WIF jwt-bearer).',
  },
  {
    reasonCode: 'mutually_exclusive_credentials',
    wireError: 'invalid_request',
    plane: 'oauth_client',
    tier: 'T2',
    actorDescription: 'Both client_secret and client_assertion present.',
    remediation: 'Send exactly one of client_secret or client_assertion.',
  },
  {
    reasonCode: 'unsupported_assertion_type',
    wireError: 'invalid_request',
    plane: 'oauth_client',
    tier: 'T2',
    actorDescription: 'client_assertion_type is not the jwt-bearer URN.',
    remediation:
      'Set client_assertion_type to urn:ietf:params:oauth:client-assertion-type:jwt-bearer.',
  },

  // 7.3 Resource plane - bearer
  {
    reasonCode: 'bearer_missing',
    wireError: 'invalid_token',
    plane: 'bearer',
    tier: 'T1',
    actorDescription: 'No credentials presented.',
    remediation: 'Send an Authorization: Bearer <token> header.',
  },
  {
    reasonCode: 'bearer_token_scoped_other_endpoint',
    wireError: 'invalid_token',
    plane: 'bearer',
    tier: 'T1',
    actorDescription: 'The token is scoped to a different endpoint.',
    remediation: 'Use a token minted for this endpoint (the endpoint_id claim must match the URL).',
  },
  {
    reasonCode: 'bearer_shared_secret_refused',
    wireError: 'invalid_token',
    plane: 'bearer',
    tier: 'T1',
    actorDescription: 'Shared-secret bearer auth is disabled for this endpoint.',
    remediation: 'Enable SharedSecretBearerAuthEnabled, or use a per-endpoint bearer/OAuth token.',
  },
  {
    reasonCode: 'bearer_oauth_expired',
    wireError: 'invalid_token',
    plane: 'bearer',
    tier: 'T1',
    actorDescription: 'The bearer token is expired.',
    remediation: 'Mint a fresh token at the token endpoint.',
  },
  {
    reasonCode: 'bearer_oauth_signature_invalid',
    wireError: 'invalid_token',
    plane: 'bearer',
    tier: 'T1',
    actorDescription: 'The bearer token signature did not verify.',
    remediation: 'Mint a fresh token; the signing key may have rotated.',
  },
  {
    reasonCode: 'bearer_invalid',
    wireError: 'invalid_token',
    plane: 'bearer',
    tier: 'T1',
    actorDescription: 'The bearer token is invalid.',
    remediation: 'Mint a fresh token at the token endpoint.',
  },
] as const;

/** O(1) lookup by reason code. */
const CATALOG_BY_CODE: ReadonlyMap<string, AuthReasonEntry> = new Map(
  AUTH_REASON_CATALOG.map((e) => [e.reasonCode, e]),
);

/** Look up a catalog entry by reason code, or undefined when unknown. */
export function getAuthReason(reasonCode: string | undefined | null): AuthReasonEntry | undefined {
  if (!reasonCode) return undefined;
  return CATALOG_BY_CODE.get(reasonCode);
}

/**
 * The description that is safe to place on the ACTOR wire for a reason code,
 * honoring the visibility tier:
 * - T1/T2: the specific actorDescription.
 * - T3: a merged/opaque description (never distinguishes secret existence vs correctness).
 * - T4: a generic description (internal fault, full detail is log-only).
 */
export function wireDescriptionFor(reasonCode: string | undefined | null): string | undefined {
  const entry = getAuthReason(reasonCode);
  if (!entry) return undefined;
  if (entry.tier === 'T4') return 'Authentication failed.';
  return entry.actorDescription;
}

/** Whether a reason code exists in the catalog. */
export function isKnownAuthReason(reasonCode: string | undefined | null): boolean {
  return getAuthReason(reasonCode) !== undefined;
}
