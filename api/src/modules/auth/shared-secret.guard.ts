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
import { OAuthService } from '../../oauth/oauth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ScimLogger } from '../logging/scim-logger.service';
import { LogCategory } from '../logging/log-levels';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { AuthDecisionRecordStore } from '../../oauth/auth-decision-record.store';
import {
  emitAndRecordAuthDecision,
  type AuthDecisionTrace,
  type AuthCheck,
  type AuthMethodKind,
} from '../../oauth/auth-decision-trace';
import { getCorrelationContext } from '../logging/scim-logger.service';
import type {
  AuthContext,
  AuthenticatedRequest,
  ResourceAuthenticator,
} from './authenticators/resource-authenticator';
import { EndpointCredentialAuthenticator } from './authenticators/endpoint-credential.authenticator';
import { OAuthJwtAuthenticator } from './authenticators/oauth-jwt.authenticator';
import { GlobalSharedSecretAuthenticator } from './authenticators/global-shared-secret.authenticator';

/**
 * F3 - re-exported for backward compatibility. The implementation moved to the
 * OAuth authenticator in W2.1 (the resource-plane strategy-chain extraction).
 */
export { mapBearerJwtErrorToReason } from './authenticators/oauth-jwt.authenticator';

@Injectable()
export class SharedSecretGuard implements CanActivate {
  /**
   * W2.1 - the ordered resource-plane probe-chain. Composed once from the
   * guard's deps and pinned to the precedence order (per-endpoint credential ->
   * endpoint-scoped OAuth JWT -> legacy global secret). Adding a method = a new
   * ResourceAuthenticator class + one entry here.
   */
  private readonly authenticators: ResourceAuthenticator[];

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
  ) {
    this.authenticators = [
      new EndpointCredentialAuthenticator(this.credentialRepo, this.endpointService, this.logger),
      new OAuthJwtAuthenticator(this.oauthService, this.logger),
      new GlobalSharedSecretAuthenticator(this.endpointService, this.logger),
    ].sort((a, b) => a.order - b.order);
  }

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
    // F3 - a fall-through sub-reason (expired / signature) an authenticator may
    // surface on not-applicable, so the TERMINAL reject can prefer it over the
    // generic bearer_invalid.
    let fallthroughReason: string | undefined;
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
        emitAndRecordAuthDecision(this.logger, trace, this.decisionStore, LogCategory.AUTH);
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

    // ── W2.1 probe-chain ─────────────────────────────────────────────
    // Walk the ordered ResourceAuthenticator chain (Spring ProviderManager
    // shape). The first `accept` allows; the first `reject` denies and STOPS
    // (never falls through - the downgrade-confusion defense); `not-applicable`
    // continues. Each authenticator owns its method's lookup + validation +
    // enablement; the guard owns the trace accumulation + terminal decision.
    const authContext: AuthContext = { token, request, endpointId, expectedSecret };
    for (const authenticator of this.authenticators) {
      const attempt = await authenticator.tryAuthenticate(authContext);
      if (attempt.checks) checks.push(...attempt.checks);

      if (attempt.outcome === 'accept') {
        attempt.apply?.(request);
        recordDecision('accept', attempt.method);
        return true;
      }
      if (attempt.outcome === 'reject') {
        recordDecision('reject', attempt.method, attempt.reasonCode);
        this.reject(response, attempt.detail, attempt.errorCode, attempt.reasonCode);
      }
      // not-applicable: remember any specific fall-through reason and continue.
      if (attempt.fallthroughReason) fallthroughReason = attempt.fallthroughReason;
    }

    // Every authenticator returned not-applicable - terminal reject. F3: prefer
    // the specific OAuth-JWT sub-reason (expired / signature) over the generic.
    const finalReason = fallthroughReason ?? 'bearer_invalid';
    const finalDetail =
      finalReason === 'bearer_oauth_expired'
        ? 'The bearer token is expired.'
        : finalReason === 'bearer_oauth_signature_invalid'
          ? 'The bearer token signature did not verify.'
          : 'Invalid bearer token.';
    recordDecision('reject', 'bearer_jwt', finalReason);
    this.logger.warn(LogCategory.AUTH, 'Authentication failed - per-endpoint, OAuth, and legacy token all invalid', {
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

  // Per-endpoint credential + shared-secret enablement logic moved to the
  // EndpointCredentialAuthenticator + GlobalSharedSecretAuthenticator (W2.1).

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
