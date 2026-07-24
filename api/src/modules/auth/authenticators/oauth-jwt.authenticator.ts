/**
 * OAuthJwtAuthenticator (W2.1) - the endpoint-scoped OAuth 2.0 JWT method,
 * extracted verbatim from the old `SharedSecretGuard` OAuth stage.
 *
 * Validates the presented token as a SCIMServer-issued JWT. If the token IS the
 * global shared secret it is `not-applicable` (the legacy acceptor handles it).
 * A valid JWT carrying an `endpoint_id` claim for a DIFFERENT endpoint is a
 * REJECT-STOP (`bearer_token_scoped_other_endpoint`) - the downgrade-confusion
 * defense: it must NOT fall through to the legacy acceptor. An invalid JWT is
 * `not-applicable`, carrying the F3 sub-reason (expired / signature) up for the
 * terminal reject.
 */
import { OAuthService } from '../../../oauth/oauth.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import type { AuthAttempt, AuthContext, ResourceAuthenticator } from './resource-authenticator';

/**
 * F3 - classify a swallowed OAuth-JWT validation error into the specific
 * resource-plane bearer sub-reason. Returns undefined for anything not clearly
 * an expiry or signature failure, so those keep the generic `bearer_invalid`.
 */
export function mapBearerJwtErrorToReason(err: unknown): string | undefined {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
  if (code === 'ERR_JWT_EXPIRED') return 'bearer_oauth_expired';
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'bearer_oauth_signature_invalid';
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return 'bearer_oauth_signature_invalid';
  return undefined;
}

export class OAuthJwtAuthenticator implements ResourceAuthenticator {
  readonly method = 'bearer_jwt' as const;
  readonly order = 20;

  constructor(
    private readonly oauthService: OAuthService,
    private readonly logger: ScimLogger,
  ) {}

  async tryAuthenticate(ctx: AuthContext): Promise<AuthAttempt> {
    const { token, endpointId, expectedSecret } = ctx;

    // The token IS the global secret - not a JWT; the legacy acceptor handles it.
    if (token === expectedSecret) {
      return {
        outcome: 'not-applicable',
        checks: [
          {
            id: 'oauth_jwt',
            status: 'skipped',
            expected: 'a valid OAuth 2.0 JWT',
            received: 'token equals the global secret (tried as shared_secret)',
          },
        ],
      };
    }

    this.logger.debug(LogCategory.AUTH, 'Attempting OAuth 2.0 token validation');
    let payload: Record<string, unknown> | undefined;
    try {
      payload = await this.oauthService.validateAccessToken(token);
    } catch (oauthError) {
      const fallthroughReason = mapBearerJwtErrorToReason(oauthError);
      this.logger.debug(LogCategory.AUTH, 'OAuth 2.0 validation failed, falling back to legacy token', {
        reasonCode: fallthroughReason,
      });
      return {
        outcome: 'not-applicable',
        checks: [
          { id: 'oauth_jwt', status: 'skipped', expected: 'a valid OAuth 2.0 JWT', received: 'not a valid JWT' },
        ],
        fallthroughReason,
      };
    }

    // Q1 - per-endpoint token scoping. A token carrying an `endpoint_id` claim
    // authorizes ONLY that endpoint's routes. Presented elsewhere it is
    // mine-but-invalid-stop: REJECT now, never fall through (downgrade defense).
    const tokenEndpointId = typeof payload.endpoint_id === 'string' ? payload.endpoint_id : undefined;
    if (tokenEndpointId && endpointId !== tokenEndpointId) {
      this.logger.warn(LogCategory.AUTH, 'Per-endpoint OAuth token presented to a route it is not scoped for', {
        tokenEndpointId,
        urlEndpointId: endpointId,
      });
      return {
        outcome: 'reject',
        method: 'bearer_jwt',
        reasonCode: 'bearer_token_scoped_other_endpoint',
        detail: 'OAuth token is scoped to a different endpoint.',
        errorCode: 'invalid_token',
        checks: [
          {
            id: 'oauth_jwt',
            status: 'fail',
            expected: `token scoped to ${endpointId ?? 'this route'}`,
            received: `scoped to a different endpoint (${tokenEndpointId})`,
          },
        ],
      };
    }

    const capturedPayload = payload;
    return {
      outcome: 'accept',
      method: 'bearer_jwt',
      checks: [
        {
          id: 'oauth_jwt',
          status: 'pass',
          expected: 'a valid OAuth 2.0 JWT',
          received: tokenEndpointId ? 'valid (endpoint-scoped)' : 'valid (global)',
        },
      ],
      apply: (req) => {
        req.oauth = capturedPayload;
        req.authType = 'oauth';
        this.logger.enrichContext({ authType: 'oauth', authClientId: capturedPayload.client_id as string });
        this.logger.info(LogCategory.AUTH, 'OAuth 2.0 authentication successful', {
          clientId: capturedPayload.client_id as string,
          endpointScoped: tokenEndpointId ? true : false,
        });
      },
    };
  }
}
