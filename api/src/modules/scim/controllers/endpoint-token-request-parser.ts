/**
 * W2.2 - the strict per-endpoint token-request parser.
 *
 * A pure function (no crypto, no DB) that turns the raw RFC 6749 form body + the
 * `Authorization` header into exactly one {@link ParsedEndpointTokenRequest}
 * variant. It centralizes what the controller used to do inline: normalize the
 * credential location (RFC 6749 section 2.3.1 Basic vs body, body wins), enforce
 * the `client_credentials` grant, reject the mutually-exclusive assertion +
 * secret shape, validate the assertion type, and reject a missing-credential
 * request. The controller then only routes the well-formed variants and shapes
 * responses; secret + assertion VALIDATION stay in the providers.
 *
 * Behavior-preserving: every error `error` / `error_description` / `reason_code`
 * / status is reproduced exactly from the previous inline controller logic.
 */
import { HttpStatus } from '@nestjs/common';
import { resolveClientCredentials } from '../../../oauth/client-credential-location';
import { JWT_BEARER_ASSERTION_TYPE } from './assertion-token-provider';
import type {
  CredentialLocation,
  ParsedEndpointTokenRequest,
  RawEndpointTokenRequest,
} from './endpoint-token-request.types';

export function parseEndpointTokenRequest(
  raw: RawEndpointTokenRequest,
  authorization?: string,
): ParsedEndpointTokenRequest {
  // RFC 6749 section 2.3.1 - accept credentials from the Authorization: Basic
  // header (client_secret_basic) in addition to the body (client_secret_post).
  // Body values win when both are present.
  const resolved = resolveClientCredentials(
    { clientId: raw.client_id, clientSecret: raw.client_secret },
    authorization,
  );
  const bodyHadSecret = typeof raw.client_secret === 'string' && raw.client_secret.length > 0;
  const credentialLocation: CredentialLocation = bodyHadSecret
    ? 'client_secret_post'
    : authorization
      ? 'client_secret_basic'
      : 'none';

  const clientId = resolved.clientId;
  const clientSecret = resolved.clientSecret;
  const scope = raw.scope;

  if (raw.grant_type !== 'client_credentials') {
    return {
      kind: 'invalid',
      error: 'unsupported_grant_type',
      errorDescription: 'Only the client_credentials grant type is supported.',
      reasonCode: 'grant_type_unsupported',
      status: HttpStatus.BAD_REQUEST,
    };
  }

  // Self-describing routing: the request shape selects the credential type.
  // client_assertion and client_secret are mutually exclusive.
  const hasAssertion = typeof raw.client_assertion === 'string' && raw.client_assertion.length > 0;
  const hasSecret = typeof clientSecret === 'string' && clientSecret.length > 0;

  if (hasAssertion && hasSecret) {
    return {
      kind: 'invalid',
      error: 'invalid_request',
      errorDescription: 'client_assertion and client_secret are mutually exclusive.',
      reasonCode: 'mutually_exclusive_credentials',
      status: HttpStatus.BAD_REQUEST,
    };
  }

  if (hasAssertion) {
    if (raw.client_assertion_type !== JWT_BEARER_ASSERTION_TYPE) {
      return {
        kind: 'invalid',
        error: 'invalid_request',
        errorDescription: `Unsupported client_assertion_type. Expected "${JWT_BEARER_ASSERTION_TYPE}".`,
        reasonCode: 'unsupported_assertion_type',
        status: HttpStatus.BAD_REQUEST,
      };
    }
    return {
      kind: 'client_assertion',
      assertion: raw.client_assertion as string,
      assertionType: raw.client_assertion_type,
      ...(scope !== undefined ? { scope } : {}),
      ...(typeof raw.resource === 'string' && raw.resource.length > 0 ? { resource: raw.resource } : {}),
      // W3.7 - the RFC 7523 profile sends the ISV-issued target client id.
      ...(typeof clientId === 'string' && clientId.length > 0 ? { clientId } : {}),
    };
  }

  if (!clientId || !clientSecret) {
    return {
      kind: 'invalid',
      error: 'invalid_request',
      errorDescription: 'client_id and client_secret (or a client_assertion) are required.',
      reasonCode: 'missing_credentials',
      status: HttpStatus.BAD_REQUEST,
    };
  }

  return {
    kind: 'client_secret',
    clientId,
    clientSecret,
    // When a secret is present the location is post or basic, never none.
    credentialLocation: credentialLocation === 'none' ? 'client_secret_post' : credentialLocation,
    ...(scope !== undefined ? { scope } : {}),
  };
}
