/**
 * WI-D3: The Auth Decision Trace.
 *
 * A server-internal object built during token-mint / resource authentication.
 * Instead of throwing an opaque error at the first failed check, a validator
 * records each check as a structured step, then the surrounding layers render
 * that ONE object at three fidelities:
 *   - the actor response (reason_code + error_description + correlation_id),
 *   - the structured AUTH log event (WI-D4),
 *   - the short-TTL admin Auth Decision Record (WI-D5) that powers the UI diff.
 *
 * Because the wire reason_code, the log, and the UI diff all derive from the
 * SAME trace, they can never drift. `decodedClaims`/`joseHeader` are non-secret
 * identifiers (a JWT is signed, not encrypted); the raw signature and any
 * bearer token are NEVER placed in the trace.
 *
 * See docs/auth/AUTH_ERROR_DIAGNOSTICS_AND_OBSERVABILITY.md Part 6.
 */

import { getAuthReason, isKnownAuthReason } from './auth-reason-catalog';

export type AuthPlaneKind = 'token-mint' | 'resource';
export type AuthMethodKind = 'wif' | 'oauth_client' | 'shared_secret' | 'bearer_jwt' | 'endpoint_bearer';
export type AuthOutcome = 'accept' | 'reject';
export type AuthCheckStatus = 'pass' | 'fail' | 'skipped';

/** One ordered validation step in a trace. */
export interface AuthCheck {
  /** Stable check id (e.g. `jwks_host_allowlisted`, `issuer_match`). */
  id: string;
  status: AuthCheckStatus;
  /** What the trust/config required (non-secret). */
  expected?: string;
  /** What actually arrived (non-secret). */
  received?: string;
  /** Curated one-liner. */
  detail?: string;
}

export interface AuthDecisionTrace {
  correlationId?: string;
  endpointId?: string;
  plane: AuthPlaneKind;
  method: AuthMethodKind;
  outcome: AuthOutcome;
  /** One of the catalog reason codes; present when `outcome === 'reject'`. */
  reasonCode?: string;
  /** WIF multi-trust (WI-16/17): which trust was selected/accepted. */
  selectedTrustId?: string;
  checks: AuthCheck[];
  /** Non-secret decoded JWT claims (identifiers only). */
  decodedClaims?: Record<string, unknown>;
  /** Non-secret JOSE header (alg, kid). */
  joseHeader?: Record<string, unknown>;
  /** WIF multi-trust: a per-trust sub-trace for each rejected trust. */
  subTraces?: AuthDecisionTrace[];
}

/**
 * Incrementally build a trace. A validator records each check as it runs, then
 * calls `reject(reasonCode)` on the first failure or `accept()` at the end.
 */
export class AuthDecisionTraceBuilder {
  private readonly checks: AuthCheck[] = [];
  private decodedClaims?: Record<string, unknown>;
  private joseHeader?: Record<string, unknown>;
  private selectedTrustId?: string;
  private outcome: AuthOutcome = 'reject';
  private reasonCode?: string;

  constructor(
    private readonly plane: AuthPlaneKind,
    private readonly method: AuthMethodKind,
    private readonly context: { correlationId?: string; endpointId?: string } = {},
  ) {}

  pass(id: string, fields: Omit<AuthCheck, 'id' | 'status'> = {}): this {
    this.checks.push({ id, status: 'pass', ...fields });
    return this;
  }

  fail(id: string, fields: Omit<AuthCheck, 'id' | 'status'> = {}): this {
    this.checks.push({ id, status: 'fail', ...fields });
    return this;
  }

  skip(id: string, fields: Omit<AuthCheck, 'id' | 'status'> = {}): this {
    this.checks.push({ id, status: 'skipped', ...fields });
    return this;
  }

  setDecodedClaims(claims: Record<string, unknown> | undefined): this {
    this.decodedClaims = claims ? sanitizeClaims(claims) : undefined;
    return this;
  }

  setJoseHeader(header: Record<string, unknown> | undefined): this {
    this.joseHeader = header ? sanitizeJoseHeader(header) : undefined;
    return this;
  }

  setSelectedTrustId(id: string | undefined): this {
    this.selectedTrustId = id;
    return this;
  }

  /** Mark the decision accepted (clears any pending reason code). */
  accept(): this {
    this.outcome = 'accept';
    this.reasonCode = undefined;
    return this;
  }

  /** Mark the decision rejected with a catalog reason code. */
  reject(reasonCode: string): this {
    this.outcome = 'reject';
    // Guard: only catalog codes are recorded so the wire/UI never see an
    // uncatalogued reason. An unknown code degrades to undefined (generic).
    this.reasonCode = isKnownAuthReason(reasonCode) ? reasonCode : undefined;
    return this;
  }

  build(subTraces?: AuthDecisionTrace[]): AuthDecisionTrace {
    const trace: AuthDecisionTrace = {
      plane: this.plane,
      method: this.method,
      outcome: this.outcome,
      checks: [...this.checks],
    };
    if (this.context.correlationId) trace.correlationId = this.context.correlationId;
    if (this.context.endpointId) trace.endpointId = this.context.endpointId;
    if (this.reasonCode) trace.reasonCode = this.reasonCode;
    if (this.selectedTrustId) trace.selectedTrustId = this.selectedTrustId;
    if (this.decodedClaims) trace.decodedClaims = this.decodedClaims;
    if (this.joseHeader) trace.joseHeader = this.joseHeader;
    if (subTraces && subTraces.length > 0) trace.subTraces = subTraces;
    return trace;
  }
}

/**
 * The non-secret claim identifiers we keep in a trace. Everything else
 * (especially anything secret-looking) is dropped.
 */
const NON_SECRET_CLAIM_KEYS = new Set([
  'iss',
  'sub',
  'aud',
  'tid',
  'roles',
  'appid',
  'azp',
  'oid',
  'exp',
  'nbf',
  'iat',
]);

function sanitizeClaims(claims: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(claims)) {
    if (NON_SECRET_CLAIM_KEYS.has(k)) out[k] = v;
  }
  return out;
}

function sanitizeJoseHeader(header: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['alg', 'kid', 'typ']) {
    if (header[k] !== undefined) out[k] = header[k];
  }
  return out;
}

/**
 * Classify a JWKS/jose verification error into a catalog reason code. jose
 * throws Errors carrying a `code` property (ERR_JWT_EXPIRED, etc.); the JWKS
 * validator throws plain Errors with distinctive messages for host/scheme/fetch.
 */
export function mapJwksErrorToReason(err: unknown): string {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
  const message = err instanceof Error ? err.message : String(err);

  // jose error codes (structured).
  if (code === 'ERR_JWT_EXPIRED') return 'assertion_expired';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && /nbf|exp/i.test(message)) return 'assertion_expired';
  if (code === 'ERR_JOSE_ALG_NOT_ALLOWED') return 'assertion_alg_not_allowed';
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'assertion_signature_invalid';
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return 'assertion_signature_invalid';
  if (code === 'ERR_JWS_INVALID' || code === 'ERR_JWT_MALFORMED') return 'assertion_malformed';

  // JWKS-validator plain-Error messages (message-classified).
  if (/must use https/i.test(message)) return 'jwks_scheme_not_https';
  if (/not permitted by the JWKS_HOST_ALLOWLIST|not permitted by the .*allowlist/i.test(message))
    return 'jwks_host_not_allowlisted';
  if (/JWKS unavailable|JWKS fetch returned|Invalid jwksUri/i.test(message)) return 'jwks_unreachable';
  if (/expired|not within|nbf|not yet valid/i.test(message)) return 'assertion_expired';
  if (/signature/i.test(message)) return 'assertion_signature_invalid';
  if (/algorithm|alg/i.test(message)) return 'assertion_alg_not_allowed';
  if (/malformed|Invalid Compact JWS|decode/i.test(message)) return 'assertion_malformed';

  // Fallback: a signature-plane failure we could not classify more precisely.
  return 'assertion_signature_invalid';
}

/** The catalog remediation + wire error for a trace's reason code (UI/log helper). */
export function describeTraceReason(trace: Pick<AuthDecisionTrace, 'reasonCode'>) {
  return getAuthReason(trace.reasonCode);
}

/**
 * WI-D4 - the canonical AUTH decision log message. Exactly ONE event with this
 * message is emitted per auth attempt (accept or reject), so an operator can
 * alert on / count / filter auth decisions without matching ad-hoc phrasings.
 */
export const AUTH_DECISION_EVENT = 'Auth decision';

/** The minimal logger surface the emitter needs (matches ScimLogger). */
export interface AuthDecisionLogger {
  info(category: string, message: string, data?: Record<string, unknown>): void;
  warn(category: string, message: string, data?: Record<string, unknown>): void;
}

/**
 * WI-D4 - emit one structured, redacted, alert-friendly AUTH decision event
 * for a completed auth attempt, derived from its trace. Flows through the
 * existing ScimLogger (ring buffer + SSE + file) - NOT a parallel mechanism.
 *
 * An `accept` is logged at INFO, a `reject` at WARN. The payload carries the
 * outcome, reason code, method/plane, endpoint + correlation id, a compact
 * check summary (failed check ids + counts - never the raw values), and the
 * non-secret decoded-claim identifiers. The raw assertion/token is never here.
 */
export function emitAuthDecisionEvent(
  logger: AuthDecisionLogger,
  trace: AuthDecisionTrace,
  logCategoryAuth: string,
): void {
  const failedChecks = trace.checks.filter((c) => c.status === 'fail').map((c) => c.id);
  const data: Record<string, unknown> = {
    outcome: trace.outcome,
    method: trace.method,
    plane: trace.plane,
    reasonCode: trace.reasonCode,
    endpointId: trace.endpointId,
    correlationId: trace.correlationId,
    selectedTrustId: trace.selectedTrustId,
    checkCount: trace.checks.length,
    failedChecks,
    // Non-secret decoded identifiers only (already sanitized on the builder).
    decodedClaims: trace.decodedClaims,
    // For a multi-trust reject, how many sub-traces (per-trust) were recorded.
    subTraceCount: trace.subTraces?.length,
  };
  // Drop undefined keys so the log line stays clean.
  for (const k of Object.keys(data)) {
    if (data[k] === undefined) delete data[k];
  }
  if (trace.outcome === 'accept') {
    logger.info(logCategoryAuth, AUTH_DECISION_EVENT, data);
  } else {
    logger.warn(logCategoryAuth, AUTH_DECISION_EVENT, data);
  }
}

