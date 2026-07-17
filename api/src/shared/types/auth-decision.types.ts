/**
 * Auth Decision types (WI-D3/D5) - shared between the API
 * ([auth-decision-trace.ts](../../oauth/auth-decision-trace.ts),
 * [auth-decision-record.store.ts](../../oauth/auth-decision-record.store.ts),
 * [auth-decisions.controller.ts](../../modules/scim/controllers/auth-decisions.controller.ts))
 * and the web Auth Diagnostics UI (via the `@scim/types` path alias).
 *
 * Only NON-SECRET identifiers are ever carried here - a JWT is signed, not
 * encrypted, so decoded claim identifiers + the JOSE header are safe; the raw
 * assertion, signature, and any bearer token are NEVER present.
 *
 * The shape mirrors the server-internal `AuthDecisionTrace` + the store's
 * `AuthDecisionRecord`. It is a read model for the diagnostics panel.
 */

export type AuthPlaneKind = 'token-mint' | 'resource';
export type AuthMethodKind = 'wif' | 'oauth_client' | 'shared_secret' | 'bearer_jwt' | 'endpoint_bearer';
export type AuthOutcome = 'accept' | 'reject';
export type AuthCheckStatus = 'pass' | 'fail' | 'skipped';

/** One ordered validation step in a decision. */
export interface AuthCheck {
  id: string;
  status: AuthCheckStatus;
  expected?: string;
  received?: string;
  detail?: string;
}

/** A recent auth decision, as returned by the admin auth-decisions API. */
export interface AuthDecisionRecord {
  id: string;
  recordedAt: string;
  plane: AuthPlaneKind;
  method: AuthMethodKind;
  outcome: AuthOutcome;
  reasonCode?: string;
  selectedTrustId?: string;
  endpointId?: string;
  correlationId?: string;
  checks: AuthCheck[];
  decodedClaims?: Record<string, unknown>;
  joseHeader?: Record<string, unknown>;
  subTraces?: AuthDecisionRecord[];
}

/** Response shape of GET /scim/admin/auth-decisions[ /endpoints/:id ]. */
export interface AuthDecisionsResponse {
  count: number;
  records: AuthDecisionRecord[];
}
