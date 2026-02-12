import { Injectable } from '@nestjs/common';
import type { Prisma, ScimUser } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { createScimError } from '../common/scim-errors';
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  SCIM_CORE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_SCHEMA
} from '../common/scim-constants';
import type { ScimListResponse, ScimUserResource } from '../common/scim-types';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';
import { ScimMetadataService } from './scim-metadata.service';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ENDPOINT_CONFIG_FLAGS, getConfigBoolean } from '../../endpoint/endpoint-config.interface';
import {
  isValuePath,
  parseValuePath,
  applyValuePathUpdate,
  addValuePathEntry,
  removeValuePathEntry,
  isExtensionPath,
  parseExtensionPath,
  applyExtensionUpdate,
  removeExtensionAttribute,
  resolveNoPathValue,
} from '../utils/scim-patch-path';
import { buildUserFilter } from '../filters/apply-scim-filter';

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
    private readonly prisma: PrismaService,
    private readonly metadata: ScimMetadataService,
    private readonly logger: ScimLogger,
  ) {}

  async createUserForEndpoint(dto: CreateUserDto, baseUrl: string, endpointId: string): Promise<ScimUserResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);

    this.logger.info(LogCategory.SCIM_USER, 'Creating user', { userName: dto.userName, endpointId });
    this.logger.trace(LogCategory.SCIM_USER, 'Create user payload', { body: dto as unknown as Record<string, unknown> });

    await this.assertUniqueIdentifiersForEndpoint(dto.userName, dto.externalId ?? undefined, endpointId);

    const now = new Date();
    const scimId = randomUUID();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const data: Prisma.ScimUserCreateInput = {
      scimId,
      externalId: dto.externalId ?? null,
      userName: dto.userName,
      userNameLower: dto.userName.toLowerCase(),
      active: dto.active ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'User',
        created: now.toISOString(),
        lastModified: now.toISOString()
      }),
      endpoint: { connect: { id: endpointId } }
    };

    const created = await this.prisma.scimUser.create({ data });

    this.logger.info(LogCategory.SCIM_USER, 'User created', { scimId, userName: dto.userName, endpointId });
    return this.toScimUserResource(created, baseUrl);
  }

  async getUserForEndpoint(scimId: string, baseUrl: string, endpointId: string): Promise<ScimUserResource> {
    this.logger.debug(LogCategory.SCIM_USER, 'Get user', { scimId, endpointId });
    const user = await this.prisma.scimUser.findFirst({ 
      where: { 
        scimId,
        endpointId
      } 
    });
    
    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'User not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    return this.toScimUserResource(user, baseUrl);
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

    const where: Prisma.ScimUserWhereInput = {
      ...filterResult.dbWhere,
      endpointId
    };

    // Fetch users from DB
    const allDbUsers = await this.prisma.scimUser.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    });

    // Build SCIM resources and apply in-memory filter if needed
    let resources = allDbUsers.map((user) => this.toScimUserResource(user, baseUrl));
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
    config?: EndpointConfig
  ): Promise<ScimUserResource> {
    this.ensureSchema(patchDto.schemas, SCIM_PATCH_SCHEMA);

    this.logger.info(LogCategory.SCIM_PATCH, 'Patch user', { scimId, endpointId, opCount: patchDto.Operations?.length });
    this.logger.debug(LogCategory.SCIM_PATCH, 'Patch operations', {
      operations: patchDto.Operations?.map(o => ({ op: o.op, path: o.path })),
    });
    this.logger.trace(LogCategory.SCIM_PATCH, 'Patch user full payload', { body: patchDto as unknown as Record<string, unknown> });

    const user = await this.prisma.scimUser.findFirst({ 
      where: { 
        scimId,
        endpointId
      } 
    });
    
    if (!user) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    const updatedData = await this.applyPatchOperationsForEndpoint(user, patchDto, endpointId, config);

    const updatedUser = await this.prisma.scimUser.update({
      where: { id: user.id },
      data: updatedData
    });

    this.logger.info(LogCategory.SCIM_PATCH, 'User patched', { scimId, endpointId });
    return this.toScimUserResource(updatedUser, baseUrl);
  }

  async replaceUserForEndpoint(
    scimId: string,
    dto: CreateUserDto,
    baseUrl: string,
    endpointId: string
  ): Promise<ScimUserResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);

    this.logger.info(LogCategory.SCIM_USER, 'Replace user (PUT)', { scimId, userName: dto.userName, endpointId });

    const user = await this.prisma.scimUser.findFirst({ 
      where: { 
        scimId,
        endpointId
      } 
    });
    
    if (!user) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    await this.assertUniqueIdentifiersForEndpoint(dto.userName, dto.externalId ?? undefined, endpointId, scimId);

    const now = new Date();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);
    const meta = this.parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    const data: Prisma.ScimUserUpdateInput = {
      externalId: dto.externalId ?? null,
      userName: dto.userName,
      userNameLower: dto.userName.toLowerCase(),
      active: dto.active ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        ...meta,
        lastModified: now.toISOString()
      })
    };

    const updatedUser = await this.prisma.scimUser.update({
      where: { id: user.id },
      data
    });

    return this.toScimUserResource(updatedUser, baseUrl);
  }

  async deleteUserForEndpoint(scimId: string, endpointId: string): Promise<void> {
    this.logger.info(LogCategory.SCIM_USER, 'Delete user', { scimId, endpointId });
    const user = await this.prisma.scimUser.findFirst({
      where: {
        scimId,
        endpointId
      }
    });

    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'Delete target not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    await this.prisma.scimUser.delete({ where: { id: user.id } });
    this.logger.info(LogCategory.SCIM_USER, 'User deleted', { scimId, endpointId });
  }

  // ===== Private Helper Methods =====

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

  private async assertUniqueIdentifiersForEndpoint(
    userName: string,
    externalId: string | undefined,
    endpointId: string,
    excludeScimId?: string
  ): Promise<void> {
    // RFC 7643 §2.1: userName has caseExact=false, so uniqueness is case-insensitive
    const orConditions: Prisma.ScimUserWhereInput[] = [{ userNameLower: userName.toLowerCase() }];
    if (externalId) {
      orConditions.push({ externalId });
    }

    const filters: Prisma.ScimUserWhereInput[] = [{ endpointId }];
    if (excludeScimId) {
      filters.push({ NOT: { scimId: excludeScimId } });
    }
    if (orConditions.length === 1) {
      filters.push(orConditions[0]);
    } else {
      filters.push({ OR: orConditions });
    }

    const where: Prisma.ScimUserWhereInput = { AND: filters };

    const conflict = await this.prisma.scimUser.findFirst({
      where,
      select: { scimId: true, userName: true, externalId: true }
    });

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
    user: ScimUser,
    patchDto: PatchUserDto,
    endpointId: string,
    config?: EndpointConfig
  ): Promise<Prisma.ScimUserUpdateInput> {
    const verbosePatch = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED);
    let active = user.active;
    let userName = user.userName;
    let externalId: string | null = user.externalId ?? null;
    let rawPayload = this.parseJson<Record<string, unknown>>(String(user.rawPayload ?? '{}'));
    const meta = this.parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    for (const operation of patchDto.Operations) {
      const op = operation.op?.toLowerCase();
      if (!['add', 'replace', 'remove'].includes(op || '')) {
        throw createScimError({
          status: 400,
          scimType: 'invalidValue',
          detail: `Patch operation '${operation.op}' is not supported.`
        });
      }

      const originalPath = operation.path;
      const path = originalPath?.toLowerCase();

      if (op === 'add' || op === 'replace') {
        if (path === 'active') {
          const value = this.extractBooleanValue(operation.value);
          active = value;
          rawPayload = { ...rawPayload, active: value };
        } else if (path === 'username') {
          userName = this.extractStringValue(operation.value, 'userName');
        } else if (path === 'externalid') {
          externalId = this.extractNullableStringValue(operation.value, 'externalId');
        } else if (originalPath && isExtensionPath(originalPath)) {
          // Enterprise extension URN path: urn:...:User:manager → update nested attribute
          const extParsed = parseExtensionPath(originalPath);
          if (extParsed) {
            rawPayload = applyExtensionUpdate(rawPayload, extParsed, operation.value);
          }
        } else if (originalPath && isValuePath(originalPath)) {
          // ValuePath filter: emails[type eq "work"].value → update in-place or create
          const vpParsed = parseValuePath(originalPath);
          if (vpParsed) {
            if (op === 'add') {
              // For add: create array/element if it doesn't exist
              rawPayload = addValuePathEntry(rawPayload, vpParsed, operation.value);
            } else {
              rawPayload = applyValuePathUpdate(rawPayload, vpParsed, operation.value);
            }
          }
        } else if (verbosePatch && originalPath && originalPath.includes('.')) {
          // Dot-notation path: name.givenName → navigate into nested object
          const dotIndex = originalPath.indexOf('.');
          const parentAttr = originalPath.substring(0, dotIndex);
          const childAttr = originalPath.substring(dotIndex + 1);
          // Case-insensitive parent lookup (RFC 7643 §2.1)
          const parentKey = Object.keys(rawPayload).find(
            k => k.toLowerCase() === parentAttr.toLowerCase()
          ) ?? parentAttr;
          const existing = rawPayload[parentKey];
          if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
            (existing as Record<string, unknown>)[childAttr] = operation.value;
          } else {
            rawPayload[parentKey] = { [childAttr]: operation.value };
          }
        } else if (originalPath) {
          rawPayload = { ...rawPayload, [originalPath]: operation.value };
        } else if (!path && typeof operation.value === 'object' && operation.value !== null) {
          // No-path add/replace: normalize keys case-insensitively, then extract first-class DB fields
          const updateObj = this.normalizeObjectKeys(operation.value as Record<string, unknown>);
          if ('userName' in updateObj) {
            userName = this.extractStringValue(updateObj.userName, 'userName');
            delete updateObj.userName;
          }
          if ('externalId' in updateObj) {
            externalId = this.extractNullableStringValue(updateObj.externalId, 'externalId');
            delete updateObj.externalId;
          }
          if ('active' in updateObj) {
            active = this.extractBooleanValue(updateObj.active);
            delete updateObj.active;
          }
          // Resolve dot-notation keys (name.givenName → nested) and
          // extension URN keys (urn:...:User:attr → extension namespace)
          rawPayload = resolveNoPathValue(rawPayload, updateObj);
        }
      } else if (op === 'remove') {
        if (path === 'active') {
          active = false;
          rawPayload = { ...rawPayload, active: false };
        } else if (originalPath && isExtensionPath(originalPath)) {
          // Remove enterprise extension attribute
          const extParsed = parseExtensionPath(originalPath);
          if (extParsed) {
            rawPayload = removeExtensionAttribute(rawPayload, extParsed);
          }
        } else if (originalPath && isValuePath(originalPath)) {
          // Remove valuePath entry from multi-valued attribute
          const vpParsed = parseValuePath(originalPath);
          if (vpParsed) {
            rawPayload = removeValuePathEntry(rawPayload, vpParsed);
          }
        } else if (verbosePatch && originalPath && originalPath.includes('.')) {
          // Dot-notation remove: name.givenName → remove from nested object
          const dotIndex = originalPath.indexOf('.');
          const parentAttr = originalPath.substring(0, dotIndex);
          const childAttr = originalPath.substring(dotIndex + 1);
          const parentKey = Object.keys(rawPayload).find(
            k => k.toLowerCase() === parentAttr.toLowerCase()
          ) ?? parentAttr;
          const existing = rawPayload[parentKey];
          if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
            delete (existing as Record<string, unknown>)[childAttr];
          }
        } else if (originalPath) {
          rawPayload = this.removeAttribute(rawPayload, originalPath);
        } else {
          throw createScimError({
            status: 400,
            scimType: 'noTarget',
            detail: 'Remove operation requires a path.'
          });
        }
      }
    }

    rawPayload = this.stripReservedAttributes(rawPayload);

    await this.assertUniqueIdentifiersForEndpoint(userName, externalId ?? undefined, endpointId, user.scimId);

    return {
      userName,
      userNameLower: userName.toLowerCase(),
      externalId,
      active,
      rawPayload: JSON.stringify(rawPayload),
      meta: JSON.stringify({
        ...meta,
        lastModified: new Date().toISOString()
      })
    } satisfies Prisma.ScimUserUpdateInput;
  }

  /**
   * Normalize incoming JSON object keys to canonical camelCase for known SCIM attributes.
   * Per RFC 7643 §2.1: "Attribute names are case insensitive".
   * Unknown keys are preserved as-is.
   */
  private normalizeObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
    const keyMap: Record<string, string> = {
      'username': 'userName',
      'externalid': 'externalId',
      'active': 'active',
      'displayname': 'displayName',
      'name': 'name',
      'nickname': 'nickName',
      'profileurl': 'profileUrl',
      'title': 'title',
      'usertype': 'userType',
      'preferredlanguage': 'preferredLanguage',
      'locale': 'locale',
      'timezone': 'timezone',
      'emails': 'emails',
      'phonenumbers': 'phoneNumbers',
      'addresses': 'addresses',
      'photos': 'photos',
      'ims': 'ims',
      'roles': 'roles',
      'entitlements': 'entitlements',
      'x509certificates': 'x509Certificates',
    };
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const canonical = keyMap[key.toLowerCase()] ?? key;
      result[canonical] = value;
    }
    return result;
  }

  private stripReservedAttributes(payload: Record<string, unknown>): Record<string, unknown> {
    const reserved = new Set(['username', 'userid', 'userName', 'externalid', 'externalId', 'active']);
    const entries = Object.entries(payload).filter(
      ([key]) => !reserved.has(key) && !reserved.has(key.toLowerCase())
    );
    return Object.fromEntries(entries);
  }

  private removeAttribute(payload: Record<string, unknown>, attribute: string): Record<string, unknown> {
    if (!attribute) {
      return { ...payload };
    }
    const target = attribute.toLowerCase();
    return Object.fromEntries(
      Object.entries(payload).filter(([key]) => key.toLowerCase() !== target)
    );
  }

  private extractStringValue(value: unknown, attribute: string): string {
    if (typeof value === 'string') {
      return value;
    }

    throw createScimError({
      status: 400,
      scimType: 'invalidValue',
      detail: `${attribute} must be provided as a string.`
    });
  }

  private extractNullableStringValue(value: unknown, attribute: string): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    throw createScimError({
      status: 400,
      scimType: 'invalidValue',
      detail: `${attribute} must be provided as a string or null.`
    });
  }

  private extractBooleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    // Handle string boolean values from Entra ID
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      if (lowerValue === 'true') return true;
      if (lowerValue === 'false') return false;
    }

    if (typeof value === 'object' && value !== null && 'active' in value) {
      const active = (value as { active: unknown }).active;
      if (typeof active === 'boolean') {
        return active;
      }
      // Also handle string boolean in nested objects
      if (typeof active === 'string') {
        const lowerActive = active.toLowerCase();
        if (lowerActive === 'true') return true;
        if (lowerActive === 'false') return false;
      }
    }

    throw createScimError({
      status: 400,
      scimType: 'invalidValue',
      detail: `Patch operation requires boolean value for active. Received: ${typeof value} "${String(
        value
      )}"`
    });
  }

  private toScimUserResource(user: ScimUser, baseUrl: string): ScimUserResource {
    const meta = this.buildMeta(user, baseUrl);
    const rawPayload = this.parseJson<Record<string, unknown>>(String(user.rawPayload ?? '{}'));

    // Sanitize boolean-like strings in multi-valued attributes (Microsoft Entra sends "True"/"False")
    this.sanitizeBooleanStrings(rawPayload);

    return {
      schemas: [SCIM_CORE_USER_SCHEMA],
      id: user.scimId,
      userName: user.userName,
      externalId: user.externalId ?? undefined,
      active: user.active,
      ...rawPayload,
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

  private buildMeta(user: ScimUser, baseUrl: string) {
    const createdAt = user.createdAt.toISOString();
    const lastModified = user.updatedAt.toISOString();
    const location = this.metadata.buildLocation(baseUrl, 'Users', String(user.scimId));

    return {
      resourceType: 'User',
      created: createdAt,
      lastModified,
      location,
      version: `W/"${user.updatedAt.toISOString()}"`
    };
  }

  private extractAdditionalAttributes(dto: CreateUserDto): Record<string, unknown> {
    const { schemas, ...rest } = dto;
    const additional = { ...rest } as Record<string, unknown>;
    delete additional.userName;
    delete additional.externalId;
    delete additional.active;

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
