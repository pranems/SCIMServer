/**
 * jwt-decode.ts - W2 client-side JWT decoding (never verification).
 *
 * A JWT is signed, not encrypted, so its header + claims are readable by any
 * holder. This decodes the two non-secret segments so an operator can inspect a
 * `Bearer` / `client_assertion` / `access_token` value in-place, without a
 * round-trip. Mirrors api/src/oauth/jwt-decode.util.ts.
 */

export interface DecodedJwt {
  isJwt: boolean;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  signaturePresent?: boolean;
  reason?: string;
}

function stripBearer(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, '');
}

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  // atob is available in the browser + jsdom.
  const binary = atob(padded);
  // Decode UTF-8 bytes.
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** Decode (do NOT verify) a JWT into its header + payload. Total: never throws. */
export function decodeJwt(input: unknown): DecodedJwt {
  if (typeof input !== 'string' || input.trim() === '') {
    return { isJwt: false, reason: 'empty or non-string input' };
  }
  const token = stripBearer(input);
  const parts = token.split('.');
  if (parts.length !== 3) return { isJwt: false, reason: 'not a three-segment JWT' };
  try {
    const header = JSON.parse(base64UrlDecode(parts[0])) as unknown;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as unknown;
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

/** Heuristic: does this string LOOK like a JWT? For gating a decode affordance. */
export function looksLikeJwt(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(stripBearer(value));
}

/**
 * Walk an arbitrary JSON value and collect every JWT-looking string, keyed by a
 * human path (e.g. `authorization`, `access_token`, `Operations[0].value`), so a
 * viewer can offer a decode button for each token it displays.
 */
export function findJwtsInValue(value: unknown, path = ''): Array<{ path: string; token: string }> {
  const out: Array<{ path: string; token: string }> = [];
  const walk = (v: unknown, p: string): void => {
    if (typeof v === 'string') {
      if (looksLikeJwt(v)) out.push({ path: p || 'value', token: v });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        walk(val, p ? `${p}.${k}` : k);
      }
    }
  };
  walk(value, path);
  return out;
}
