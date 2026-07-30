import type { AccessToken } from '../../../oauth/oauth.service';

/** DI token for the per-endpoint assertion-based token provider (WIF). */
export const ASSERTION_TOKEN_PROVIDER = Symbol('ASSERTION_TOKEN_PROVIDER');

/** The RFC 7523 client-assertion type URN (the WIF `jwt-bearer` profile). */
export const JWT_BEARER_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/**
 * W3.1 - the finite set of WIF protocol profiles a trust can serve. These are
 * the SyncFabric guide's `enabledProfiles` values (guide 12.1). They are the
 * seam's shared vocabulary: the RFC 7523 provider selects trusts that enable
 * `syncfabric-rfc7523`, and the future RFC 8693 provider (Wave 4) will select
 * on `syncfabric-rfc8693` WITHOUT touching the other provider.
 */
export const WIF_PROFILE_RFC7523 = 'syncfabric-rfc7523';
export const WIF_PROFILE_RFC8693 = 'syncfabric-rfc8693';
export type WifProfile = typeof WIF_PROFILE_RFC7523 | typeof WIF_PROFILE_RFC8693;

/**
 * W3.1 - resolve which protocol profiles a stored `wif` trust serves.
 *
 * Reads the versioned `enabledProfiles[]` when present (the guide 12.1 shape).
 * Otherwise it PROJECTS the legacy singular `assertionProfile` onto that shape:
 * `token-exchange` means RFC 8693 only, and anything else (`jwt-bearer`, or an
 * absent value - which is every trust created before this field existed) means
 * RFC 7523. That projection is what makes the change value-preserving for every
 * existing trust while still honouring an explicit declaration.
 *
 * Pure + defensive: it never throws, so it can filter candidates BEFORE the
 * (throwing) full trust validation runs.
 */
export function resolveTrustProfiles(metadata: Record<string, unknown> | null): WifProfile[] {
  const m = metadata ?? {};
  const declared = m.enabledProfiles;
  if (Array.isArray(declared)) {
    const valid = declared.filter(
      (p): p is WifProfile => p === WIF_PROFILE_RFC7523 || p === WIF_PROFILE_RFC8693,
    );
    if (valid.length > 0) return [...new Set(valid)];
  }
  return m.assertionProfile === 'token-exchange' ? [WIF_PROFILE_RFC8693] : [WIF_PROFILE_RFC7523];
}

/** True when the stored trust serves the given protocol profile. */
export function trustEnablesProfile(
  metadata: Record<string, unknown> | null,
  profile: WifProfile,
): boolean {
  return resolveTrustProfiles(metadata).includes(profile);
}

/**
 * Three-outcome result of an assertion-based token mint (architecture section 2.2):
 *  - `{ token }`           accept: the assertion is mine and valid -> here is the token.
 *  - `null`                not-mine-continue: no assertion trust configured for me.
 *  - throws                mine-but-invalid-stop: the assertion is for me but failed
 *                          validation -> reject now (never fall through).
 */
/**
 * The non-secret, already-parsed details of the token request that accompany a
 * `client_assertion`. Passed as an object (not positional params) so a new
 * variation adds a FIELD rather than another positional argument.
 */
export interface AssertionMintRequest {
  /**
   * W3.4 - the optional RFC 8707 `resource` form parameter (SAP SuccessFactors
   * sends one); the trust's `resourceMode` decides how strictly it is checked.
   */
  resource?: string;
  /**
   * W3.7 - the optional RFC 6749 `client_id` form parameter. SyncFabric's RFC
   * 7523 profile sends the ISV-issued target client id here; when the trust
   * pins a `targetClientId` the two MUST match.
   */
  clientId?: string;
}

export interface IAssertionTokenProvider {
  /**
   * Validate a `client_assertion` against the endpoint's WIF trust and mint the
   * endpoint's own token on success. Returns `null` when no WIF trust is
   * configured for the endpoint (not-mine-continue); throws when the assertion
   * is for the endpoint but invalid (mine-but-invalid-stop).
   */
  mintFromAssertion(
    endpointId: string,
    clientAssertion: string,
    request?: AssertionMintRequest,
  ): Promise<AccessToken | null>;
}
