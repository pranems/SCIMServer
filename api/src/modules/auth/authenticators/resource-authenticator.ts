/**
 * ResourceAuthenticator seam (W2.1) - the resource-plane sibling of the
 * mint-plane `IAssertionTokenProvider`.
 *
 * The resource-plane auth is a PROBE-CHAIN: a single `Authorization: Bearer
 * <token>` could be a per-endpoint opaque secret, an endpoint-scoped OAuth JWT,
 * or the global shared secret, and the server cannot know which without trying.
 * This mirrors Spring Security's `ProviderManager` + `AuthenticationProvider`
 * model, where each provider signals "success, fail, or cannot decide and let a
 * downstream provider decide". The three outcomes are load-bearing:
 *
 *   - `not-applicable` ("cannot decide")  -> CONTINUE to the next authenticator.
 *   - `accept`         ("success")        -> STOP, allow.
 *   - `reject`         ("fail" = mine but invalid) -> STOP, deny. NEVER falls
 *     through - collapsing a reject into not-applicable would reintroduce
 *     downgrade-confusion (e.g. an endpoint-scoped token presented to the wrong
 *     endpoint, or a refused global secret, must reject, not fall through).
 *
 * The `SharedSecretGuard` composes the chain and owns the cross-cutting
 * concerns (shared-secret resolution, decision-trace accumulation + terminal
 * emission, the RFC 6750 reject response). Each authenticator owns ONE method's
 * lookup + validation + enablement and returns a structured `AuthAttempt`; it
 * does NOT write the HTTP response or emit the canonical decision event.
 */
import type { Request } from 'express';
import type { AuthCheck, AuthMethodKind } from '../../../oauth/auth-decision-trace';

/** Request augmented with the resolved auth identity (set by an accepting authenticator). */
export interface AuthenticatedRequest extends Request {
  oauth?: Record<string, unknown>;
  authType?: 'oauth' | 'legacy' | 'endpoint_credential';
  authCredentialId?: string;
}

/** Everything an authenticator needs, resolved once by the guard. */
export interface AuthContext {
  /** The bearer token (the value after `Bearer `). */
  token: string;
  /** The request (an authenticator may mutate it via an accept `apply`). */
  request: AuthenticatedRequest;
  /** The endpoint id from the URL, or null for a global/admin route. */
  endpointId: string | null;
  /** The configured global SCIM shared secret (already resolved by the guard). */
  expectedSecret: string;
}

/** The three-outcome result of one authenticator (Spring's success/fail/cannot-decide). */
export type AuthAttempt =
  | {
      /** "cannot decide" - not this authenticator's token; the guard continues. */
      outcome: 'not-applicable';
      checks?: AuthCheck[];
      /**
       * A specific fall-through sub-reason (e.g. an expired/invalid JWT) that the
       * guard should prefer for the TERMINAL reject if no later authenticator
       * accepts. Preserves the F3 `bearer_oauth_expired` / `_signature_invalid`
       * specificity over the generic `bearer_invalid`.
       */
      fallthroughReason?: string;
    }
  | {
      /** "success" - the guard stops and allows. */
      outcome: 'accept';
      method: AuthMethodKind;
      checks?: AuthCheck[];
      /** Applied by the guard to stamp the resolved identity onto the request. */
      apply?: (req: AuthenticatedRequest) => void;
    }
  | {
      /** "fail" (mine but invalid) - the guard stops and denies. NEVER falls through. */
      outcome: 'reject';
      method: AuthMethodKind;
      reasonCode: string;
      detail: string;
      errorCode?: 'invalid_token' | 'invalid_request' | 'insufficient_scope';
      checks?: AuthCheck[];
    };

/** One resource-plane authentication method. Ordered; probed by the guard in `order`. */
export interface ResourceAuthenticator {
  /** The canonical method kind recorded on the decision trace. */
  readonly method: AuthMethodKind;
  /** Chain priority (ascending). Encodes the precedence policy; keep it explicit + tested. */
  readonly order: number;
  /** Probe: accept / reject-stop / not-applicable-continue. Never writes the HTTP response. */
  tryAuthenticate(ctx: AuthContext): Promise<AuthAttempt>;
}
