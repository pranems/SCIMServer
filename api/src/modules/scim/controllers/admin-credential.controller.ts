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
  Post,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { getConfigBoolean, ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import {
  SCIM_EVENTS,
  type ScimCredentialEventPayload,
} from '../../stats/scim-events';

const BCRYPT_SALT_ROUNDS = 12;

interface CreateCredentialDto {
  label?: string;
  credentialType?: string; // "bearer" (default) | "oauth_client" | "wif"
  expiresAt?: string;      // ISO 8601 date
  wif?: WifTrustInput;     // required when credentialType === "wif"
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
  requiredRoles?: string[];
  scope?: string;
  issuedTokenTtlSec?: number;
}

/** Keys allowed on a WIF trust metadata object (no secret-bearing keys). */
const WIF_TRUST_KEYS: ReadonlyArray<keyof WifTrustInput> = [
  'assertionProfile', 'subjectTokenType', 'expectedResource', 'expectedIssuer',
  'expectedSubject', 'expectedAudience', 'jwksUri', 'allowedTenantId',
  'requiredRoles', 'scope', 'issuedTokenTtlSec',
];

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
  active: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  wif?: Record<string, unknown>;
}

@Controller('admin/endpoints')
export class AdminCredentialController {

  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly endpointService: EndpointService,
    private readonly logger: ScimLogger,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * POST /admin/endpoints/:endpointId/credentials
   *
   * Generate a new per-endpoint credential. Returns the plaintext token
   * exactly ONCE in the response; only the bcrypt hash is stored.
   */
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
    // (WifCredentialsEnabled), independent of the bcrypt-bearer gate
    // (PerEndpointCredentialsEnabled). bearer/oauth_client keep the existing
    // PerEndpointCredentialsEnabled requirement.
    if (credentialType === 'wif') {
      if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED)) {
        throw new ForbiddenException(
          `WIF credentials are not enabled for endpoint "${endpointId}". ` +
          `Set "${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
        );
      }
      return this.createWifCredential(endpointId, dto);
    }

    // Validate that per-endpoint credentials are enabled
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED)) {
      throw new ForbiddenException(
        `Per-endpoint credentials are not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
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
      const clientId = `epc_${crypto.randomBytes(12).toString('hex')}`;
      const credential = await this.credentialRepo.create({
        endpointId,
        credentialType,
        credentialHash: hash,
        label: dto.label ?? null,
        metadata: { clientId },
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
        active: credential.active,
        createdAt: credential.createdAt,
        expiresAt: credential.expiresAt,
        clientId,
        // ⚠️ Secret is returned ONLY here, ONCE. Only its bcrypt hash is stored.
        clientSecret: plaintext,
      };
    }

    const credential = await this.credentialRepo.create({
      endpointId,
      credentialType,
      credentialHash: hash,
      label: dto.label ?? null,
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
   * Create a `wif` credential (A1). The trust config is ALL public values -
   * NO secret material. It rides EndpointCredential.metadata with an empty
   * credentialHash; the response carries no secret/hash/token field.
   */
  private async createWifCredential(endpointId: string, dto: CreateCredentialDto): Promise<CreateCredentialResponse> {
    const trust = dto.wif;
    if (!trust || typeof trust !== 'object') {
      throw new BadRequestException('A "wif" credential requires a "wif" trust object.');
    }
    for (const required of ['expectedIssuer', 'expectedSubject', 'expectedAudience', 'jwksUri', 'allowedTenantId'] as const) {
      if (!trust[required] || typeof trust[required] !== 'string') {
        throw new BadRequestException(`WIF trust is missing required field "${required}".`);
      }
    }

    // Project to the known public keys only - any secret-looking key the caller
    // sent is dropped (defense in depth; the type already forbids them).
    const metadata: Record<string, unknown> = {};
    for (const key of WIF_TRUST_KEYS) {
      if (trust[key] !== undefined) metadata[key] = trust[key];
    }
    metadata.assertionProfile = trust.assertionProfile ?? 'jwt-bearer';

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
    };
  }

  private async requireEndpoint(endpointId: string) {
    return this.endpointService.getEndpoint(endpointId);
  }
}
