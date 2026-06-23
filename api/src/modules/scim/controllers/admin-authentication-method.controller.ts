import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { expandAuthentication, CURRENT_AUTH_SCHEMA_VERSION } from '../endpoint-profile/auto-expand.service';
import type {
  AuthenticationMethod,
  ProfileAuthentication,
} from '../endpoint-profile/endpoint-profile.types';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';

/**
 * Registry of known authentication-method `type` values (architecture section
 * 1.3). A method's `type` must be one of these. `id` is server-assigned.
 */
const KNOWN_METHOD_TYPES = new Set([
  'shared-secret',
  'bearer',
  'oauth-client',
  'external-jwt',
  'wif-7523',
  'wif-8693',
  'oauth-authcode',
  'mtls',
  'dpop',
  'httpbasic',
]);

interface CreateMethodDto {
  type?: string;
  displayName?: string;
  description?: string;
  specUri?: string;
  plane?: 'token' | 'resource' | 'both';
  tokenEndpointAuthMethod?: string;
  enabled?: boolean;
  priority?: number;
  lifecycleStatus?: 'active' | 'deprecated' | 'disabled';
  config?: Record<string, unknown>;
  credentialRef?: string;
}

/**
 * AdminAuthenticationMethodController (A1) - CRUD over an endpoint's
 * `profile.authentication.methods[]`.
 *
 * Routes:
 *   GET    /admin/endpoints/:endpointId/authentication/methods
 *   POST   /admin/endpoints/:endpointId/authentication/methods
 *   DELETE /admin/endpoints/:endpointId/authentication/methods/:methodId
 *
 * Persistence rides the endpoint profile (A0 model) via `updateEndpoint`, so
 * both backends behave identically. Secret-looking config keys are stripped on
 * save by `expandAuthentication` (the A0 no-secret invariant).
 */
@Controller('admin/endpoints/:endpointId/authentication/methods')
export class AdminAuthenticationMethodController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly logger: ScimLogger,
  ) {}

  @Get()
  async list(@Param('endpointId') endpointId: string): Promise<{ methods: AuthenticationMethod[] }> {
    const auth = await this.loadAuthentication(endpointId);
    return { methods: auth.methods };
  }

  @Post()
  @HttpCode(201)
  async add(
    @Param('endpointId') endpointId: string,
    @Body() dto: CreateMethodDto,
  ): Promise<AuthenticationMethod> {
    if (!dto.type || typeof dto.type !== 'string' || !KNOWN_METHOD_TYPES.has(dto.type)) {
      throw new BadRequestException(
        `Invalid authentication method type "${dto.type ?? ''}". ` +
        `Allowed: ${Array.from(KNOWN_METHOD_TYPES).join(', ')}.`,
      );
    }

    const current = await this.loadAuthentication(endpointId);
    const method: AuthenticationMethod = { id: `m-${randomUUID().slice(0, 8)}`, type: dto.type };
    if (dto.displayName !== undefined) method.displayName = dto.displayName;
    if (dto.description !== undefined) method.description = dto.description;
    if (dto.specUri !== undefined) method.specUri = dto.specUri;
    if (dto.plane !== undefined) method.plane = dto.plane;
    if (dto.tokenEndpointAuthMethod !== undefined) method.tokenEndpointAuthMethod = dto.tokenEndpointAuthMethod;
    if (dto.enabled !== undefined) method.enabled = dto.enabled;
    if (dto.priority !== undefined) method.priority = dto.priority;
    if (dto.lifecycleStatus !== undefined) method.lifecycleStatus = dto.lifecycleStatus;
    if (dto.config !== undefined) method.config = dto.config;
    if (dto.credentialRef !== undefined) method.credentialRef = dto.credentialRef;

    const nextBlock: ProfileAuthentication = {
      schemaVersion: current.schemaVersion,
      methods: [...current.methods, method],
      ...(current.defaultMethodId ? { defaultMethodId: current.defaultMethodId } : {}),
      ...(current.policy ? { policy: current.policy } : {}),
    };

    // expandAuthentication strips secret-looking config keys (A0 invariant).
    const saved = await this.persist(endpointId, nextBlock);
    const savedMethod = saved.methods.find((m) => m.id === method.id);
    if (!savedMethod) {
      throw new BadRequestException('Failed to persist the authentication method.');
    }
    this.logger.info(LogCategory.AUTH, `Added authentication method "${savedMethod.id}" (${savedMethod.type}) to endpoint "${endpointId}"`);
    return savedMethod;
  }

  @Delete(':methodId')
  @HttpCode(204)
  async remove(
    @Param('endpointId') endpointId: string,
    @Param('methodId') methodId: string,
  ): Promise<void> {
    const current = await this.loadAuthentication(endpointId);
    if (!current.methods.some((m) => m.id === methodId)) {
      throw new NotFoundException(`Authentication method "${methodId}" not found for endpoint "${endpointId}".`);
    }
    const nextBlock: ProfileAuthentication = {
      schemaVersion: current.schemaVersion,
      methods: current.methods.filter((m) => m.id !== methodId),
      ...(current.defaultMethodId && current.defaultMethodId !== methodId
        ? { defaultMethodId: current.defaultMethodId }
        : {}),
      ...(current.policy ? { policy: current.policy } : {}),
    };
    await this.persist(endpointId, nextBlock);
    this.logger.info(LogCategory.AUTH, `Removed authentication method "${methodId}" from endpoint "${endpointId}"`);
  }

  /** Load the endpoint's authentication block, defaulting to an empty one. */
  private async loadAuthentication(endpointId: string): Promise<ProfileAuthentication> {
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    const existing = endpoint.profile?.authentication;
    if (existing) return expandAuthentication(existing);
    return { schemaVersion: CURRENT_AUTH_SCHEMA_VERSION, methods: [] };
  }

  /** Persist the authentication block via the endpoint profile update path. */
  private async persist(endpointId: string, block: ProfileAuthentication): Promise<ProfileAuthentication> {
    const updated = await this.endpointService.updateEndpoint(endpointId, {
      profile: { authentication: block },
    });
    return (
      updated.profile?.authentication ?? { schemaVersion: CURRENT_AUTH_SCHEMA_VERSION, methods: [] }
    );
  }
}
