/**
 * Auth observability Phase 4 - the canonical CONFIG-TIME auth-administration
 * audit event.
 *
 * Where {@link emitAuthDecisionEvent} covers RUNTIME auth attempts (a token
 * mint or a resource-plane bearer check), this covers CONFIG-TIME auth changes
 * an operator makes: verifying/debugging a WIF trust, editing the JWKS host
 * allowlist, and toggling auth-affecting endpoint flags. Exactly ONE event with
 * the fixed {@link AUTH_ADMIN_EVENT} message is emitted per operation, so an
 * operator can alert on / count / filter config-time auth activity without
 * matching ad-hoc phrasings - the same discipline the runtime decision event
 * follows.
 *
 * All payloads are NON-SECRET: hostnames, flag names, credential/endpoint ids,
 * and reason codes only. A raw assertion, bearer token, or credential secret is
 * never present here (the WIF debug path passes `dryRun: true` and never mints).
 */

/** The minimal logger surface the emitter needs (matches ScimLogger). */
export interface AuthAdminLogger {
  info(category: string, message: string, data?: Record<string, unknown>): void;
  warn(category: string, message: string, data?: Record<string, unknown>): void;
}

/**
 * Phase 4 - the canonical CONFIG-TIME auth-administration log message. Exactly
 * ONE event with this message is emitted per config-time auth operation.
 */
export const AUTH_ADMIN_EVENT = 'Auth config change';

/** The config-time auth-administration operations that emit an audit event. */
export type AuthAdminAction =
  | 'wif_verify'
  | 'wif_debug_assertion'
  | 'jwks_host_add'
  | 'jwks_host_update'
  | 'jwks_host_patch'
  | 'jwks_host_remove'
  | 'auth_flags_changed';

/** The outcome of a config-time auth operation. */
export type AuthAdminOutcome = 'success' | 'failure' | 'denied';

/** A single auth-affecting endpoint flag that changed (name + before/after). */
export interface AuthFlagChange {
  flag: string;
  from: unknown;
  to: unknown;
}

/** The non-secret payload of a config-time auth-administration audit event. */
export interface AuthAdminEvent {
  action: AuthAdminAction;
  outcome: AuthAdminOutcome;
  endpointId?: string;
  credentialId?: string;
  /** Auth method kind when relevant (e.g. 'wif'). */
  method?: string;
  /** JWKS host (bare hostname) for single-host operations. */
  host?: string;
  /** JWKS hosts added by a bulk patch. */
  hostsAdded?: string[];
  /** JWKS hosts removed by a bulk patch. */
  hostsRemoved?: string[];
  /** Auth-affecting endpoint flags that changed (names + before/after values). */
  changedFlags?: AuthFlagChange[];
  /** True for a dry-run operation that evaluates but never mints/persists (WIF debug). */
  dryRun?: boolean;
  /** Catalog reason code when the operation resolved to a specific auth reason. */
  reasonCode?: string;
  /** The X-Request-Id correlation id, bridging to the request log. */
  correlationId?: string;
  /** A short, non-secret human detail (e.g. 'host not on allowlist'). */
  detail?: string;
}

/**
 * Phase 4 - emit one structured, redacted, alert-friendly CONFIG-TIME auth
 * event. Flows through the existing ScimLogger (ring buffer + SSE + file) -
 * NOT a parallel mechanism, mirroring {@link emitAuthDecisionEvent}.
 *
 * A `success` is logged at INFO; a `failure` or `denied` at WARN. Undefined
 * keys are dropped so the log line stays clean.
 */
export function emitAuthAdminEvent(
  logger: AuthAdminLogger,
  event: AuthAdminEvent,
  logCategoryAuth: string,
): void {
  const data: Record<string, unknown> = {
    action: event.action,
    outcome: event.outcome,
    endpointId: event.endpointId,
    credentialId: event.credentialId,
    method: event.method,
    host: event.host,
    hostsAdded: event.hostsAdded,
    hostsRemoved: event.hostsRemoved,
    changedFlags: event.changedFlags,
    dryRun: event.dryRun,
    reasonCode: event.reasonCode,
    correlationId: event.correlationId,
    detail: event.detail,
  };
  for (const k of Object.keys(data)) {
    if (data[k] === undefined) delete data[k];
  }
  if (event.outcome === 'success') {
    logger.info(logCategoryAuth, AUTH_ADMIN_EVENT, data);
  } else {
    logger.warn(logCategoryAuth, AUTH_ADMIN_EVENT, data);
  }
}
