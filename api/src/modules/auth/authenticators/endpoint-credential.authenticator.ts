/**
 * EndpointCredentialAuthenticator (W2.1) - the per-endpoint credential method,
 * extracted verbatim from the old `SharedSecretGuard.tryEndpointCredential`.
 *
 * Matches an opaque per-endpoint `bearer` / `oauth_client` secret (bcrypt at
 * rest) against the presented token, gated by the WI-11 per-method enablement
 * flags. It NEVER reject-stops: a non-match is always `not-applicable` so the
 * guard falls through to OAuth/legacy. The X9 perf short-circuits (a JWT, or the
 * global shared secret, can never be a per-endpoint opaque secret) return
 * `not-applicable` BEFORE the expensive bcrypt loop - this is the `isApplicable`
 * fast-path that keeps the probe O(1) for the dominant token shapes.
 */
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { looksLikeJwt } from '../../../oauth/jwt-decode.util';
import { safeCompare } from '../../../security/safe-compare';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { resolveEndpointAuthEnablement, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import {
  HASH_ALGO_HMAC_V1,
  parseCredentialToken,
  verifySecretHash,
} from '../../../security/credential-token';
import type { AuthCheck } from '../../../oauth/auth-decision-trace';
import type { AuthAttempt, AuthContext, ResourceAuthenticator } from './resource-authenticator';

// bcrypt is heavy - lazy-load via dynamic import cached on first use (unchanged from the guard).
let bcryptCompare: (data: string, hash: string) => Promise<boolean>;
async function loadBcryptCompare(): Promise<typeof bcryptCompare> {
  if (!bcryptCompare) {
    const bcrypt = await import('bcrypt');
    bcryptCompare = bcrypt.compare.bind(bcrypt);
  }
  return bcryptCompare;
}

export class EndpointCredentialAuthenticator implements ResourceAuthenticator {
  readonly method = 'endpoint_bearer' as const;
  readonly order = 10;

  constructor(
    private readonly credentialRepo: IEndpointCredentialRepository | null,
    private readonly endpointService: EndpointService | null,
    private readonly logger: ScimLogger,
  ) {}

  async tryAuthenticate(ctx: AuthContext): Promise<AuthAttempt> {
    const { endpointId, token, expectedSecret } = ctx;

    const na = (received: string, status: AuthCheck['status'] = 'skipped'): AuthAttempt => ({
      outcome: 'not-applicable',
      checks: [
        {
          id: 'endpoint_bearer',
          status,
          expected: 'a matching per-endpoint bearer credential',
          received,
        },
      ],
    });

    if (!endpointId || !this.credentialRepo || !this.endpointService) {
      return na(endpointId ? 'not attempted' : 'not an endpoint-scoped route');
    }

    try {
      // WI-11 / W2.5 - per-method enablement resolved from the single source:
      // an explicit `profile.authentication.methods[]` entry wins, else the flat
      // flags (`SecretTokenBearerAuthEnabled` / `OAuthClientCredentialsAuthEnabled`,
      // each falling back to the legacy `PerEndpointCredentialsEnabled`).
      const endpoint = await this.endpointService.getEndpoint(endpointId);
      const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
      const effective = resolveEndpointAuthEnablement(config, endpoint.profile?.authentication?.methods);

      if (!effective.secretTokenBearer && !effective.oauthClientCredentials) {
        this.logger.debug(LogCategory.AUTH, 'Per-endpoint credentials not enabled for this endpoint', { endpointId });
        return na('per-endpoint credentials not enabled');
      }

      // PERF (X9): a per-endpoint secret is an OPAQUE random secret, never a JWT.
      // A JWT can therefore never match - skip the O(N) x bcrypt loop and let the
      // OAuth/JWKS path validate it.
      if (looksLikeJwt(token)) {
        this.logger.debug(LogCategory.AUTH, 'Presented token is a JWT - skipping per-endpoint secret comparison (OAuth/JWKS validates it)', { endpointId });
        return na('token is a JWT (validated by OAuth, not a per-endpoint opaque secret)');
      }

      // PERF (X9): the presented token IS the global shared secret; a per-endpoint
      // credential is an auto-generated random secret, so it can never equal it -
      // skip to the legacy global-secret acceptor.
      if (expectedSecret && safeCompare(token, expectedSecret)) {
        this.logger.debug(LogCategory.AUTH, 'Presented token is the global shared secret - skipping per-endpoint secret comparison (legacy acceptor handles it)', { endpointId });
        return na('token is the global shared secret (handled by the legacy acceptor)');
      }

      // P1 - keyed fast path. A token minted after P1 names its own row, so this
      // costs ONE indexed read plus ONE HMAC instead of a bcrypt compare against
      // every active credential (287 ms each). It deliberately does NOT fall
      // through to the scan on failure: doing so would restore the exact
      // amplification this exists to remove, with a DB read on top.
      const parsed = parseCredentialToken(token);
      if (parsed) {
        const cred = await this.credentialRepo.findActiveByLookupKey(parsed.lookupKey);
        if (!cred) return na('keyed credential not found');
        // lookupKey is globally unique, so the row must be re-checked against the
        // endpoint being addressed - otherwise a token would authenticate anywhere.
        if (cred.endpointId !== endpointId) return na('keyed credential belongs to another endpoint');
        if (cred.hashAlgo !== HASH_ALGO_HMAC_V1 || !cred.secretHash) return na('keyed credential has no P1 hash');
        if (cred.credentialType === 'bearer' && !effective.secretTokenBearer) return na('bearer method not enabled');
        if (cred.credentialType === 'oauth_client' && !effective.oauthClientCredentials) return na('oauth_client method not enabled');
        if (!verifySecretHash(parsed.secret, cred.secretHash)) return na('keyed credential secret mismatch', 'fail');
        return this.acceptFor(cred, endpointId);
      }

      const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
      if (credentials.length === 0) {
        this.logger.debug(LogCategory.AUTH, 'No active per-endpoint credentials found, falling back', { endpointId });
        return na('no active per-endpoint credentials');
      }

      const compare = await loadBcryptCompare();
      for (const cred of credentials) {
        // A migrated row can never match a legacy token, so bcrypting it is pure
        // cost - and this is what makes the scan shrink as rotation progresses.
        if (cred.hashAlgo === HASH_ALGO_HMAC_V1) continue;
        if (cred.credentialType === 'bearer' && !effective.secretTokenBearer) continue;
        if (cred.credentialType === 'oauth_client' && !effective.oauthClientCredentials) continue;
        const isMatch = cred.credentialHash ? await compare(token, cred.credentialHash) : false;
        if (isMatch) {
          return this.acceptFor(cred, endpointId);
        }
      }

      this.logger.debug(LogCategory.AUTH, 'Per-endpoint credential mismatch, falling back to OAuth/legacy', { endpointId });
      return na(`no active credential matched (of ${credentials.length})`, 'fail');
    } catch (error) {
      this.logger.debug(LogCategory.AUTH, 'Per-endpoint credential check failed, falling back', {
        endpointId,
        error: (error as Error).message,
      });
      return na('per-endpoint credential lookup failed (fell back)');
    }
  }

  /** Shared accept result, so the keyed and legacy paths cannot drift apart. */
  private acceptFor(
    cred: { id: string; label?: string | null },
    endpointId: string,
  ): AuthAttempt {
    return {
      outcome: 'accept',
      method: 'endpoint_bearer',
      checks: [
        {
          id: 'endpoint_bearer',
          status: 'pass',
          expected: 'a matching per-endpoint bearer credential',
          received: `matched credential ${cred.id}`,
        },
      ],
      apply: (req) => {
        req.authType = 'endpoint_credential';
        req.authCredentialId = cred.id;
        this.logger.enrichContext({ authType: 'endpoint_credential', authCredentialId: cred.id });
        this.logger.info(LogCategory.AUTH, 'Per-endpoint credential authentication successful', {
          endpointId,
          credentialId: cred.id,
          label: cred.label,
        });
      },
    };
  }
}
