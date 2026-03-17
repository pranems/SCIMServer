/**
 * AdminCredentialController — Admin API for managing per-endpoint SCIM credentials.
 *
 * Phase 11: Provides CRUD endpoints to create, list, and revoke per-endpoint
 * bearer tokens. Tokens are bcrypt-hashed before storage; the plaintext is
 * returned only once at creation time.
 *
 * Gated behind the `PerEndpointCredentialsEnabled` per-endpoint config flag.
 *
 * Routes:
 *   POST   /admin/endpoints/:endpointId/credentials              — Create new credential
 *   GET    /admin/endpoints/:endpointId/credentials              — List credentials (hash masked)
 *   DELETE /admin/endpoints/:endpointId/credentials/:credentialId — Revoke (deactivate) credential
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { getConfigBoolean, ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';

const BCRYPT_SALT_ROUNDS = 12;

interface CreateCredentialDto {
  label?: string;
  credentialType?: string; // "bearer" (default) | "oauth_client"
  expiresAt?: string;      // ISO 8601 date
}

@Controller('admin/endpoints')
export class AdminCredentialController {
  private readonly logger = new Logger(AdminCredentialController.name);

  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly endpointService: EndpointService,
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
  ) {
    const endpoint = await this.requireEndpoint(endpointId);

    // Validate that per-endpoint credentials are enabled
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED)) {
      throw new ForbiddenException(
        `Per-endpoint credentials are not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
      );
    }

    const credentialType = dto.credentialType ?? 'bearer';
    if (!['bearer', 'oauth_client'].includes(credentialType)) {
      throw new BadRequestException(
        `Invalid credentialType "${credentialType}". Allowed values: "bearer", "oauth_client".`,
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

    const credential = await this.credentialRepo.create({
      endpointId,
      credentialType,
      credentialHash: hash,
      label: dto.label ?? null,
      expiresAt,
    });

    this.logger.log(`Created per-endpoint credential "${credential.id}" for endpoint "${endpointId}"`);

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
    this.logger.log(`Revoked credential "${credentialId}" for endpoint "${endpointId}"`);
  }

  private async requireEndpoint(endpointId: string) {
    return this.endpointService.getEndpoint(endpointId);
  }
}
