/**
 * W2.2 - the per-endpoint token-request discriminated union.
 *
 * The mint plane is a KEYED STRATEGY-SELECT (not a probe-chain): the request
 * shape self-identifies which credential method to use. This union is what the
 * strict parser ([endpoint-token-request-parser.ts](./endpoint-token-request-parser.ts))
 * produces from the raw form body + `Authorization` header, so the controller
 * only ROUTES + shapes responses - it no longer re-derives the method by hand.
 *
 * The parser is deliberately free of crypto and DB access: it normalizes the
 * credential location (RFC 6749 section 2.3.1 Basic vs body), enforces the
 * grant type, and rejects the mutually-exclusive / missing-credential shapes,
 * producing exactly one of the variants below. Secret VALIDATION (bcrypt) and
 * assertion validation (JWKS) stay in the providers.
 */
import { HttpStatus } from '@nestjs/common';

/** RFC 6749 section 2.3.1 - where the client presented its credentials. */
export type CredentialLocation = 'client_secret_post' | 'client_secret_basic' | 'none';

/** The parsed, method-selected token request. */
export type ParsedEndpointTokenRequest =
  | {
      /** RFC 7523 client-assertion (WIF) route. */
      kind: 'client_assertion';
      assertion: string;
      assertionType: string;
      scope?: string;
    }
  | {
      /** RFC 6749 client_credentials with a client_secret route. */
      kind: 'client_secret';
      clientId: string;
      clientSecret: string;
      credentialLocation: Exclude<CredentialLocation, 'none'>;
      scope?: string;
    }
  | {
      /** A malformed / unsupported request the controller turns into an error response. */
      kind: 'invalid';
      error: string;
      errorDescription: string;
      reasonCode: string;
      status: HttpStatus;
    };

/** The raw form fields the parser consumes (RFC 6749 token request). */
export interface RawEndpointTokenRequest {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  client_assertion?: string;
  client_assertion_type?: string;
  scope?: string;
}
