import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import type { UserRecord, UserCreateInput, UserUpdateInput } from '../../../domain/models/user.model';
import { USER_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { createScimError } from '../common/scim-errors';
import { assertIfMatch } from '../interceptors/scim-etag.interceptor';
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  SCIM_CORE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_SCHEMA,
} from '../common/scim-constants';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimListResponse, ScimUserResource } from '../common/scim-types';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';
import { ScimMetadataService } from './scim-metadata.service';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ENDPOINT_CONFIG_FLAGS, getConfigBoolean } from '../../endpoint/endpoint-config.interface';
import { buildUserFilter } from '../filters/apply-scim-filter';
import { UserPatchEngine } from '../../../domain/patch/user-patch-engine';
import { PatchError } from '../../../domain/patch/patch-error';
import { SchemaValidator } from '../../../domain/validation';
import type { SchemaDefinition } from '../../../domain/validation';

interface ListUsersParams {
  filter?: string;
  startIndex?: number;
  count?: number;
}

/**
 * Endpoint-specific SCIM Users Service
 * Handles all user operations scoped to a specific endpoint
 */
@Injectable()
export class EndpointScimUsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly metadata: ScimMetadataService,
    private readonly logger: ScimLogger,
    private readonly schemaRegistry: ScimSchemaRegistry,
  ) {}

  async createUserForEndpoint(dto: CreateUserDto, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimUserResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);
    this.enforceStrictSchemaValidation(dto, endpointId, config);
    this.validatePayloadSchema(dto, endpointId, config, 'create');

    this.logger.info(LogCategory.SCIM_USER, 'Creating user', { userName: dto.userName, endpointId });
    this.logger.trace(LogCategory.SCIM_USER, 'Create user payload', { body: dto as unknown as Record<string, unknown> });

    await this.assertUniqueIdentifiersForEndpoint(dto.userName, dto.externalId ?? undefined, endpointId);

    const now = new Date();
    const scimId = randomUUID();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const input: UserCreateInput = {
      endpointId,
      scimId,
      externalId: dto.externalId ?? null,
      userName: dto.userName,
      displayName: typeof dto.displayName === 'string' ? dto.displayName : null,
      active: dto.active ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'User',
        created: now.toISOString(),
        lastModified: now.toISOString()
      }),
    };

    const created = await this.userRepo.create(input);

    this.logger.info(LogCategory.SCIM_USER, 'User created', { scimId, userName: dto.userName, endpointId });
    return this.toScimUserResource(created, baseUrl, endpointId);
  }

  async getUserForEndpoint(scimId: string, baseUrl: string, endpointId: string): Promise<ScimUserResource> {
    this.logger.debug(LogCategory.SCIM_USER, 'Get user', { scimId, endpointId });
    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'User not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    return this.toScimUserResource(user, baseUrl, endpointId);
  }

  async listUsersForEndpoint(
    { filter, startIndex = 1, count = DEFAULT_COUNT }: ListUsersParams,
    baseUrl: string,
    endpointId: string
  ): Promise<ScimListResponse<ScimUserResource>> {
    if (count > MAX_COUNT) {
      count = MAX_COUNT;
    }

    this.logger.info(LogCategory.SCIM_USER, 'List users', { filter, startIndex, count, endpointId });

    let filterResult;
    try {
      filterResult = buildUserFilter(filter);
    } catch {
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: `Unsupported or invalid filter expression: '${filter}'.`
      });
    }

    // Fetch users from DB (repository handles endpointId scoping)
    const allDbUsers = await this.userRepo.findAll(
      endpointId,
      filterResult.dbWhere,
      { field: 'createdAt', direction: 'asc' },
    );

    // Build SCIM resources and apply in-memory filter if needed
    let resources = allDbUsers.map((user) => this.toScimUserResource(user, baseUrl, endpointId));
    if (filterResult.inMemoryFilter) {
      resources = resources.filter(filterResult.inMemoryFilter);
    }

    const totalResults = resources.length;
    const skip = Math.max(startIndex - 1, 0);
    const take = Math.max(Math.min(count, MAX_COUNT), 0);
    const paginatedResources = resources.slice(skip, skip + take);

    this.logger.debug(LogCategory.SCIM_USER, 'List users result', { totalResults, returned: paginatedResources.length, endpointId });

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: paginatedResources.length,
      Resources: paginatedResources
    };
  }

  async patchUserForEndpoint(
    scimId: string,
    patchDto: PatchUserDto,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<ScimUserResource> {
    this.ensureSchema(patchDto.schemas, SCIM_PATCH_SCHEMA);

    this.logger.info(LogCategory.SCIM_PATCH, 'Patch user', { scimId, endpointId, opCount: patchDto.Operations?.length });
    this.logger.debug(LogCategory.SCIM_PATCH, 'Patch operations', {
      operations: patchDto.Operations?.map(o => ({ op: o.op, path: o.path })),
    });
    this.logger.trace(LogCategory.SCIM_PATCH, 'Patch user full payload', { body: patchDto as unknown as Record<string, unknown> });

    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(user.version, ifMatch, config);

    const updatedData = await this.applyPatchOperationsForEndpoint(user, patchDto, endpointId, config);

    const updatedUser = await this.userRepo.update(user.id, updatedData);

    this.logger.info(LogCategory.SCIM_PATCH, 'User patched', { scimId, endpointId });
    return this.toScimUserResource(updatedUser, baseUrl, endpointId);
  }

  async replaceUserForEndpoint(
    scimId: string,
    dto: CreateUserDto,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<ScimUserResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);
    this.enforceStrictSchemaValidation(dto, endpointId, config);
    this.validatePayloadSchema(dto, endpointId, config, 'replace');

    this.logger.info(LogCategory.SCIM_USER, 'Replace user (PUT)', { scimId, userName: dto.userName, endpointId });

    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(user.version, ifMatch, config);

    // H-2: Immutable attribute enforcement — compare existing resource with incoming payload
    this.checkImmutableAttributes(user, dto, endpointId, config);

    await this.assertUniqueIdentifiersForEndpoint(dto.userName, dto.externalId ?? undefined, endpointId, scimId);

    const now = new Date();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);
    const meta = this.parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    const data: UserUpdateInput = {
      externalId: dto.externalId ?? null,
      userName: dto.userName,
      displayName: typeof dto.displayName === 'string' ? dto.displayName : null,
      active: dto.active ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        ...meta,
        lastModified: now.toISOString()
      })
    };

    const updatedUser = await this.userRepo.update(user.id, data);

    return this.toScimUserResource(updatedUser, baseUrl, endpointId);
  }

  async deleteUserForEndpoint(scimId: string, endpointId: string, config?: EndpointConfig, ifMatch?: string): Promise<void> {
    this.logger.info(LogCategory.SCIM_USER, 'Delete user', { scimId, endpointId });
    const user = await this.userRepo.findByScimId(endpointId, scimId);

    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'Delete target not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(user.version, ifMatch, config);

    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);

    if (softDelete) {
      this.logger.info(LogCategory.SCIM_USER, 'Soft-deleting user (setting active=false)', { scimId, endpointId });
      await this.userRepo.update(user.id, { active: false });
      this.logger.info(LogCategory.SCIM_USER, 'User soft-deleted', { scimId, endpointId });
    } else {
      await this.userRepo.delete(user.id);
      this.logger.info(LogCategory.SCIM_USER, 'User hard-deleted', { scimId, endpointId });
    }
  }

  // ===== Private Helper Methods =====

  /**
   * Phase 7: Pre-write If-Match enforcement (RFC 7644 §3.14).
   *
   * When the client sends an If-Match header, the resource's current version-based
   * ETag must match — otherwise 412 Precondition Failed is thrown BEFORE the write.
   * When RequireIfMatch is enabled, a missing If-Match header → 428 Precondition Required.
   */
  private enforceIfMatch(currentVersion: number, ifMatch?: string, config?: EndpointConfig): void {
    const requireIfMatch = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH);

    if (!ifMatch) {
      if (requireIfMatch) {
        throw createScimError({
          status: 428,
          detail: 'If-Match header is required for this operation. Include the resource ETag (e.g., If-Match: W/"v1").',
        });
      }
      return; // If-Match not provided and not required → allow
    }

    const currentETag = `W/"v${currentVersion}"`;
    assertIfMatch(currentETag, ifMatch);
  }

  private ensureSchema(schemas: string[] | undefined, requiredSchema: string): void {
    const requiredLower = requiredSchema.toLowerCase();
    if (!schemas || !schemas.some(s => s.toLowerCase() === requiredLower)) {
      throw createScimError({
        status: 400,
        scimType: 'invalidSyntax',
        detail: `Missing required schema '${requiredSchema}'.`
      });
    }
  }

  /**
   * Strict Schema Validation — when StrictSchemaValidation is enabled, reject
   * any request body that contains extension URN keys not listed in the
   * request's `schemas[]` array or not registered in the schema registry.
   *
   * RFC 7643 §3.1: "The 'schemas' attribute is a REQUIRED attribute and is an
   * array of Strings containing URIs that are used to indicate the namespaces
   * of the SCIM schemas."
   */
  private enforceStrictSchemaValidation(
    dto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    const declaredLower = new Set(declaredSchemas.map(s => s.toLowerCase()));
    const registeredUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    const registeredLower = new Set(registeredUrns.map(u => u.toLowerCase()));

    // Find any top-level key that looks like an extension URN
    for (const key of Object.keys(dto)) {
      if (key.startsWith('urn:')) {
        const keyLower = key.toLowerCase();
        // Must be both declared in schemas[] AND registered in the registry
        if (!declaredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidSyntax',
            detail: `Extension URN "${key}" found in request body but not declared in schemas[]. ` +
              `When StrictSchemaValidation is enabled, all extension URNs must be listed in the schemas array.`,
          });
        }
        if (!registeredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidValue',
            detail: `Extension URN "${key}" is not a registered extension schema for this endpoint. ` +
              `Registered extensions: [${registeredUrns.join(', ')}].`,
          });
        }
      }
    }
  }

  /**
   * Phase 8: Attribute-level payload validation against schema definitions.
   *
   * When StrictSchemaValidation is enabled, validates:
   *  - Required attributes are present (create/replace only)
   *  - Attribute types match schema definitions
   *  - Mutability constraints (readOnly rejection)
   *  - Unknown attributes in strict mode
   *  - Multi-valued / single-valued enforcement
   *  - Sub-attribute validation for complex types
   *
   * @see RFC 7643 §2.1 — Attribute Characteristics
   */
  private validatePayloadSchema(
    dto: Record<string, unknown>,
    endpointId: string,
    config: EndpointConfig | undefined,
    mode: 'create' | 'replace' | 'patch',
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const schemas = this.buildSchemaDefinitions(dto, endpointId);
    if (schemas.length === 0) return;

    const result = SchemaValidator.validate(dto, schemas, {
      strictMode: true,
      mode,
    });

    if (!result.valid) {
      const details = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: result.errors[0]?.scimType ?? 'invalidValue',
        detail: `Schema validation failed: ${details}`,
      });
    }
  }

  /**
   * H-2: Immutable attribute enforcement (RFC 7643 §2.2).
   *
   * Compares the existing resource state (from DB) with the incoming payload
   * and rejects changes to attributes declared as immutable.
   * Only runs when StrictSchemaValidation is enabled.
   */
  private checkImmutableAttributes(
    existingRecord: UserRecord,
    incomingDto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const schemas = this.buildSchemaDefinitions(incomingDto, endpointId);
    if (schemas.length === 0) return;

    // Reconstruct existing resource as a SCIM payload for comparison
    const existingPayload = this.buildExistingPayload(existingRecord);

    const result = SchemaValidator.checkImmutable(existingPayload, incomingDto, schemas);

    if (!result.valid) {
      const details = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: 'mutability',
        detail: `Immutable attribute violation: ${details}`,
      });
    }
  }

  /**
   * Build schema definitions from the registry for a given payload.
   * Shared by validatePayloadSchema and checkImmutableAttributes.
   */
  private buildSchemaDefinitions(
    dto: Record<string, unknown>,
    endpointId: string,
  ): SchemaDefinition[] {
    const coreSchema = this.schemaRegistry.getSchema(SCIM_CORE_USER_SCHEMA, endpointId);
    const schemas: SchemaDefinition[] = [];
    if (coreSchema) {
      schemas.push(coreSchema as SchemaDefinition);
    }

    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    for (const urn of declaredSchemas) {
      if (urn !== SCIM_CORE_USER_SCHEMA) {
        const extSchema = this.schemaRegistry.getSchema(urn, endpointId);
        if (extSchema) {
          schemas.push(extSchema as SchemaDefinition);
        }
      }
    }

    return schemas;
  }

  /**
   * Reconstruct the existing DB record as a SCIM payload object (data only, no meta/location).
   * Used for immutable attribute comparison.
   */
  private buildExistingPayload(record: UserRecord): Record<string, unknown> {
    const rawPayload = this.parseJson<Record<string, unknown>>(String(record.rawPayload ?? '{}'));
    return {
      ...rawPayload,
      userName: record.userName,
      externalId: record.externalId ?? undefined,
      active: record.active,
      displayName: record.displayName ?? undefined,
    };
  }

  private async assertUniqueIdentifiersForEndpoint(
    userName: string,
    externalId: string | undefined,
    endpointId: string,
    excludeScimId?: string
  ): Promise<void> {
    const conflict = await this.userRepo.findConflict(
      endpointId,
      userName,
      externalId,
      excludeScimId,
    );

    if (conflict) {
      const reason =
        conflict.userName.toLowerCase() === userName.toLowerCase()
          ? `userName '${userName}'`
          : `externalId '${externalId}'`;

      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A resource with ${reason} already exists.`
      });
    }
  }

  private async applyPatchOperationsForEndpoint(
    user: UserRecord,
    patchDto: PatchUserDto,
    endpointId: string,
    config?: EndpointConfig
  ): Promise<UserUpdateInput> {
    const verbosePatch = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED);
    const extensionUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    const rawPayload = this.parseJson<Record<string, unknown>>(String(user.rawPayload ?? '{}'));
    const meta = this.parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    let result;
    try {
      result = UserPatchEngine.apply(
        patchDto.Operations,
        {
          userName: user.userName,
          displayName: user.displayName ?? null,
          externalId: user.externalId ?? null,
          active: user.active,
          rawPayload,
        },
        { verbosePatch, extensionUrns },
      );
    } catch (err) {
      if (err instanceof PatchError) {
        throw createScimError({ status: err.status, scimType: err.scimType, detail: err.message });
      }
      throw err;
    }

    const { extractedFields, payload } = result;

    // H-1: Post-PATCH schema validation — validate the resulting payload
    const resultPayload: Record<string, unknown> = {
      schemas: [SCIM_CORE_USER_SCHEMA],
      userName: extractedFields.userName ?? user.userName,
      displayName: extractedFields.displayName,
      active: extractedFields.active,
      ...payload,
    };
    // Include extension URNs in schemas[] for proper validation
    for (const urn of extensionUrns) {
      if (urn in payload) {
        (resultPayload.schemas as string[]).push(urn);
      }
    }
    this.validatePayloadSchema(resultPayload, endpointId, config, 'patch');

    // H-2: Immutable attribute enforcement — compare existing state with PATCH result
    this.checkImmutableAttributes(user, resultPayload, endpointId, config);

    await this.assertUniqueIdentifiersForEndpoint(
      extractedFields.userName ?? user.userName,
      extractedFields.externalId ?? undefined,
      endpointId,
      user.scimId,
    );

    return {
      userName: extractedFields.userName,
      displayName: extractedFields.displayName,
      externalId: extractedFields.externalId,
      active: extractedFields.active,
      rawPayload: JSON.stringify(payload),
      meta: JSON.stringify({
        ...meta,
        lastModified: new Date().toISOString()
      })
    } satisfies UserUpdateInput;
  }

  private toScimUserResource(user: UserRecord, baseUrl: string, endpointId?: string): ScimUserResource {
    const meta = this.buildMeta(user, baseUrl);
    const rawPayload = this.parseJson<Record<string, unknown>>(String(user.rawPayload ?? '{}'));

    // Sanitize boolean-like strings in multi-valued attributes (Microsoft Entra sends "True"/"False")
    this.sanitizeBooleanStrings(rawPayload);

    // Build schemas[] dynamically — include extension URNs present in payload (G19 fix)
    const extensionUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    const schemas: [string, ...string[]] = [SCIM_CORE_USER_SCHEMA];
    for (const urn of extensionUrns) {
      if (urn in rawPayload) {
        schemas.push(urn);
      }
    }

    // Remove reserved server-assigned attributes from rawPayload to prevent overwriting
    // (e.g., a client-supplied "id" in the POST body must never override scimId)
    delete rawPayload.id;

    return {
      schemas,
      ...rawPayload,
      id: user.scimId,
      userName: user.userName,
      externalId: user.externalId ?? undefined,
      active: user.active,
      meta
    };
  }

  /**
   * Recursively sanitize boolean-like string values ("True"/"False") to actual booleans.
   * Microsoft Entra ID sends primary as string "True" but the SCIM validator expects boolean true.
   */
  private sanitizeBooleanStrings(obj: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            this.sanitizeBooleanStrings(item as Record<string, unknown>);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        this.sanitizeBooleanStrings(value as Record<string, unknown>);
      } else if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true') obj[key] = true;
        else if (lower === 'false') obj[key] = false;
      }
    }
  }

  private buildMeta(user: UserRecord, baseUrl: string) {
    const createdAt = user.createdAt.toISOString();
    const lastModified = user.updatedAt.toISOString();
    const location = this.metadata.buildLocation(baseUrl, 'Users', String(user.scimId));

    return {
      resourceType: 'User',
      created: createdAt,
      lastModified,
      location,
      version: `W/"v${user.version}"`
    };
  }

  private extractAdditionalAttributes(dto: CreateUserDto): Record<string, unknown> {
    const { schemas, ...rest } = dto;
    const additional = { ...rest } as Record<string, unknown>;
    delete additional.userName;
    delete additional.externalId;
    delete additional.active;
    delete additional.id;  // RFC 7643 §3.1: id is assigned by the service provider — ignore client-supplied values

    return {
      schemas,
      ...additional
    };
  }

  private parseJson<T>(value: string | null | undefined): T {
    if (!value) {
      return {} as T;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }
}
