import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN } from '../scim/common/scim-constants';
import * as crypto from 'node:crypto';
import { safeCompare } from '../../security/safe-compare';
import { OAuthService } from '../../oauth/oauth.service';
import { looksLikeJwt } from '../../oauth/jwt-decode.util';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ScimLogger } from '../logging/scim-logger.service';
import { LogCategory } from '../logging/log-levels';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { getEffectiveAuthEnablement, type EndpointConfig } from '../endpoint/endpoint-config.interface';
import { AuthDecisionRecordStore } from '../../oauth/auth-decision-record.store';
import {
  emitAuthDecisionEvent,
  type AuthDecisionTrace,
  type AuthCheck,
  type AuthMethodKind,
} from '../../oauth/auth-decision-trace';
import { getCorrelationContext } from '../logging/scim-logger.service';

// bcrypt is heavy - lazy-load via dynamic import cached on first use
let bcryptCompare: (data: string, hash: string) => Promise<boolean>;
async function loadBcryptCompare(): Promise<typeof bcryptCompare> {
  if (!bcryptCompare) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bcrypt = await import('bcrypt');
    bcryptCompare = bcrypt.compare.bind(bcrypt);
  }
  return bcryptCompare;
}

interface AuthenticatedRequest extends Request {
  oauth?: Record<string, unknown>;
  authType?: 'oauth' | 'legacy' | 'endpoint_credential';
  authCredentialId?: string;
}

/**
 * F3 - classify a swallowed OAuth-JWT validation error into the specific
 * resource-plane bearer sub-reason, so a rejected bearer token surfaces
 * `bearer_oauth_expired` / `bearer_oauth_signature_invalid` instead of the
 * generic `bearer_invalid`. Returns undefined for anything that is not clearly
 * an expiry or signature failure (e.g. a random non-JWT string), so those still
 * fall through to the generic reason.
 */
export function mapBearerJwtErrorToReason(err: unknown): string | undefined {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
  if (code === 'ERR_JWT_EXPIRED') return 'bearer_oauth_expired';
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'bearer_oauth_signature_invalid';
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return 'bearer_oauth_signature_invalid';
  // No reliable category (e.g. a malformed / non-JWT token) - keep the generic
  // bearer_invalid rather than guessing from a flattened error message.
  return undefined;
}

@Injectable()
export class SharedSecretGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Inject(OAuthService) private readonly oauthService: OAuthService,
    private readonly reflector: Reflector,
    private readonly logger: ScimLogger,
    @Optional() @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository | null,
    @Optional() @Inject(EndpointService)
    private readonly endpointService: EndpointService | null,
    @Optional() @Inject(AuthDecisionRecordStore)
    private readonly decisionStore: AuthDecisionRecordStore | null = null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      this.logger.trace(LogCategory.AUTH, 'Skipping auth – route is public');
      return true;
    }
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<AuthenticatedRequest>();
    const response = httpContext.getResponse<Response>();

    const header = request.headers.authorization;

    // Retrieve shared secret from configuration/env.
    // If it's missing in production we fail fast (never prompt).
    // In non-production (dev/test) we auto-generate a secure ephemeral secret once per process
    // to avoid the app "asking" the operator to configure it manually.
    let expectedSecret = this.configService.get<string>('SCIM_SHARED_SECRET');

    if (!expectedSecret) {
      if (process.env.NODE_ENV === 'production') {
        // Fail fast with clear message – operator must configure the secret explicitly.
        this.logger.fatal(LogCategory.AUTH, 'SCIM_SHARED_SECRET is not configured. Set the environment variable or secret in your deployment.');
        this.reject(response, 'SCIM shared secret not configured.');
      } else {
        // Dev / test convenience: generate once and memoize in env so subsequent guard calls reuse it.
        const generated = crypto.randomBytes(32).toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
        process.env.SCIM_SHARED_SECRET = generated;
        expectedSecret = generated;
        this.logger.warn(LogCategory.AUTH, `Auto-generated ephemeral SCIM_SHARED_SECRET for ${process.env.NODE_ENV || 'development'}`, {
          hint: 'Set SCIM_SHARED_SECRET env var to suppress this warning',
        });
      }
    }

    // Phase 2 (auth observability) - accumulate the resource-plane
    // method-selection cascade as ordered checks, and record ONE
    // AuthDecisionTrace at the terminal decision. Best-effort: recording never
    // changes the auth outcome and never throws.
    const endpointId = this.extractEndpointId(request);
    const checks: AuthCheck[] = [];
    // F3 - the specific OAuth-JWT failure sub-reason, captured when validation
    // throws so a final reject can surface bearer_oauth_expired /
    // bearer_oauth_signature_invalid instead of the generic bearer_invalid.
    let oauthJwtReason: string | undefined;
    const recordDecision = (
      outcome: 'accept' | 'reject',
      method: AuthMethodKind,
      reasonCode?: string,
    ): void => {
      try {
        if (!this.decisionStore) return;
        // Noise control: record every reject, but record an accept ONLY for
        // endpoint-scoped routes (global admin auth accepts are UI-poll noise).
        if (outcome === 'accept' && !endpointId) return;
        const trace: AuthDecisionTrace = {
          plane: 'resource',
          method,
          outcome,
          checks: [...checks],
          ...(endpointId ? { endpointId } : {}),
          ...(getCorrelationContext()?.requestId
            ? { correlationId: getCorrelationContext()!.requestId }
            : {}),
          ...(reasonCode ? { reasonCode } : {}),
        };
        emitAuthDecisionEvent(this.logger, trace, LogCategory.AUTH);
        this.decisionStore.record(trace);
      } catch {
        // best-effort observability; never affect the auth decision
      }
    };

    if (!header || !header.startsWith('Bearer ')) {
      checks.push({
        id: 'token_presented',
        status: 'fail',
        expected: 'Authorization: Bearer <token>',
        received: header ? 'non-bearer scheme' : 'no Authorization header',
      });
      recordDecision('reject', 'bearer_jwt', 'bearer_missing');
      this.logger.warn(LogCategory.AUTH, 'Missing or malformed Authorization header');
      this.reject(response, 'Missing bearer token.', undefined, 'bearer_missing');
    }

    const token = header?.slice(7) ?? '';
    checks.push({
      id: 'token_presented',
      status: 'pass',
      expected: 'Authorization: Bearer <token>',
      received: 'bearer',
    });

    // ── Phase 11: Per-endpoint credential check ──────────────────────
    // If the URL contains an endpointId segment and the endpoint has
    // PerEndpointCredentialsEnabled=true, try per-endpoint credentials first.
    if (endpointId && this.credentialRepo && this.endpointService) {
      const matched = await this.tryEndpointCredential(endpointId, token, request, checks);
      if (matched) {
        recordDecision('accept', 'endpoint_bearer');
        return true;
      }
    } else {
      checks.push({
        id: 'endpoint_bearer',
        status: 'skipped',
        expected: 'a matching per-endpoint bearer credential',
        received: endpointId ? 'not attempted' : 'not an endpoint-scoped route',
      });
    }

    // ── OAuth 2.0 JWT token validation ───────────────────────────────
    if (token !== expectedSecret) {
      this.logger.debug(LogCategory.AUTH, 'Attempting OAuth 2.0 token validation');
      let payload: Record<string, unknown> | undefined;
      try {
        payload = await this.oauthService.validateAccessToken(token);
      } catch (oauthError) {
        // F3 - keep the specific sub-reason (expired vs signature) instead of
        // discarding it, so a subsequent reject can surface it. Still falls
        // through to the legacy-secret acceptor (a token that IS the shared
        // secret is not a JWT and would not set a sub-reason).
        oauthJwtReason = mapBearerJwtErrorToReason(oauthError);
        this.logger.debug(LogCategory.AUTH, 'OAuth 2.0 validation failed, falling back to legacy token', {
          reasonCode: oauthJwtReason,
        });
        payload = undefined; // fall through to legacy token check
      }

      if (payload) {
        // Q1: per-endpoint token scoping. A token carrying an `endpoint_id`
        // claim is scoped to exactly one endpoint and authorizes ONLY that
        // endpoint's routes. Presented to a different endpoint (or a route
        // with no endpoint segment, e.g. global admin), it is
        // "mine-but-invalid-stop": reject now, never fall through to the
        // legacy-secret acceptor (downgrade-confusion defense). The check is
        // OUTSIDE the validate try/catch so the rejection is not swallowed.
        const tokenEndpointId =
          typeof payload.endpoint_id === 'string' ? payload.endpoint_id : undefined;
        if (tokenEndpointId) {
          const urlEndpointId = this.extractEndpointId(request);
          if (urlEndpointId !== tokenEndpointId) {
            checks.push({
              id: 'oauth_jwt',
              status: 'fail',
              expected: `token scoped to ${urlEndpointId ?? 'this route'}`,
              received: `scoped to a different endpoint (${tokenEndpointId})`,
            });
            recordDecision('reject', 'bearer_jwt', 'bearer_token_scoped_other_endpoint');
            this.logger.warn(
              LogCategory.AUTH,
              'Per-endpoint OAuth token presented to a route it is not scoped for',
              { tokenEndpointId, urlEndpointId },
            );
            this.reject(
              response,
              'OAuth token is scoped to a different endpoint.',
              'invalid_token',
              'bearer_token_scoped_other_endpoint',
            );
          }
        }

        checks.push({
          id: 'oauth_jwt',
          status: 'pass',
          expected: 'a valid OAuth 2.0 JWT',
          received: tokenEndpointId ? 'valid (endpoint-scoped)' : 'valid (global)',
        });

        // Add OAuth payload to request for later use
        request.oauth = payload;
        request.authType = 'oauth';

        this.logger.enrichContext({ authType: 'oauth', authClientId: payload.client_id as string });
        this.logger.info(LogCategory.AUTH, 'OAuth 2.0 authentication successful', {
          clientId: payload.client_id as string,
          endpointScoped: tokenEndpointId ? true : false,
        });
        recordDecision('accept', 'bearer_jwt');
        return true;
      }
      checks.push({
        id: 'oauth_jwt',
        status: 'skipped',
        expected: 'a valid OAuth 2.0 JWT',
        received: 'not a valid JWT',
      });
    } else {
      checks.push({
        id: 'oauth_jwt',
        status: 'skipped',
        expected: 'a valid OAuth 2.0 JWT',
        received: 'token equals the global secret (tried as shared_secret)',
      });
    }

    // ── Legacy global bearer token ───────────────────────────────────
    // S-2: timing-safe comparison via safeCompare prevents byte-by-byte
    // guessing of the configured shared secret via response-time analysis.
    if (safeCompare(token, expectedSecret)) {
      // WI-11 - an endpoint-scoped request may REFUSE the global shared secret
      // when SharedSecretBearerAuthEnabled is false on that endpoint (it then
      // accepts only its own per-endpoint credentials / endpoint-scoped OAuth).
      // Global (non-endpoint) routes always accept the secret.
      if (endpointId && this.endpointService) {
        const allowed = await this.isSharedSecretAllowedForEndpoint(endpointId);
        if (!allowed) {
          checks.push({
            id: 'shared_secret',
            status: 'fail',
            expected: 'the endpoint accepts the global SCIM shared secret',
            received: 'refused (SharedSecretBearerAuthEnabled=false)',
          });
          recordDecision('reject', 'shared_secret', 'bearer_shared_secret_refused');
          this.logger.warn(
            LogCategory.AUTH,
            'Global shared secret refused: SharedSecretBearerAuthEnabled is off for this endpoint',
            { endpointId },
          );
          this.reject(response, 'This endpoint does not accept the global shared secret.', 'invalid_token', 'bearer_shared_secret_refused');
        }
      }
      checks.push({
        id: 'shared_secret',
        status: 'pass',
        expected: 'the global SCIM shared secret',
        received: 'matched',
      });
      this.logger.info(LogCategory.AUTH, 'Legacy bearer token authentication successful');
      request.authType = 'legacy';
      this.logger.enrichContext({ authType: 'legacy' });
      recordDecision('accept', 'shared_secret');
      return true;
    }
    checks.push({
      id: 'shared_secret',
      status: 'fail',
      expected: 'the global SCIM shared secret',
      received: 'mismatch',
    });

    // Both per-endpoint, OAuth, and legacy validation failed
    // F3 - prefer the specific OAuth-JWT sub-reason (expired / signature) over
    // the generic bearer_invalid when we captured one during validation.
    const finalReason = oauthJwtReason ?? 'bearer_invalid';
    const finalDetail =
      finalReason === 'bearer_oauth_expired'
        ? 'The bearer token is expired.'
        : finalReason === 'bearer_oauth_signature_invalid'
          ? 'The bearer token signature did not verify.'
          : 'Invalid bearer token.';
    recordDecision('reject', 'bearer_jwt', finalReason);
    this.logger.warn(LogCategory.AUTH, 'Authentication failed – per-endpoint, OAuth, and legacy token all invalid', {
      reasonCode: finalReason,
    });
    this.reject(response, finalDetail, 'invalid_token', finalReason);
  }

  // ── Per-endpoint credential helpers ────────────────────────────────

  /**
   * Extract endpointId from URL pattern /endpoints/:endpointId/...
   */
  private extractEndpointId(request: Request): string | null {
    const match = request.url.match(/\/endpoints\/([0-9a-f-]{36})\//i);
    return match ? match[1] : null;
  }

  /**
   * WI-11 - whether the endpoint accepts the global SCIM_SHARED_SECRET.
   * Effective SharedSecretBearerAuthEnabled defaults to `true` (back-compat),
   * so an endpoint refuses the global secret ONLY when it explicitly sets the
   * flag to false. On any lookup error we fail OPEN (return true) to preserve
   * today's behavior - the secret still had to match to reach this check.
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

  /**
   * Try to authenticate via per-endpoint credentials.
   * Returns true if a matching active credential is found.
   * Returns false to allow fallback to OAuth/legacy.
   */
  private async tryEndpointCredential(
    endpointId: string,
    token: string,
    request: AuthenticatedRequest,
    checks?: AuthCheck[],
  ): Promise<boolean> {
    const note = (status: AuthCheck['status'], received: string): void => {
      checks?.push({
        id: 'endpoint_bearer',
        status,
        expected: 'a matching per-endpoint bearer credential',
        received,
      });
    };
    try {
      // WI-11 - per-method enablement. `bearer` credentials ride
      // SecretTokenBearerAuthEnabled and `oauth_client` credentials ride
      // OAuthClientCredentialsAuthEnabled; each falls back to the legacy
      // PerEndpointCredentialsEnabled when unset (value-preserving migration).
      const endpoint = await this.endpointService!.getEndpoint(endpointId);
      const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
      const effective = getEffectiveAuthEnablement(config);

      if (!effective.secretTokenBearer && !effective.oauthClientCredentials) {
        this.logger.debug(LogCategory.AUTH, 'Per-endpoint credentials not enabled for this endpoint', { endpointId });
        note('skipped', 'per-endpoint credentials not enabled');
        return false; // Fall through to OAuth/legacy
      }

      // PERF: a per-endpoint `bearer`/`oauth_client` credential is an OPAQUE
      // random secret (stored bcrypt-hashed), never a JWT. An OAuth access token
      // and a WIF-minted token ARE JWTs (`eyJ...` three-segment shape). A JWT can
      // therefore NEVER match a per-endpoint secret, so comparing it against each
      // credential's bcrypt hash is pure wasted work - and bcrypt is deliberately
      // expensive (~hundreds of ms each), so this cost is O(active-credentials)
      // per request. For the dominant Entra OAuth-JWT traffic this dominated the
      // request time (e.g. a dev endpoint with 4 secret credentials spent ~1.4s
      // in this loop before falling back to OAuth). Short-circuit JWTs straight
      // to the OAuth/JWKS path; they are validated there, not here.
      if (looksLikeJwt(token)) {
        this.logger.debug(LogCategory.AUTH, 'Presented token is a JWT - skipping per-endpoint secret comparison (OAuth/JWKS validates it)', { endpointId });
        note('skipped', 'token is a JWT (validated by OAuth, not a per-endpoint opaque secret)');
        return false; // Fall through to OAuth/JWT validation
      }

      // Load active credentials for this endpoint
      const credentials = await this.credentialRepo!.findActiveByEndpoint(endpointId);
      if (credentials.length === 0) {
        this.logger.debug(LogCategory.AUTH, 'No active per-endpoint credentials found, falling back', { endpointId });
        note('skipped', 'no active per-endpoint credentials');
        return false; // Fall through to OAuth/legacy
      }

      // Compare token against each credential's bcrypt hash, but ONLY consider a
      // credential whose type's auth method is enabled (WI-11). A `wif` row has
      // an empty hash and never matches; a `bearer`/`oauth_client` row is
      // skipped when its method flag is off.
      const compare = await loadBcryptCompare();
      for (const cred of credentials) {
        if (cred.credentialType === 'bearer' && !effective.secretTokenBearer) continue;
        if (cred.credentialType === 'oauth_client' && !effective.oauthClientCredentials) continue;
        const isMatch = cred.credentialHash
          ? await compare(token, cred.credentialHash)
          : false;
        if (isMatch) {
          request.authType = 'endpoint_credential';
          request.authCredentialId = cred.id;
          this.logger.enrichContext({ authType: 'endpoint_credential', authCredentialId: cred.id });
          this.logger.info(LogCategory.AUTH, 'Per-endpoint credential authentication successful', {
            endpointId,
            credentialId: cred.id,
            label: cred.label,
          });
          note('pass', `matched credential ${cred.id}`);
          return true;
        }
      }

      this.logger.debug(LogCategory.AUTH, 'Per-endpoint credential mismatch, falling back to OAuth/legacy', { endpointId });
      note('fail', `no active credential matched (of ${credentials.length})`);
      return false; // No match - fall through to OAuth/legacy
    } catch (error) {
      // If endpoint not found or any error, fall through to global auth
      this.logger.debug(LogCategory.AUTH, 'Per-endpoint credential check failed, falling back', {
        endpointId,
        error: (error as Error).message,
      });
      note('skipped', 'per-endpoint credential lookup failed (fell back)');
      return false;
    }
  }

  private reject(
    response: Response,
    detail: string,
    errorCode?: 'invalid_token' | 'invalid_request' | 'insufficient_scope',
    reasonCode?: string,
  ): never {
    // RFC 6750 section 3: a 401 carries a WWW-Authenticate challenge. When a
    // token was presented but rejected, include error + error_description so
    // the client learns why. When the request lacked credentials entirely,
    // advertise only the realm and omit the error code (RFC 6750 section 3).
    let header = 'Bearer realm="SCIM"';
    if (errorCode) {
      const safeDescription = detail.replace(/[\\"]/g, ' ').trim();
      header += `, error="${errorCode}", error_description="${safeDescription}"`;
    }
    response.setHeader('WWW-Authenticate', header);
    const body: Record<string, unknown> = {
      schemas: [SCIM_ERROR_SCHEMA],
      detail,
      status: 401,
      scimType: 'invalidToken',
    };
    // F4 - carry the catalog reason_code in the SCIM Diagnostics extension URN
    // (a documented member, so the SCIM error contract stays intact) so API
    // clients + the UI can key on the SPECIFIC resource-plane reason, not just a
    // generic 401. requestId/endpointId/logsUrl are merged in by ScimExceptionFilter.
    if (reasonCode) {
      body[SCIM_DIAGNOSTICS_URN] = { reason_code: reasonCode };
    }
    throw new UnauthorizedException(body);
  }
}
