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
export interface IAssertionTokenProvider {
  /**
   * Validate a `client_assertion` against the endpoint's WIF trust and mint the
   * endpoint's own token on success. Returns `null` when no WIF trust is
   * configured for the endpoint (not-mine-continue); throws when the assertion
   * is for the endpoint but invalid (mine-but-invalid-stop).
   */
  mintFromAssertion(endpointId: string, clientAssertion: string): Promise<AccessToken | null>;
}
