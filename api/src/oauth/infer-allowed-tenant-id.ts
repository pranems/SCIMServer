/**
 * U8 - glean the WIF `allowedTenantId` from the trust's issuer or JWKS URI when
 * the operator did not supply it explicitly.
 *
 * Microsoft Entra (and most enterprise OIDC issuers) embed the directory tenant
 * GUID as a path segment of the issuer and the JWKS URI, e.g.
 *   - v2 issuer   : https://login.microsoftonline.com/{tenant}/v2.0
 *   - gov issuer  : https://login.microsoftonline.us/{tenant}/v2.0
 *   - china issuer: https://login.partner.microsoftonline.cn/{tenant}/v2.0
 *   - v1 issuer   : https://sts.windows.net/{tenant}/
 *   - JWKS URI    : https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys
 *
 * The extraction is host-agnostic: it scans the URL for the FIRST GUID-shaped
 * path segment, so every Entra cloud (commercial / gov / china) and both the v1
 * and v2 issuer shapes are covered without an explicit host allowlist. A URL
 * that carries no tenant GUID (for example a Google issuer, or a placeholder
 * such as `common` / `organizations`) yields `null` - the tenant stays optional
 * and the operator must supply it explicitly.
 *
 * This is a PURE function with no network access. It never throws.
 */

/** RFC 4122 GUID shape (8-4-4-4-12 hex), matched as a whole path token. */
const GUID_RE =
  /(?:^|[/])([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[/]|$)/;

/** Which input a gleaned tenant id was extracted from. */
export type AllowedTenantIdSource = 'issuer' | 'jwksUri';

export interface InferredAllowedTenantId {
  tenantId: string;
  source: AllowedTenantIdSource;
}

/**
 * Extract the first GUID-shaped path segment from a URL-ish string, or null.
 * Tolerant of a raw string that is not a valid URL (falls back to a plain scan).
 */
function extractTenantGuid(value: string | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const match = GUID_RE.exec(value);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Infer the `allowedTenantId` from a WIF trust's issuer or JWKS URI.
 *
 * Preference order: the issuer wins over the JWKS URI (the issuer is the
 * authoritative identity of the directory; the JWKS URI is a fetch endpoint).
 *
 * @returns the gleaned tenant id + its source, or `null` when neither input
 *          carries a tenant GUID.
 */
export function inferAllowedTenantId(
  issuer?: string,
  jwksUri?: string,
): InferredAllowedTenantId | null {
  const fromIssuer = extractTenantGuid(issuer);
  if (fromIssuer) return { tenantId: fromIssuer, source: 'issuer' };

  const fromJwks = extractTenantGuid(jwksUri);
  if (fromJwks) return { tenantId: fromJwks, source: 'jwksUri' };

  return null;
}
