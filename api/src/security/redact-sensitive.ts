/**
 * redact-sensitive.ts - a single, shared, recursive secret redactor.
 *
 * Used by BOTH the structured console/file logger (`ScimLogger.sanitizeData`)
 * and the persisted RequestLog path (`LoggingService.recordRequest`, when the
 * effective `PersistRequestSecrets` flag is OFF) so the two never drift on what
 * counts as a secret. The RequestLog is a deliberate full-fidelity RCA store
 * that keeps everything (headers + body, secrets included) BY DEFAULT; turning
 * the flag OFF routes the same request/response through this redactor first.
 *
 * The redactor deep-clones its input and replaces the VALUE of any key whose
 * name looks secret (at any nesting depth, and inside arrays) with the
 * `[REDACTED]` marker. It never mutates the caller's object and is cycle-safe.
 */

/** The marker written in place of a redacted value. */
export const REDACTED = '[REDACTED]';

/**
 * A key is treated as secret-bearing when its name matches this pattern. Kept
 * intentionally broad (substring match) so a nested `client_secret`,
 * `Authorization` header, `access_token`, `client_assertion`, session
 * `cookie`, or `credentialHash` is caught regardless of the surrounding shape.
 * This is the single source of truth shared by the console logger and the
 * RequestLog redaction path.
 */
export const SENSITIVE_KEY_PATTERN =
  /secret|password|passwd|pwd|token|authorization|bearer|jwt|assertion|cookie|credential|api[-_]?key|passphrase/i;

/** Whether a key name should have its value redacted. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Deep-clone `value`, redacting the value of every secret-named key at any
 * depth (including inside arrays). Primitives are returned as-is. Cycles are
 * broken with a `[Circular]` marker so this never throws or loops.
 */
export function redactSensitiveDeep<T>(value: T): T {
  return redactInner(value, new WeakSet<object>()) as T;
}

function redactInner(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;

  // Break cycles (and repeated refs) so a self-referential object cannot loop.
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => redactInner(v, seen));
  }

  // Non-plain objects (Date, Buffer, etc.) have no enumerable secret keys we
  // want to walk; serialize-safe callers already handle them, so pass through.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redactInner(v, seen);
  }
  return out;
}
