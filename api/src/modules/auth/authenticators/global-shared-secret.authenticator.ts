/**
 * GlobalSharedSecretAuthenticator (W2.1) - the legacy global `SCIM_SHARED_SECRET`
 * bearer method, extracted verbatim from the old `SharedSecretGuard` legacy stage.
 *
 * A timing-safe match of the presented token against the configured global
 * secret accepts as `legacy`. WI-11: an endpoint-scoped request REFUSES the
 * global secret when `SharedSecretBearerAuthEnabled=false` on that endpoint -
 * that is a REJECT-STOP (`bearer_shared_secret_refused`), not a fall-through.
 * The enablement lookup fails OPEN (allow) to preserve today's behavior - the
 * secret still had to match to reach the check.
 */
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { safeCompare } from '../../../security/safe-compare';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { getEffectiveAuthEnablement, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import type { AuthAttempt, AuthContext, ResourceAuthenticator } from './resource-authenticator';

export class GlobalSharedSecretAuthenticator implements ResourceAuthenticator {
  readonly method = 'shared_secret' as const;
  readonly order = 30;

  constructor(
    private readonly endpointService: EndpointService | null,
    private readonly logger: ScimLogger,
  ) {}

  async tryAuthenticate(ctx: AuthContext): Promise<AuthAttempt> {
    const { token, endpointId, expectedSecret } = ctx;

    // S-2: timing-safe comparison prevents byte-by-byte guessing via response time.
    if (safeCompare(token, expectedSecret)) {
      // WI-11 - an endpoint-scoped request may REFUSE the global secret. Global
      // (non-endpoint) routes always accept it.
      if (endpointId && this.endpointService) {
        const allowed = await this.isSharedSecretAllowedForEndpoint(endpointId);
        if (!allowed) {
          this.logger.warn(
            LogCategory.AUTH,
            'Global shared secret refused: SharedSecretBearerAuthEnabled is off for this endpoint',
            { endpointId },
          );
          return {
            outcome: 'reject',
            method: 'shared_secret',
            reasonCode: 'bearer_shared_secret_refused',
            detail: 'This endpoint does not accept the global shared secret.',
            errorCode: 'invalid_token',
            checks: [
              {
                id: 'shared_secret',
                status: 'fail',
                expected: 'the endpoint accepts the global SCIM shared secret',
                received: 'refused (SharedSecretBearerAuthEnabled=false)',
              },
            ],
          };
        }
      }

      return {
        outcome: 'accept',
        method: 'shared_secret',
        checks: [
          { id: 'shared_secret', status: 'pass', expected: 'the global SCIM shared secret', received: 'matched' },
        ],
        apply: (req) => {
          this.logger.info(LogCategory.AUTH, 'Legacy bearer token authentication successful');
          req.authType = 'legacy';
          this.logger.enrichContext({ authType: 'legacy' });
        },
      };
    }

    return {
      outcome: 'not-applicable',
      checks: [
        { id: 'shared_secret', status: 'fail', expected: 'the global SCIM shared secret', received: 'mismatch' },
      ],
    };
  }

  /**
   * WI-11 - whether the endpoint accepts the global secret. Effective
   * SharedSecretBearerAuthEnabled defaults to `true` (back-compat); an endpoint
   * refuses only when it explicitly sets the flag false. Fails OPEN on any
   * lookup error to preserve today's behavior.
   */
  private async isSharedSecretAllowedForEndpoint(endpointId: string): Promise<boolean> {
    try {
      const endpoint = await this.endpointService!.getEndpoint(endpointId);
      const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
      return getEffectiveAuthEnablement(config).sharedSecretBearer;
    } catch (error) {
      this.logger.debug(LogCategory.AUTH, 'Shared-secret enablement check failed, allowing (fail-open)', {
        endpointId,
        error: (error as Error).message,
      });
      return true;
    }
  }
}
