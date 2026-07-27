import type { AccessToken } from '../../../oauth/oauth.service';

/** DI token for the per-endpoint assertion-based token provider (WIF). */
export const ASSERTION_TOKEN_PROVIDER = Symbol('ASSERTION_TOKEN_PROVIDER');

/** The RFC 7523 client-assertion type URN (the WIF `jwt-bearer` profile). */
export const JWT_BEARER_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

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
