/**
 * parseCorsOrigin - convert the CORS_ORIGIN env var into the value
 * accepted by Express's cors() option `origin`.
 *
 * Resolves S-4 (DELIVERY_PLAN.md section 3.2). Replaces the previous
 * unconfigurable `origin: true` allow-all default in api/src/main.ts.
 *
 * Behavior matrix:
 *   undefined         -> true       (backward-compat allow-all)
 *   ''                -> true       (backward-compat allow-all)
 *   '   '             -> true       (backward-compat allow-all)
 *   '*'               -> true       (explicit allow-all)
 *   'false' / 'none'  -> false      (explicit deny - no CORS)
 *   'https://a.com'   -> 'https://a.com'              (single origin)
 *   'https://a.com,https://b.com' -> array            (allowlist)
 *
 * Notes:
 * - Single-entry comma lists collapse to a string for cleaner cors() handling.
 * - Whitespace around entries is trimmed; empty entries are dropped.
 * - Returning `true` from cors() reflects the request Origin header back as
 *   Access-Control-Allow-Origin. Returning `false` disables CORS entirely.
 */

export type CorsOriginValue = boolean | string | string[];

const DENY_KEYWORDS = new Set(['false', 'none']);

export function parseCorsOrigin(raw: string | undefined): CorsOriginValue {
  if (raw === undefined) return true;
  const trimmed = raw.trim();
  if (trimmed === '') return true;
  if (trimmed === '*') return true;
  if (DENY_KEYWORDS.has(trimmed.toLowerCase())) return false;

  const entries = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) return false;
  if (entries.length === 1) return entries[0];
  return entries;
}
