/**
 * jwt-decode.util.ts - W2: a single, shared, non-verifying JWT decoder.
 *
 * A JWT is SIGNED, not encrypted, so its header + claims are readable by any
 * holder of the token. This decodes (never verifies) the two non-secret
 * segments so an operator can inspect what a `Bearer`/`client_assertion`/
 * `access_token` value actually contains. It NEVER validates the signature and
 * NEVER returns the signature bytes as anything other than a presence flag.
 *
 * Pure + total: it never throws. A non-JWT input returns `{ isJwt: false }`
 * with a short reason so callers can render a clear message.
 */

export interface DecodedJwt {
  /** True only when the input parsed as a 3-segment JWT with JSON header+payload. */
  isJwt: boolean;
  /** The decoded JOSE header (alg, kid, typ, ...). */
  header?: Record<string, unknown>;
  /** The decoded claim set. */
  payload?: Record<string, unknown>;
  /** Whether a (non-empty) signature segment was present. The bytes are never returned. */
  signaturePresent?: boolean;
  /** Short, non-secret reason when `isJwt` is false. */
  reason?: string;
}

/** Strip a leading `Bearer ` / `bearer ` scheme if present. */
function stripBearer(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, '');
}

/**
 * Decode (do NOT verify) a JWT into its header + payload. Accepts a bare token
 * or a `Bearer <token>` header value. Returns `{ isJwt: false, reason }` for
 * anything that is not a well-formed 3-segment JWT.
 */
export function decodeJwt(input: unknown): DecodedJwt {
  if (typeof input !== 'string' || input.trim() === '') {
    return { isJwt: false, reason: 'empty or non-string input' };
  }
  const token = stripBearer(input);
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { isJwt: false, reason: 'not a three-segment JWT' };
  }
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8')) as unknown;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as unknown;
    if (
      header === null || typeof header !== 'object' || Array.isArray(header) ||
      payload === null || typeof payload !== 'object' || Array.isArray(payload)
    ) {
      return { isJwt: false, reason: 'header/payload is not a JSON object' };
    }
    return {
      isJwt: true,
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      signaturePresent: parts[2].length > 0,
    };
  } catch {
    return { isJwt: false, reason: 'malformed base64url or JSON in a segment' };
  }
}

/** A quick, allocation-free heuristic: does this string LOOK like a JWT? For UI gating. */
export function looksLikeJwt(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const token = stripBearer(value);
  // three non-empty segments of base64url chars, first segment starts with the
  // typical `eyJ` (base64url of `{"`).
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token);
}
