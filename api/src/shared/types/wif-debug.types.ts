/**
 * WI-D7 - shared request/response contract for the WIF assertion debugger.
 *
 * The debugger runs the SAME server-side checks as a real token mint (real
 * JWKS fetch + signature + claim matching) against each configured WIF trust
 * for an endpoint, but NEVER mints a token. It returns the decision outcome
 * plus the per-check `AuthDecisionTrace` so an operator can paste a
 * `client_assertion` and see exactly which claim fails BEFORE wiring the IdP.
 *
 * Mirrored on the web client (`web/src/api/queries.ts`).
 */
import type { AuthDecisionTrace } from '../../oauth/auth-decision-trace';

/** Request body: the raw client_assertion (a signed JWT) to dry-run. */
export interface WifDebugAssertionRequest {
  /** The `client_assertion` JWT to decode + dry-run. Required. */
  assertion: string;
}

/** One trust's dry-run outcome. */
export interface WifDebugTrustResult {
  /** Human label for the trust (its expected issuer). */
  expectedIssuer: string;
  /** `accept` when this trust would have minted; `reject` otherwise. */
  outcome: 'accept' | 'reject';
  /** Reason code from the auth-reason catalog when rejected. */
  reasonCode?: string;
  /** The full per-check expected-vs-received trace (non-secret). */
  trace: AuthDecisionTrace;
}

/** Response body: one result per configured WIF trust, newest-config first. */
export interface WifDebugAssertionResponse {
  /** `accept` when ANY trust accepted the assertion; `reject` otherwise. */
  overallOutcome: 'accept' | 'reject';
  /** Per-trust dry-run results. Empty when the endpoint has no WIF trust. */
  results: WifDebugTrustResult[];
}
