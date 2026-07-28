/**
 * AdminCredentialController - Admin API for managing per-endpoint SCIM credentials.
 *
 * Phase 11: Provides CRUD endpoints to create, list, and revoke per-endpoint
 * bearer tokens. Tokens are bcrypt-hashed before storage; the plaintext is
 * returned only once at creation time.
 *
 * Gated behind the `PerEndpointCredentialsEnabled` per-endpoint config flag.
 *
 * Routes:
 *   POST   /admin/endpoints/:endpointId/credentials              - Create new credential
 *   GET    /admin/endpoints/:endpointId/credentials              - List credentials (hash masked)
 *   DELETE /admin/endpoints/:endpointId/credentials/:credentialId - Revoke (deactivate) credential
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import {
  WifDiscoveryResolverService,
  type WifResolveRequest,
  type WifResolveResult,
  type WifVerifyRequest,
  type WifVerifyResult,
} from '../../../oauth/wif-discovery-resolver.service';
import {
  WifAssertionValidatorService,
  type WifTrust,
} from '../../../oauth/wif-assertion-validator.service';
import { inferAllowedTenantId } from '../../../oauth/infer-allowed-tenant-id';
import type {
  WifDebugAssertionRequest,
  WifDebugAssertionResponse,
  WifDebugTrustResult,
} from '../../../shared/types/wif-debug.types';
import { getConfigBoolean, resolveEndpointAuthEnablement, ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { getCorrelationContext } from '../../logging/scim-logger.service';
import { emitAuthAdminEvent } from '../../../oauth/auth-admin-event';
import { CredentialEncryptionService } from '../../../security/credential-encryption.service';
import { CredentialSecurityService } from '../../../security/credential-security.service';
import {
  SCIM_EVENTS,
  type ScimCredentialEventPayload,
} from '../../stats/scim-events';

const BCRYPT_SALT_ROUNDS = 12;

interface CreateCredentialDto {
  label?: string;
  /**
   * X3/X4 - optional free-text description (operator notes) for a credential /
   * WIF trust. Persisted in `metadata.description`; never a secret. Trimmed;
   * an empty string is stored as no description.
   */
  description?: string | null;
  credentialType?: string; // "bearer" (default) | "oauth_client" | "wif"
  expiresAt?: string;      // ISO 8601 date
  wif?: WifTrustInput;     // required when credentialType === "wif"
  clientId?: string;       // WI-14: optional explicit client_id for oauth_client
  /**
   * Item C: when true, a `wif` create/edit runs the server-side reachability +
   * liveness verification (issuer OIDC discovery + JWKS serves keys) BEFORE
   * persisting, and rejects with 422 + the failed checks when it does not pass
   * - so the operator never saves a trust that will fail at runtime. Default
   * (absent/false) preserves the ability to pre-stage a trust before its IdP is
   * fully live.
   */
  verify?: boolean;
}

/**
 * WIF trust config (A1) - all PUBLIC values; NO secret material. Persisted on
 * the `wif` EndpointCredential.metadata (no credentialHash). The validator
 * (Q6) consumes these to check an assertion.
 */
interface WifTrustInput {
  assertionProfile?: 'jwt-bearer' | 'token-exchange';
  subjectTokenType?: string | null;
  expectedResource?: string | null;
  expectedIssuer: string;
  expectedSubject: string;
  expectedAudience: string;
  jwksUri: string;
  allowedTenantId: string;
  /**
   * W3.2 - the OAuth client id the endpoint's issued token is minted as. The
   * federated assertion `sub` is NEVER used as the issued `client_id`; absent,
   * the mint uses the endpointId. All public (non-secret).
   */
  targetClientId?: string;
  /**
   * U8 - when `allowedTenantId` was gleaned from the issuer/JWKS URI rather than
   * supplied explicitly, this non-secret marker records which input it came from
   * so the UI can show "Inferred from {issuer|JWKS URI}". Absent when explicit.
   */
  allowedTenantIdSource?: 'issuer' | 'jwksUri';
  requiredRoles?: string[];
  scope?: string;
  issuedTokenTtlSec?: number;
  /**
   * W3.1 - the protocol profile(s) this trust serves (`syncfabric-rfc7523` /
   * `syncfabric-rfc8693`). When absent it is projected from the legacy singular
   * `assertionProfile`, so existing trusts are unaffected.
   */
  enabledProfiles?: string[];
  /** W3.4 - RFC 8707 resource policy: how strictly the request `resource` is checked. */
  resourceMode?: 'ignore' | 'optionalExact' | 'requiredExact';
  // ── A4 seams (persisted; computed in shadow telemetry, not enforced) ──
  identityModel?: 'per-app' | 'first-party';
  roleScopeMap?: Record<string, string[]>;
  grantedScopes?: string[];
  roleEnforcement?: 'off' | 'shadow' | 'enforce';
}

/** Keys allowed on a WIF trust metadata object (no secret-bearing keys). */
const WIF_TRUST_KEYS: ReadonlyArray<keyof WifTrustInput> = [
  'assertionProfile', 'subjectTokenType', 'expectedResource', 'expectedIssuer',
  'expectedSubject', 'expectedAudience', 'jwksUri', 'allowedTenantId',
  'allowedTenantIdSource',
  'targetClientId',
  'requiredRoles', 'scope', 'issuedTokenTtlSec',
  'resourceMode',
  'enabledProfiles',
  // A4 seams
  'identityModel', 'roleScopeMap', 'grantedScopes', 'roleEnforcement',
];

/**
 * WI-13 - accepted INPUT aliases for the WIF trust fields, so a power user can
 * paste a decoded token's bare claim names (`iss`/`sub`/`aud`/`tid`/`roles`) or
 * the clearer `expectedTenantId`, and they normalize to the canonical stored
 * keys. A canonical key, when explicitly supplied, ALWAYS wins over its alias.
 * The runtime validation + storage contract is unchanged - this is purely a
 * config-time input convenience that fills the SAME canonical fields.
 */
const WIF_TRUST_ALIASES: Readonly<Record<string, keyof WifTrustInput>> = {
  iss: 'expectedIssuer',
  sub: 'expectedSubject',
  aud: 'expectedAudience',
  tid: 'allowedTenantId',
  expectedTenantId: 'allowedTenantId',
  roles: 'requiredRoles',
};

/**
 * Normalize a raw WIF trust input: copy any accepted alias key onto its
 * canonical key WITHOUT overwriting a canonical key the caller set explicitly.
 * Returns a shallow copy; the original is not mutated.
 */
function normalizeWifTrustAliases(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const [alias, canonical] of Object.entries(WIF_TRUST_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
    // Drop the alias key so it never leaks into stored metadata.
    delete out[alias];
  }
  return out;
}

/**
 * Unified create-credential response shape. Different credential types populate
 * different one-time-secret fields (`token` for bearer, `clientId`+`clientSecret`
 * for oauth_client, `wif` public trust for wif), so they are all optional.
 */
interface CreateCredentialResponse {
  id: string;
  endpointId: string;
  credentialType: string;
  label: string | null;
  description?: string | null;
  active: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  wif?: Record<string, unknown>;
}

/**
 * X3/X4 - normalize a credential/WIF-trust `description` for storage: trim it,
 * and treat an empty/whitespace-only value as "no description" (null). Never a
 * secret - stored as plain `metadata.description`.
 */
function normalizeCredentialDescription(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Controller('admin/endpoints')
export class AdminCredentialController {

  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly endpointService: EndpointService,
    private readonly logger: ScimLogger,
    private readonly eventEmitter: EventEmitter2,
    private readonly wifResolver: WifDiscoveryResolverService,
    private readonly credentialEncryption: CredentialEncryptionService,
    private readonly credentialSecurity: CredentialSecurityService,
    private readonly wifValidator: WifAssertionValidatorService,
  ) {}

  /**
   * POST /admin/endpoints/:endpointId/wif/resolve  (WI-14)
   *
   * Config-time WIF discovery resolver. Reads the SOURCE IdP's OIDC discovery
   * document and returns the signing-trust fields (`expectedIssuer` +
   * `jwksUri`) plus a proposed `expectedAudience` default (the endpointId), so
   * the admin fills five previously-required fields from one or two inputs.
   * Nothing is persisted here - the returned values are handed to the normal
   * `wif` create call. Gated by the JWKS host allowlist (SSRF).
   */
  @Post(':endpointId/wif/resolve')
  async resolveWifDiscovery(
    @Param('endpointId') endpointId: string,
    @Body() body: WifResolveRequest,
  ): Promise<WifResolveResult> {
    const endpoint = await this.requireEndpoint(endpointId);
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED)) {
      throw new ForbiddenException(
        `WIF credentials are not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
      );
    }
    return this.wifResolver.resolve(endpointId, body ?? {});
  }

  /**
   * POST /admin/endpoints/:endpointId/wif/verify  (item 6)
   *
   * Config-time reachability + liveness check for a WIF trust's issuer + JWKS
   * URI. Fetches (SSRF-gated) the issuer's OIDC discovery document and the JWKS
   * URI, and reports a per-check checklist: valid https format, host on the
   * allowlist, reachable, and that the JWKS actually serves a non-empty key set
   * - so the operator confirms the URLs work BEFORE saving the trust instead of
   * hitting a runtime surprise. Non-throwing: a failed check is reported, not an
   * error status. Same allowlist gate as the runtime JWKS fetch.
   */
  @Post(':endpointId/wif/verify')
  @HttpCode(200)
  async verifyWifTrust(
    @Param('endpointId') endpointId: string,
    @Body() body: WifVerifyRequest & { credentialId?: string },
  ): Promise<WifVerifyResult> {
    const endpoint = await this.requireEndpoint(endpointId);
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED)) {
      throw new ForbiddenException(
        `WIF credentials are not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
      );
    }
    const result = await this.wifResolver.verifyTrust(body ?? {});
    // V7 - when the verify targets a SAVED trust (credentialId supplied) and it
    // passes, persist lastVerifiedAt onto that credential so the trust card
    // flips Unverified -> Verified. A verify with no credentialId stays a pure
    // dry-run (the add-form / ad-hoc case), unchanged.
    let verifiedAt: string | undefined;
    if (result.ok && typeof body?.credentialId === 'string' && body.credentialId.length > 0) {
      const credential = await this.credentialRepo.findById(body.credentialId);
      if (credential && credential.endpointId === endpointId && credential.credentialType === 'wif') {
        verifiedAt = new Date().toISOString();
        const nextMetadata: Record<string, unknown> = { ...(credential.metadata ?? {}), lastVerifiedAt: verifiedAt };
        await this.credentialRepo.updateMetadata(body.credentialId, nextMetadata);
      }
    }
    // Phase 4 - config-time auth audit event for a WIF trust verification.
    emitAuthAdminEvent(
      this.logger,
      {
        action: 'wif_verify',
        outcome: result.ok ? 'success' : 'failure',
        endpointId,
        method: 'wif',
        credentialId: body?.credentialId,
        correlationId: getCorrelationContext()?.requestId,
      },
      LogCategory.AUTH,
    );
    return verifiedAt ? { ...result, lastVerifiedAt: verifiedAt } : result;
  }

  /**
   * POST /admin/endpoints/:endpointId/wif/debug-assertion  (WI-D7)
   *
   * Assertion debugger: decode a pasted `client_assertion` and dry-run it
   * against EVERY configured WIF trust for this endpoint using the exact same
   * server-side checks a real mint would run (real JWKS fetch + signature +
   * issuer/subject/audience/tenant/role matching), but WITHOUT minting a
   * token. Returns the per-check `AuthDecisionTrace` for each trust so the
   * operator sees precisely which claim is wrong before the IdP is wired up.
   * Admin-only, non-throwing on a bad assertion (a reject is a result, not a
   * 4xx). Same WIF-enabled gate as the other wif/* admin endpoints.
   */
  @Post(':endpointId/wif/debug-assertion')
  @HttpCode(200)
  async debugWifAssertion(
    @Param('endpointId') endpointId: string,
    @Body() body: WifDebugAssertionRequest,
  ): Promise<WifDebugAssertionResponse> {
    const endpoint = await this.requireEndpoint(endpointId);
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED)) {
      throw new ForbiddenException(
        `WIF credentials are not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
      );
    }

    const assertion = typeof body?.assertion === 'string' ? body.assertion.trim() : '';
    if (assertion.length === 0) {
      throw new BadRequestException('A non-empty "assertion" (client_assertion JWT) is required.');
    }

    const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
    const wifCredentials = credentials.filter((c) => c.credentialType === 'wif');

    const results: WifDebugTrustResult[] = [];
    for (const wif of wifCredentials) {
      let trust: WifTrust;
      try {
        trust = this.buildDebugTrust(wif.metadata);
      } catch {
        // A misconfigured trust row cannot match; skip it in the debugger just
        // as the runtime does, but surface it as a reject so the operator sees
        // the endpoint has an unusable trust.
        results.push({
          expectedIssuer:
            typeof wif.metadata?.expectedIssuer === 'string' ? wif.metadata.expectedIssuer : '(unconfigured)',
          outcome: 'reject',
          reasonCode: 'wif_no_trust_configured',
          trace: {
            plane: 'token-mint',
            method: 'wif',
            outcome: 'reject',
            reasonCode: 'wif_no_trust_configured',
            checks: [],
          },
        });
        continue;
      }
      const result = await this.wifValidator.debug(assertion, trust);
      results.push({
        expectedIssuer: trust.expectedIssuer,
        outcome: result.outcome,
        reasonCode: result.reasonCode,
        trace: result.trace,
      });
    }

    const overallOutcome = results.some((r) => r.outcome === 'accept') ? 'accept' : 'reject';
    // Phase 4 - config-time auth audit event for a WIF assertion dry-run. This
    // is a DRY-RUN: it evaluates against every trust but never mints a token.
    const firstReject = results.find((r) => r.outcome === 'reject');
    emitAuthAdminEvent(
      this.logger,
      {
        action: 'wif_debug_assertion',
        outcome: overallOutcome === 'accept' ? 'success' : 'failure',
        endpointId,
        method: 'wif',
        dryRun: true,
        reasonCode: overallOutcome === 'accept' ? undefined : firstReject?.reasonCode,
        detail: `${wifCredentials.length} trust(s) evaluated`,
        correlationId: getCorrelationContext()?.requestId,
      },
      LogCategory.AUTH,
    );

    return {
      overallOutcome,
      results,
    };
  }

  /** WI-D7 - defensively read a WifTrust from credential metadata for a dry-run. */
  private buildDebugTrust(metadata: Record<string, unknown> | null): WifTrust {
    const m = metadata ?? {};
    const requireString = (key: string): string => {
      const value = m[key];
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`WIF trust metadata is missing required field "${key}".`);
      }
      return value;
    };
    return {
      expectedIssuer: requireString('expectedIssuer'),
      expectedSubject: requireString('expectedSubject'),
      expectedAudience: requireString('expectedAudience'),
      jwksUri: requireString('jwksUri'),
      allowedTenantId: requireString('allowedTenantId'),
      requiredRoles: Array.isArray(m.requiredRoles)
        ? (m.requiredRoles as unknown[]).filter((r): r is string => typeof r === 'string')
        : undefined,
      roleEnforcement:
        m.roleEnforcement === 'shadow' || m.roleEnforcement === 'enforce' ? m.roleEnforcement : 'off',
    };
  }
  @Post(':endpointId/credentials')
  async createCredential(
    @Param('endpointId') endpointId: string,
    @Body() dto: CreateCredentialDto,
  ): Promise<CreateCredentialResponse> {
    const endpoint = await this.requireEndpoint(endpointId);
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;

    const credentialType = dto.credentialType ?? 'bearer';
    if (!['bearer', 'oauth_client', 'wif'].includes(credentialType)) {
      throw new BadRequestException(
        `Invalid credentialType "${credentialType}". Allowed values: "bearer", "oauth_client", "wif".`,
      );
    }

    // A1 - orthogonal create gate. WIF rides its own enabling flag
    // (WifCredentialsEnabled), independent of the bcrypt-bearer gate.
    if (credentialType === 'wif') {
      if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED)) {
        throw new ForbiddenException(
          `WIF credentials are not enabled for endpoint "${endpointId}". ` +
          `Set "${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
        );
      }
      return this.createWifCredential(endpointId, dto);
    }

    // WI-11 / W2.5 - per-method create gate resolved from the single source: an
    // explicit `profile.authentication.methods[]` entry wins, else the flat flags
    // (SecretTokenBearerAuthEnabled / OAuthClientCredentialsAuthEnabled, each
    // falling back to the legacy PerEndpointCredentialsEnabled).
    const effective = resolveEndpointAuthEnablement(config, endpoint.profile?.authentication?.methods);
    if (credentialType === 'bearer' && !effective.secretTokenBearer) {
      throw new ForbiddenException(
        `Per-endpoint bearer (Secret Token) auth is not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.SECRET_TOKEN_BEARER_AUTH_ENABLED}" to "True" in the endpoint config ` +
        `(or the legacy "${ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED}").`,
      );
    }
    if (credentialType === 'oauth_client' && !effective.oauthClientCredentials) {
      throw new ForbiddenException(
        `Per-endpoint OAuth client-credentials auth is not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED}" to "True" in the endpoint config ` +
        `(or the legacy "${ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED}").`,
      );
    }

    // Parse optional expiry
    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
      if (isNaN(expiresAt.getTime())) {
        throw new BadRequestException(`Invalid expiresAt date: "${dto.expiresAt}". Use ISO 8601 format.`);
      }
      if (expiresAt <= new Date()) {
        throw new BadRequestException('expiresAt must be in the future.');
      }
    }

    // Generate a cryptographically secure random token
    const plaintext = crypto.randomBytes(32).toString('base64url');

    // Hash with bcrypt
    const hash = await bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);

    // Q1: an `oauth_client` credential is a per-endpoint client_id / client_secret
    // pair used at the per-endpoint token endpoint to mint endpoint-scoped tokens.
    // The plaintext secret rides `credentialHash` (bcrypt); the public client_id
    // rides `metadata.clientId`. Both the client_id and the one-time secret are
    // returned at create; the secret is NEVER stored or returned again.
    if (credentialType === 'oauth_client') {
      // R7 smart default: the FIRST oauth_client on an endpoint uses the
      // readable `client-id-<endpointId>` form as its (public) client_id - no
      // lookup needed. Any additional one gets a generated id to avoid a
      // collision. An explicit dto.clientId always wins.
      let clientId: string;
      if (dto.clientId && dto.clientId.trim().length > 0) {
        clientId = dto.clientId.trim();
      } else {
        const existing = await this.credentialRepo.findByEndpoint(endpointId);
        const hasOauthClient = existing.some((c) => c.credentialType === 'oauth_client');
        clientId = hasOauthClient
          ? `client-id-${crypto.randomUUID()}`
          : `client-id-${endpointId}`;
      }
      // R7: the oauth_client secret uses the readable `client-secret-<uuid>`
      // form (operator request) instead of the generic random token. It is
      // still hashed with bcrypt and only its hash is stored.
      const oauthSecret = `client-secret-${crypto.randomUUID()}`;
      const oauthHash = await bcrypt.hash(oauthSecret, BCRYPT_SALT_ROUNDS);
      const oauthDescription = normalizeCredentialDescription(dto.description);
      const credential = await this.credentialRepo.create({
        endpointId,
        credentialType,
        credentialHash: oauthHash,
        label: dto.label ?? null,
        metadata: oauthDescription != null ? { clientId, description: oauthDescription } : { clientId },
        secretEnvelope: await this.maybeRetainSecret(config, oauthSecret),
        expiresAt,
      });

      this.logger.info(
        LogCategory.AUTH,
        `Created per-endpoint oauth_client credential "${credential.id}" (clientId "${clientId}") for endpoint "${endpointId}"`,
      );

      const oauthEventPayload: ScimCredentialEventPayload = {
        endpointId,
        credentialId: credential.id,
        credentialType: credential.credentialType,
        label: credential.label ?? undefined,
      };
      this.eventEmitter.emit(SCIM_EVENTS.CREDENTIAL_CREATED, oauthEventPayload);

      return {
        id: credential.id,
        endpointId: credential.endpointId,
        credentialType: credential.credentialType,
        label: credential.label,
        description: oauthDescription,
        active: credential.active,
        createdAt: credential.createdAt,
        expiresAt: credential.expiresAt,
        clientId,
        // ⚠️ Secret is returned ONLY here, ONCE (unless retained via the
        // effective CredentialSecretVisibility=always). Only its bcrypt hash
        // is stored.
        clientSecret: oauthSecret,
      };
    }

    const bearerDescription = normalizeCredentialDescription(dto.description);
    const credential = await this.credentialRepo.create({
      endpointId,
      credentialType,
      credentialHash: hash,
      label: dto.label ?? null,
      metadata: bearerDescription != null ? { description: bearerDescription } : undefined,
      secretEnvelope: await this.maybeRetainSecret(config, plaintext),
      expiresAt,
    });

    this.logger.info(LogCategory.AUTH, `Created per-endpoint credential "${credential.id}" for endpoint "${endpointId}"`);

    // Phase J (v0.48.1): broadcast onto SSE so cross-tab CredentialsTab
    // refreshes within ms instead of waiting on the 30s staleTime.
    // Emit AFTER the persisted write + log so a failure in either does
    // not produce a stale event for consumers.
    const credentialEventPayload: ScimCredentialEventPayload = {
      endpointId,
      credentialId: credential.id,
      credentialType: credential.credentialType,
      label: credential.label ?? undefined,
    };
    this.eventEmitter.emit(SCIM_EVENTS.CREDENTIAL_CREATED, credentialEventPayload);

    return {
      id: credential.id,
      endpointId: credential.endpointId,
      credentialType: credential.credentialType,
      label: credential.label,
      description: bearerDescription,
      active: credential.active,
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
      // ⚠️ Token is returned ONLY here, ONCE. It is NOT stored.
      token: plaintext,
    };
  }

  /**
   * GET /admin/endpoints/:endpointId/credentials
   *
   * List all credentials for an endpoint. Hashes are NOT returned.
   */
  @Get(':endpointId/credentials')
  async listCredentials(@Param('endpointId') endpointId: string) {
    await this.requireEndpoint(endpointId);

    const credentials = await this.credentialRepo.findByEndpoint(endpointId);

    return credentials.map((c) => ({
      id: c.id,
      endpointId: c.endpointId,
      credentialType: c.credentialType,
      label: c.label,
      active: c.active,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      // Q1: expose the PUBLIC client_id for oauth_client credentials so the UI
      // can show it. The secret is never stored and never returned in a list.
      ...(c.credentialType === 'oauth_client' && c.metadata?.clientId
        ? { clientId: c.metadata.clientId as string }
        : {}),
      // Hash is NEVER returned in list responses
    }));
  }

  /**
   * DELETE /admin/endpoints/:endpointId/credentials/:credentialId
   *
   * Revoke (deactivate) a credential. The hash remains in the database
   * but is marked inactive and will no longer match during auth.
   */
  @Delete(':endpointId/credentials/:credentialId')
  @HttpCode(204)
  async revokeCredential(
    @Param('endpointId') endpointId: string,
    @Param('credentialId') credentialId: string,
  ) {
    await this.requireEndpoint(endpointId);

    const credential = await this.credentialRepo.findById(credentialId);
    if (!credential || credential.endpointId !== endpointId) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }

    await this.credentialRepo.deactivate(credentialId);
    this.logger.info(LogCategory.AUTH, `Revoked credential "${credentialId}" for endpoint "${endpointId}"`);

    // Phase J (v0.48.1): emit-after-commit; symmetrical with create.
    const credentialEventPayload: ScimCredentialEventPayload = {
      endpointId,
      credentialId,
      credentialType: credential.credentialType,
      label: credential.label ?? undefined,
    };
    this.eventEmitter.emit(SCIM_EVENTS.CREDENTIAL_REVOKED, credentialEventPayload);
  }

  /**
   * POST /admin/endpoints/:endpointId/credentials/:credentialId/activate  (V2)
   *
   * Reactivate a previously revoked credential (active=false -> true) - the
   * inverse of DELETE. Applies to bearer / oauth_client / wif alike (a WIF
   * trust is a credential). Returns the reactivated credential's public
   * projection (never a secret). 404 for an unknown / cross-endpoint id.
   */
  @Post(':endpointId/credentials/:credentialId/activate')
  @HttpCode(200)
  async activateCredential(
    @Param('endpointId') endpointId: string,
    @Param('credentialId') credentialId: string,
  ): Promise<{ id: string; endpointId: string; credentialType: string; label: string | null; active: boolean }> {
    await this.requireEndpoint(endpointId);

    const credential = await this.credentialRepo.findById(credentialId);
    if (!credential || credential.endpointId !== endpointId) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }

    const updated = await this.credentialRepo.reactivate(credentialId);
    if (!updated) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }
    this.logger.info(LogCategory.AUTH, `Reactivated credential "${credentialId}" for endpoint "${endpointId}"`);
    return {
      id: updated.id,
      endpointId: updated.endpointId,
      credentialType: updated.credentialType,
      label: updated.label,
      active: updated.active,
    };
  }

  /**
   * PATCH /admin/endpoints/:endpointId/credentials/:credentialId  (V3)
   *
   * Edit a credential's non-secret display field(s) - today the `label` - for
   * ANY credential type (bearer / oauth_client / wif) WITHOUT rotating the
   * secret or touching the trust config. The secret/hash/metadata are
   * untouched. Returns the credential's public projection. 404 for an unknown /
   * cross-endpoint id; 400 when no editable field is supplied.
   */
  @Patch(':endpointId/credentials/:credentialId')
  async editCredential(
    @Param('endpointId') endpointId: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: { label?: string | null },
  ): Promise<{ id: string; endpointId: string; credentialType: string; label: string | null; active: boolean }> {
    await this.requireEndpoint(endpointId);

    const credential = await this.credentialRepo.findById(credentialId);
    if (!credential || credential.endpointId !== endpointId) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }
    if (dto.label === undefined) {
      throw new BadRequestException('Provide a "label" to edit.');
    }
    if (!this.credentialRepo.updateLabel) {
      throw new BadRequestException('Editing a credential label is not supported by this backend.');
    }
    const updated = await this.credentialRepo.updateLabel(credentialId, dto.label);
    if (!updated) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }
    this.logger.info(LogCategory.AUTH, `Edited credential "${credentialId}" label for endpoint "${endpointId}"`);
    return {
      id: updated.id,
      endpointId: updated.endpointId,
      credentialType: updated.credentialType,
      label: updated.label,
      active: updated.active,
    };
  }

  /**
   * PUT /admin/endpoints/:endpointId/credentials/:credentialId  (item 4)
   *
   * Edit a saved WIF trust in place. WIF trusts are all-public config (no
   * secret), so the operator can correct a typo, rotate the JWKS URI, change
   * the required roles, etc. after the fact. ONLY `wif` credentials are
   * editable this way (bearer/oauth_client secrets are rotated, not edited).
   * Applies the same alias normalization + required-field validation + public
   * key projection as create, then replaces the metadata. Echoes the updated
   * public trust (never a secret - a WIF credential has none).
   */
  @Put(':endpointId/credentials/:credentialId')
  async updateWifCredential(
    @Param('endpointId') endpointId: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: CreateCredentialDto,
  ): Promise<CreateCredentialResponse> {
    await this.requireEndpoint(endpointId);

    const credential = await this.credentialRepo.findById(credentialId);
    if (!credential || credential.endpointId !== endpointId) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }
    if (credential.credentialType !== 'wif') {
      throw new BadRequestException(
        'Only "wif" credentials are editable. Rotate a bearer/oauth_client secret instead of editing it.',
      );
    }

    const rawTrust = dto.wif;
    if (!rawTrust || typeof rawTrust !== 'object') {
      throw new BadRequestException('A "wif" credential update requires a "wif" trust object.');
    }
    const trust = normalizeWifTrustAliases(rawTrust as unknown as Record<string, unknown>);
    this.applyTenantGleaning(trust);
    for (const required of ['expectedIssuer', 'expectedSubject', 'expectedAudience', 'jwksUri', 'allowedTenantId'] as const) {
      if (!trust[required] || typeof trust[required] !== 'string') {
        throw new BadRequestException(`WIF trust is missing required field "${required}".`);
      }
    }

    // Item C: opt-in reachability + liveness gate BEFORE persisting the edit.
    await this.verifyTrustOrThrow(dto.verify, trust);

    const metadata: Record<string, unknown> = {};
    for (const key of WIF_TRUST_KEYS) {
      if (trust[key] !== undefined) metadata[key] = trust[key];
    }
    metadata.assertionProfile = trust.assertionProfile ?? 'jwt-bearer';

    // U7: refresh the last-verified time when this edit re-verified; otherwise
    // carry forward the credential's prior verification timestamp.
    const priorVerifiedAt =
      typeof credential.metadata?.lastVerifiedAt === 'string' ? credential.metadata.lastVerifiedAt : undefined;
    if (dto.verify) metadata.lastVerifiedAt = new Date().toISOString();
    else if (priorVerifiedAt) metadata.lastVerifiedAt = priorVerifiedAt;

    // X3 - update the description when supplied; otherwise carry forward the
    // prior one (updateMetadata replaces the whole metadata object).
    const priorDescription =
      typeof credential.metadata?.description === 'string' ? credential.metadata.description : undefined;
    if (dto.description !== undefined) {
      const nextDescription = normalizeCredentialDescription(dto.description);
      if (nextDescription != null) metadata.description = nextDescription;
    } else if (priorDescription != null) {
      metadata.description = priorDescription;
    }

    const updated = await this.credentialRepo.updateMetadata(credentialId, metadata);
    if (!updated) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }

    // Item 4: allow editing the label in the same call when supplied.
    let labelled = updated;
    if (dto.label !== undefined && dto.label !== updated.label && this.credentialRepo.updateLabel) {
      labelled = (await this.credentialRepo.updateLabel(credentialId, dto.label)) ?? updated;
    }
    this.logger.info(LogCategory.AUTH, `Updated wif credential "${credentialId}" for endpoint "${endpointId}"`);

    return {
      id: labelled.id,
      endpointId: labelled.endpointId,
      credentialType: labelled.credentialType,
      label: labelled.label,
      active: labelled.active,
      createdAt: labelled.createdAt,
      expiresAt: labelled.expiresAt,
      wif: metadata,
      description: typeof metadata.description === 'string' ? metadata.description : null,
    };
  }

  /**
   * POST /admin/endpoints/:endpointId/credentials/:credentialId/reveal  (WI-8)
   *
   * Reveal a RETAINED credential secret. Admin-only + audit-logged. Gated by
   * the effective CredentialSecretVisibility (must be `always`) AND the
   * presence of a stored envelope. When the effective setting is `once`, the
   * credential predates the feature, or no envelope was retained, this returns
   * a non-error `{retained:false, reason}` shape (never an error) so the UI can
   * explain "rotate to get a viewable secret". Every reveal attempt writes a
   * LogCategory.AUTH audit entry.
   */
  @Post(':endpointId/credentials/:credentialId/reveal')
  @HttpCode(200)
  async revealCredential(
    @Param('endpointId') endpointId: string,
    @Param('credentialId') credentialId: string,
  ): Promise<Record<string, unknown>> {
    const endpoint = await this.requireEndpoint(endpointId);
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;

    const credential = await this.credentialRepo.findById(credentialId);
    if (!credential || credential.endpointId !== endpointId) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }

    const clientId =
      credential.credentialType === 'oauth_client' && typeof credential.metadata?.clientId === 'string'
        ? { clientId: credential.metadata.clientId }
        : {};

    const effective = await this.credentialSecurity.getEffectiveVisibility(config);
    const base = {
      id: credential.id,
      credentialType: credential.credentialType,
      ...clientId,
    };

    // Not retained: setting is once, pre-feature (no envelope), or encryption is down.
    if (effective !== 'always' || !credential.secretEnvelope) {
      this.logger.info(
        LogCategory.AUTH,
        `Reveal DENIED for credential "${credentialId}" (endpoint "${endpointId}"): not retained ` +
          `(effective=${effective}, hasEnvelope=${credential.secretEnvelope ? 'yes' : 'no'})`,
      );
      const reason =
        effective !== 'always'
          ? `CredentialSecretVisibility is "${effective}" for this endpoint - rotate the credential to obtain a viewable secret.`
          : 'This credential predates secret retention (no encrypted copy was kept) - rotate the credential to obtain a viewable secret.';
      return { ...base, retained: false, reason };
    }

    try {
      const secret = this.credentialEncryption.decrypt(credential.secretEnvelope);
      // Audit every successful reveal (no secret in the log line).
      this.logger.warn(
        LogCategory.AUTH,
        `Reveal GRANTED for credential "${credentialId}" (endpoint "${endpointId}", type "${credential.credentialType}")`,
      );
      const secretField =
        credential.credentialType === 'oauth_client' ? 'clientSecret' : 'token';
      return { ...base, [secretField]: secret, retained: true };
    } catch (err) {
      // Envelope present but undecryptable (KEK changed / DEK unavailable).
      this.logger.error(
        LogCategory.AUTH,
        `Reveal FAILED for credential "${credentialId}" (endpoint "${endpointId}"): ${(err as Error).message}`,
      );
      return {
        ...base,
        retained: false,
        reason:
          'The retained secret could not be decrypted (the credential KEK may have changed) - rotate the credential to obtain a viewable secret.',
      };
    }
  }

  /**
   * POST /admin/endpoints/:endpointId/credentials/:credentialId/rotate  (WI-9)
   *
   * Rotate a `bearer` or `oauth_client` credential: mint a NEW secret (shown
   * once here, retained encrypted if the effective CredentialSecretVisibility
   * is `always`), then deactivate the OLD credential. The new credential keeps
   * the same type + label; an `oauth_client` keeps its public client_id so the
   * IdP only needs to update the secret. This is the lost-secret recovery path:
   * when a secret was shown once and forgotten (or the endpoint is `once`), the
   * operator rotates to obtain a fresh viewable secret without reconfiguring
   * the client_id. `wif` credentials have no secret and cannot be rotated.
   */
  @Post(':endpointId/credentials/:credentialId/rotate')
  @HttpCode(201)
  async rotateCredential(
    @Param('endpointId') endpointId: string,
    @Param('credentialId') credentialId: string,
  ): Promise<Record<string, unknown>> {
    const endpoint = await this.requireEndpoint(endpointId);
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;

    const old = await this.credentialRepo.findById(credentialId);
    if (!old || old.endpointId !== endpointId) {
      throw new NotFoundException(`Credential "${credentialId}" not found for endpoint "${endpointId}".`);
    }
    if (old.credentialType === 'wif') {
      throw new BadRequestException('A "wif" credential has no secret to rotate.');
    }

    // Mint a fresh secret + bcrypt hash.
    const plaintext = crypto.randomBytes(32).toString('base64url');
    const hash = await bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);
    const secretEnvelope = await this.maybeRetainSecret(config, plaintext);

    // oauth_client keeps its public client_id so only the secret changes.
    const isOauth = old.credentialType === 'oauth_client';
    const clientId = isOauth && typeof old.metadata?.clientId === 'string' ? old.metadata.clientId : null;

    const created = await this.credentialRepo.create({
      endpointId,
      credentialType: old.credentialType,
      credentialHash: hash,
      label: old.label ?? null,
      metadata: clientId ? { clientId } : old.metadata ?? null,
      secretEnvelope,
      expiresAt: old.expiresAt,
    });

    // Deactivate the old credential AFTER the new one is persisted.
    await this.credentialRepo.deactivate(credentialId);

    this.logger.info(
      LogCategory.AUTH,
      `Rotated credential "${credentialId}" -> "${created.id}" for endpoint "${endpointId}" (type "${old.credentialType}")`,
    );
    // Emit a create + a revoke so cross-tab consumers refresh both.
    this.eventEmitter.emit(SCIM_EVENTS.CREDENTIAL_CREATED, {
      endpointId,
      credentialId: created.id,
      credentialType: created.credentialType,
      label: created.label ?? undefined,
    } as ScimCredentialEventPayload);
    this.eventEmitter.emit(SCIM_EVENTS.CREDENTIAL_REVOKED, {
      endpointId,
      credentialId,
      credentialType: old.credentialType,
      label: old.label ?? undefined,
    } as ScimCredentialEventPayload);

    const secretField = isOauth ? 'clientSecret' : 'token';
    return {
      id: created.id,
      endpointId: created.endpointId,
      credentialType: created.credentialType,
      label: created.label,
      active: created.active,
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
      rotatedFrom: credentialId,
      ...(clientId ? { clientId } : {}),
      // Secret is returned ONLY here, ONCE.
      [secretField]: plaintext,
    };
  }

  /**
   * U8 - when the caller did not supply `allowedTenantId`, try to glean it from
   * the trust's issuer or JWKS URI (Entra embeds the directory tenant GUID in
   * both). On success the gleaned value + its source marker are written onto the
   * trust so the stored metadata records both and the UI can show the source; on
   * failure the trust is left unchanged and the normal required-field validation
   * will reject a still-missing tenant, so a non-inferable issuer still requires
   * the operator to supply `allowedTenantId` explicitly. Pure + no network.
   */
  private applyTenantGleaning(trust: Record<string, unknown>): void {
    const existing = trust.allowedTenantId;
    if (typeof existing === 'string' && existing.trim().length > 0) return;
    const issuer = typeof trust.expectedIssuer === 'string' ? trust.expectedIssuer : undefined;
    const jwksUri = typeof trust.jwksUri === 'string' ? trust.jwksUri : undefined;
    const inferred = inferAllowedTenantId(issuer, jwksUri);
    if (inferred) {
      trust.allowedTenantId = inferred.tenantId;
      trust.allowedTenantIdSource = inferred.source;
    }
  }

  /**
   * Item C: when `verify` is true, run the server-side reachability + liveness
   * verification (issuer OIDC discovery + JWKS serves a non-empty key set) and
   * throw 422 with the failed checks if it does not pass, so a trust that would
   * fail at runtime is never persisted. A no-op when `verify` is falsy (which
   * preserves the ability to pre-stage a trust before its IdP is fully live).
   */
  private async verifyTrustOrThrow(
    verify: boolean | undefined,
    trust: Record<string, unknown>,
  ): Promise<void> {
    if (!verify) return;
    const result = await this.wifResolver.verifyTrust({
      expectedIssuer: typeof trust.expectedIssuer === 'string' ? trust.expectedIssuer : undefined,
      jwksUri: typeof trust.jwksUri === 'string' ? trust.jwksUri : undefined,
    });
    if (!result.ok) {
      const failed = result.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
      throw new UnprocessableEntityException({
        message: `WIF trust verification failed: ${failed.join('; ')}`,
        scimType: 'invalidValue',
        checks: result.checks,
      });
    }
  }

  /**
   * Create a `wif` credential (A1). The trust config is ALL public values -
   * NO secret material. It rides EndpointCredential.metadata with an empty
   * credentialHash; the response carries no secret/hash/token field.
   */
  private async createWifCredential(endpointId: string, dto: CreateCredentialDto): Promise<CreateCredentialResponse> {
    const rawTrust = dto.wif;
    if (!rawTrust || typeof rawTrust !== 'object') {
      throw new BadRequestException('A "wif" credential requires a "wif" trust object.');
    }
    // WI-13 - normalize claim-name aliases (iss/sub/aud/tid/roles/expectedTenantId)
    // onto their canonical keys BEFORE validation, so a pasted decoded-token
    // shape is accepted. A canonical key set explicitly always wins.
    const trust = normalizeWifTrustAliases(rawTrust as unknown as Record<string, unknown>);
    this.applyTenantGleaning(trust);
    for (const required of ['expectedIssuer', 'expectedSubject', 'expectedAudience', 'jwksUri', 'allowedTenantId'] as const) {
      if (!trust[required] || typeof trust[required] !== 'string') {
        throw new BadRequestException(`WIF trust is missing required field "${required}".`);
      }
    }

    // Item C: opt-in reachability + liveness gate BEFORE persisting.
    await this.verifyTrustOrThrow(dto.verify, trust);

    // Project to the known public keys only - any secret-looking key the caller
    // sent is dropped (defense in depth; the type already forbids them).
    const metadata: Record<string, unknown> = {};
    for (const key of WIF_TRUST_KEYS) {
      if (trust[key] !== undefined) metadata[key] = trust[key];
    }
    metadata.assertionProfile = trust.assertionProfile ?? 'jwt-bearer';

    // U7: stamp the last-verified time when this create passed verify-on-save.
    if (dto.verify) metadata.lastVerifiedAt = new Date().toISOString();

    // X3 - operator notes for the trust, stored as plain metadata.description.
    const wifDescription = normalizeCredentialDescription(dto.description);
    if (wifDescription != null) metadata.description = wifDescription;

    const credential = await this.credentialRepo.create({
      endpointId,
      credentialType: 'wif',
      credentialHash: '', // WIF stores NO secret
      label: dto.label ?? null,
      metadata,
    });

    this.logger.info(LogCategory.AUTH, `Created wif credential "${credential.id}" for endpoint "${endpointId}"`);

    const wifEventPayload: ScimCredentialEventPayload = {
      endpointId,
      credentialId: credential.id,
      credentialType: credential.credentialType,
      label: credential.label ?? undefined,
    };
    this.eventEmitter.emit(SCIM_EVENTS.CREDENTIAL_CREATED, wifEventPayload);

    return {
      id: credential.id,
      endpointId: credential.endpointId,
      credentialType: credential.credentialType,
      label: credential.label,
      active: credential.active,
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
      // The full public trust config is echoed back (no secret exists).
      wif: metadata,
      description: wifDescription,
    };
  }

  private async requireEndpoint(endpointId: string) {
    return this.endpointService.getEndpoint(endpointId);
  }

  /**
   * WI-7: when the effective CredentialSecretVisibility for the endpoint is
   * `always`, encrypt the plaintext secret for retention and return the
   * envelope; otherwise return null (show-once). Never throws into the create
   * path - if encryption is unavailable (KEK init failed) it logs and returns
   * null so credential creation still succeeds (the secret is simply not
   * retained, i.e. degrades to show-once).
   */
  private async maybeRetainSecret(
    config: EndpointConfig,
    plaintext: string,
  ): Promise<string | null> {
    try {
      const effective = await this.credentialSecurity.getEffectiveVisibility(config);
      if (effective !== 'always') return null;
      if (!this.credentialEncryption.isReady()) return null;
      return this.credentialEncryption.encrypt(plaintext);
    } catch (err) {
      this.logger.warn(
        LogCategory.AUTH,
        `Could not retain credential secret (degrading to show-once): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
