import { Injectable, BadRequestException, NotFoundException, OnModuleInit, Inject, Optional } from '@nestjs/common';
import type { Endpoint, Prisma } from '../../../generated/prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEndpointDto } from '../dto/create-endpoint.dto';
import type { UpdateEndpointDto } from '../dto/update-endpoint.dto';
import { ENDPOINT_CONFIG_FLAGS, validateEndpointConfig } from '../endpoint-config.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { parseLogLevel, logLevelName } from '../../logging/log-levels';
import { validateAndExpandProfile } from '../../scim/endpoint-profile/endpoint-profile.service';
import { getBuiltInPreset, DEFAULT_PRESET_NAME, BUILT_IN_PRESETS, PRESET_NAMES } from '../../scim/endpoint-profile/built-in-presets';
import type { EndpointProfile, ServiceProviderConfig } from '../../scim/endpoint-profile/endpoint-profile.types';
import type { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../../domain/repositories/group.repository.interface';
import { USER_REPOSITORY, GROUP_REPOSITORY } from '../../../domain/repositories/repository.tokens';

/** Callback type for profile change notifications (registry hydration) */
export type ProfileChangeListener = (endpointId: string, profile: EndpointProfile | null) => void;

// ─── Profile Summary Types ────────────────────────────────────────────────

/** Per-schema digest in the profile summary */
export interface SchemaSummary {
  id: string;
  name: string;
  attributeCount: number;
}

/** Per-resourceType digest in the profile summary */
export interface ResourceTypeSummary {
  name: string;
  schema: string;
  extensions: string[];
  extensionCount: number;
}

/** SPC capability flags summary - mirrors ServiceProviderConfig.supported booleans */
export interface ServiceProviderConfigSummary {
  patch: boolean;
  bulk: boolean;
  filter: boolean;
  changePassword: boolean;
  sort: boolean;
  etag: boolean;
}

/** Digest of an EndpointProfile for the summary view */
export interface ProfileSummary {
  schemaCount: number;
  schemas: SchemaSummary[];
  resourceTypeCount: number;
  resourceTypes: ResourceTypeSummary[];
  serviceProviderConfig: ServiceProviderConfigSummary;
  activeSettings: Record<string, unknown>;
}

// ─── _links ─────────────────────────────────────────────────────────────────

export interface EndpointLinks {
  self: string;
  stats: string;
  credentials: string;
  scim: string;
}

// ─── EndpointResponse ───────────────────────────────────────────────────────

export interface EndpointResponse {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  /** Full profile - included when view=full (single-endpoint GET default) */
  profile?: EndpointProfile;
  /** Profile digest - included when view=summary (list default) */
  profileSummary?: ProfileSummary;
  active: boolean;
  scimBasePath: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  _links: EndpointLinks;
}

// ─── List Envelope ────────────────────────────────────────────────────────

export interface EndpointListResponse {
  totalResults: number;
  endpoints: EndpointResponse[];
}

// ─── Presets ──────────────────────────────────────────────────────────────

export interface PresetSummaryResponse {
  name: string;
  description: string;
  default: boolean;
  summary: ProfileSummary;
}

export interface PresetListResponse {
  totalResults: number;
  presets: PresetSummaryResponse[];
}

// ─── Stats ────────────────────────────────────────────────────────────────

export interface ResourceStats {
  total: number;
  active: number;
  inactive: number;
}

export interface EndpointStatsResponse {
  users: ResourceStats;
  groups: ResourceStats;
  groupMembers: { total: number };
  requestLogs: { total: number };
}

// ─── Internal Cache Type ──────────────────────────────────────────────────

/** Internal cache representation - keeps Date objects and full profile for fast access */
interface CachedEndpoint {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  profile?: EndpointProfile;
  active: boolean;
  scimBasePath: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EndpointService implements OnModuleInit {
  private readonly isInMemoryBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase() === 'inmemory';

  // ─── Unified Endpoint Cache ─────────────────────────────────────────
  // Both Prisma and InMemory backends use these caches for reads.
  // Writes go to DB first (Prisma) or directly (InMemory), then update cache.
  private readonly cacheById = new Map<string, CachedEndpoint>();
  private readonly cacheByName = new Map<string, CachedEndpoint>();

  /** Callback for registry hydration on profile changes */
  private profileChangeListener?: ProfileChangeListener;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scimLogger: ScimLogger,
    @Optional() @Inject(USER_REPOSITORY) private readonly userRepo?: IUserRepository,
    @Optional() @Inject(GROUP_REPOSITORY) private readonly groupRepo?: IGroupRepository,
  ) {}

  /**
   * Set a listener to be called when an endpoint's profile changes.
   * Used by ScimModule to rehydrate registry overlays on create/update/delete.
   */
  setProfileChangeListener(listener: ProfileChangeListener): void {
    this.profileChangeListener = listener;
  }

  /**
   * On module init: warm the endpoint cache from the database and restore
   * per-endpoint log levels. For InMemory backend, cache starts empty.
   */
  async onModuleInit(): Promise<void> {
    if (this.isInMemoryBackend) {
      this.scimLogger.debug(LogCategory.ENDPOINT, 'InMemory backend - endpoint cache starts empty.');
      return;
    }

    try {
      const endpoints = await this.prisma.endpoint.findMany({
        orderBy: { createdAt: 'desc' },
      });

      for (const ep of endpoints) {
        const cached = this.toCached(ep);
        this.cacheSet(cached);

        // Restore per-endpoint log levels
        const settings = cached.profile?.settings as Record<string, any> | undefined;
        const logLevel = settings?.[ENDPOINT_CONFIG_FLAGS.LOG_LEVEL];
        if (logLevel !== undefined) {
          const level = typeof logLevel === 'number' ? logLevel : parseLogLevel(String(logLevel));
          this.scimLogger.setEndpointLevel(ep.id, level);
        }
      }

      this.scimLogger.info(LogCategory.ENDPOINT, `Warmed endpoint cache with ${endpoints.length} endpoint(s).`);
    } catch (error) {
      this.scimLogger.warn(LogCategory.ENDPOINT, `Failed to warm endpoint cache: ${(error as Error).message}`);
    }
  }

  // ─── Cache helpers ──────────────────────────────────────────────────

  private cacheSet(ep: CachedEndpoint): void {
    this.cacheById.set(ep.id, ep);
    this.cacheByName.set(ep.name, ep);
  }

  private cacheDelete(ep: CachedEndpoint): void {
    this.cacheById.delete(ep.id);
    this.cacheByName.delete(ep.name);
  }

  // ─── Profile Summary Builder ────────────────────────────────────────

  /**
   * Build a profile summary (schema-digest level) from a full EndpointProfile.
   */
  static buildProfileSummary(profile: EndpointProfile): ProfileSummary {
    const schemas: SchemaSummary[] = (profile.schemas ?? []).map(s => ({
      id: s.id,
      name: s.name,
      attributeCount: s.attributes?.length ?? 0,
    }));

    const resourceTypes: ResourceTypeSummary[] = (profile.resourceTypes ?? []).map(rt => ({
      name: rt.name,
      schema: rt.schema,
      extensions: rt.schemaExtensions?.map(e => e.schema) ?? [],
      extensionCount: rt.schemaExtensions?.length ?? 0,
    }));

    const spc = profile.serviceProviderConfig;
    const serviceProviderConfig: ServiceProviderConfigSummary = {
      patch: spc?.patch?.supported ?? false,
      bulk: spc?.bulk?.supported ?? false,
      filter: spc?.filter?.supported ?? false,
      changePassword: spc?.changePassword?.supported ?? false,
      sort: spc?.sort?.supported ?? false,
      etag: spc?.etag?.supported ?? false,
    };

    // Only include non-empty / non-false settings
    const activeSettings: Record<string, unknown> = {};
    if (profile.settings) {
      for (const [key, value] of Object.entries(profile.settings)) {
        if (value !== undefined && value !== null && value !== '' && value !== false && value !== 'False') {
          activeSettings[key] = value;
        }
      }
    }

    return {
      schemaCount: schemas.length,
      schemas,
      resourceTypeCount: resourceTypes.length,
      resourceTypes,
      serviceProviderConfig,
      activeSettings,
    };
  }

  // ─── Response Builders ──────────────────────────────────────────────

  private buildLinks(id: string): EndpointLinks {
    return {
      self: `/admin/endpoints/${id}`,
      stats: `/admin/endpoints/${id}/stats`,
      credentials: `/admin/endpoints/${id}/credentials`,
      scim: `/scim/endpoints/${id}`,
    };
  }

  /**
   * Convert CachedEndpoint → full EndpointResponse (view=full).
   * Includes full profile, no profileSummary.
   */
  private toFullResponse(cached: CachedEndpoint): EndpointResponse {
    // Strip runtime-only _schemaCaches from profile before serialization.
    // _schemaCaches contains Map/Set objects (which serialize to {}) and is
    // an internal implementation detail that should not leak to consumers.
    let profileOut = cached.profile;
    if (cached.profile && '_schemaCaches' in cached.profile) {
      const { _schemaCaches, ...rest } = cached.profile;
      profileOut = rest as typeof cached.profile;
    }
    return {
      id: cached.id,
      name: cached.name,
      displayName: cached.displayName,
      description: cached.description,
      profile: profileOut,
      active: cached.active,
      scimBasePath: cached.scimBasePath,
      createdAt: cached.createdAt.toISOString(),
      updatedAt: cached.updatedAt.toISOString(),
      _links: this.buildLinks(cached.id),
    };
  }

  /**
   * Convert CachedEndpoint → summary EndpointResponse (view=summary).
   * Includes profileSummary, no full profile.
   */
  private toSummaryResponse(cached: CachedEndpoint): EndpointResponse {
    return {
      id: cached.id,
      name: cached.name,
      displayName: cached.displayName,
      description: cached.description,
      profileSummary: cached.profile
        ? EndpointService.buildProfileSummary(cached.profile)
        : undefined,
      active: cached.active,
      scimBasePath: cached.scimBasePath,
      createdAt: cached.createdAt.toISOString(),
      updatedAt: cached.updatedAt.toISOString(),
      _links: this.buildLinks(cached.id),
    };
  }

  /**
   * Convert CachedEndpoint → EndpointResponse for the given view.
   */
  toResponse(cached: CachedEndpoint, view: 'full' | 'summary' = 'full'): EndpointResponse {
    return view === 'summary' ? this.toSummaryResponse(cached) : this.toFullResponse(cached);
  }

  async createEndpoint(dto: CreateEndpointDto): Promise<EndpointResponse> {
    // Validate endpoint name
    if (!dto.name || !dto.name.match(/^[a-zA-Z0-9_-]+$/)) {
      throw new BadRequestException(
        'Endpoint name must contain only alphanumeric characters, hyphens, and underscores'
      );
    }

    // Mutual exclusivity: profilePreset vs profile
    if (dto.profilePreset && dto.profile) {
      throw new BadRequestException('Cannot specify both "profilePreset" and "profile". They are mutually exclusive.');
    }

    // Resolve profile: preset → expand, inline → expand, default → entra-id
    let resolvedProfile: EndpointProfile;
    if (dto.profilePreset) {
      try {
        const preset = getBuiltInPreset(dto.profilePreset);
        const result = validateAndExpandProfile(preset.profile);
        if (!result.valid) {
          throw new BadRequestException(`Preset "${dto.profilePreset}" validation failed: ${result.errors.map(e => e.detail).join('; ')}`);
        }
        resolvedProfile = result.profile!;
      } catch (e: any) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(e.message);
      }
    } else if (dto.profile) {
      // Validate settings values if provided (rejects invalid flag values like 'Yes', 123, etc.)
      if (dto.profile.settings) {
        try {
          validateEndpointConfig(dto.profile.settings as Record<string, any>);
        } catch (error) {
          throw new BadRequestException((error as Error).message);
        }
      }
      const result = validateAndExpandProfile(dto.profile);
      if (!result.valid) {
        throw new BadRequestException(`Profile validation failed: ${result.errors.map(e => e.detail).join('; ')}`);
      }
      resolvedProfile = result.profile!;
    } else {
      // Default: entra-id preset
      const preset = getBuiltInPreset(DEFAULT_PRESET_NAME);
      const result = validateAndExpandProfile(preset.profile);
      resolvedProfile = result.profile!;
    }

    // Persist + cache
    if (this.isInMemoryBackend) {
      // Normalize any deprecated settings keys before caching
      this.normalizeStaleSettingsKeys(resolvedProfile);
      const now = new Date();
      const id = randomUUID();
      const cached: CachedEndpoint = {
        id,
        name: dto.name,
        displayName: dto.displayName ?? dto.name,
        description: dto.description ?? undefined,
        profile: resolvedProfile,
        active: true,
        scimBasePath: `/scim/endpoints/${id}`,
        createdAt: now,
        updatedAt: now,
      };
      this.cacheSet(cached);
      this.syncEndpointLogLevel(cached.id, resolvedProfile.settings);
      this.syncEndpointFileLogging(cached.id, dto.name, resolvedProfile.settings);
      this.profileChangeListener?.(cached.id, resolvedProfile);
      this.scimLogger.info(LogCategory.ENDPOINT, 'Endpoint created', {
        endpointId: cached.id, name: dto.name, preset: dto.profilePreset ?? 'custom',
      });
      return this.toFullResponse(cached);
    }

    const existing = await this.prisma.endpoint.findUnique({
      where: { name: dto.name }
    });

    if (existing) {
      throw new BadRequestException(`Endpoint with name "${dto.name}" already exists`);
    }

    const endpoint = await this.prisma.endpoint.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        profile: resolvedProfile as any,
        active: true
      }
    });

    const cached = this.toCached(endpoint);
    this.cacheSet(cached);
    this.syncEndpointLogLevel(endpoint.id, resolvedProfile.settings);
    this.syncEndpointFileLogging(endpoint.id, dto.name, resolvedProfile.settings);
    this.profileChangeListener?.(endpoint.id, resolvedProfile);
    this.scimLogger.info(LogCategory.ENDPOINT, 'Endpoint created', {
      endpointId: endpoint.id, name: dto.name, preset: dto.profilePreset ?? 'custom',
    });
    return this.toFullResponse(cached);
  }

  async getEndpoint(endpointId: string, view: 'full' | 'summary' = 'full'): Promise<EndpointResponse> {
    // Try cache by ID first, then by name
    const cached = this.cacheById.get(endpointId) ?? this.cacheByName.get(endpointId);
    if (cached) return this.toResponse(cached, view);

    // Cache miss - try DB (Prisma only; InMemory is always in cache)
    if (this.isInMemoryBackend) {
      throw new NotFoundException(`Endpoint "${endpointId}" not found`);
    }

    let endpoint: Endpoint | null = null;

    // Try by ID first (UUID format)
    try {
      endpoint = await this.prisma.endpoint.findUnique({
        where: { id: endpointId }
      });
    } catch (e) {
      // ID lookup failed (e.g., invalid UUID) - will try by name below
      this.scimLogger.debug(LogCategory.ENDPOINT, 'Endpoint ID lookup failed, trying by name', { endpointId, error: (e as Error).message });
    }

    // Fallback: try by name (allows using endpoint name in SCIM URLs)
    if (!endpoint) {
      try {
        endpoint = await this.prisma.endpoint.findUnique({
          where: { name: endpointId }
        });
      } catch (e) {
        // Name lookup also failed
        this.scimLogger.debug(LogCategory.ENDPOINT, 'Endpoint name lookup failed', { endpointId, error: (e as Error).message });
      }
    }

    if (!endpoint) {
      throw new NotFoundException(`Endpoint "${endpointId}" not found`);
    }

    const ce = this.toCached(endpoint);
    this.cacheSet(ce); // warm cache for next time
    return this.toResponse(ce, view);
  }

  async getEndpointByName(name: string, view: 'full' | 'summary' = 'full'): Promise<EndpointResponse> {
    const cached = this.cacheByName.get(name);
    if (cached) return this.toResponse(cached, view);

    if (this.isInMemoryBackend) {
      throw new NotFoundException(`Endpoint with name "${name}" not found`);
    }

    const endpoint = await this.prisma.endpoint.findUnique({
      where: { name }
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with name "${name}" not found`);
    }

    const ce = this.toCached(endpoint);
    this.cacheSet(ce);
    return this.toResponse(ce, view);
  }

  async listEndpoints(active?: boolean, view: 'full' | 'summary' = 'summary'): Promise<EndpointListResponse> {
    let items: CachedEndpoint[];

    // If cache is warmed, serve from cache
    if (this.cacheById.size > 0 || this.isInMemoryBackend) {
      const all = [...this.cacheById.values()];
      items = active === undefined ? all : all.filter(ep => ep.active === active);
      items = items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } else {
      // Fallback: load from DB (first call before cache is warmed)
      const where: Prisma.EndpointWhereInput = {};
      if (active !== undefined) {
        where.active = active;
      }

      const endpoints = await this.prisma.endpoint.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });

      items = endpoints.map(e => {
        const ce = this.toCached(e);
        this.cacheSet(ce);
        return ce;
      });
    }

    return {
      totalResults: items.length,
      endpoints: items.map(ep => this.toResponse(ep, view)),
    };
  }

  async updateEndpoint(endpointId: string, dto: UpdateEndpointDto): Promise<EndpointResponse> {
    const current = this.cacheById.get(endpointId);

    if (this.isInMemoryBackend) {
      if (!current) {
        throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
      }

      let newProfile = current.profile;

      // Partial profile update: settings deep-merged, schemas/RTs/SPC replaced
      if (dto.profile) {
        newProfile = this.mergeProfilePartial(newProfile, dto.profile);
      }

      // Normalize any deprecated settings keys after merge
      this.normalizeStaleSettingsKeys(newProfile);

      // Legacy config merge into profile.settings for backward compat
      const updated: CachedEndpoint = {
        ...current,
        displayName: dto.displayName !== undefined ? (dto.displayName ?? current.name) : current.displayName,
        description: dto.description !== undefined ? (dto.description ?? undefined) : current.description,
        profile: newProfile,
        active: dto.active !== undefined ? dto.active : current.active,
        updatedAt: new Date(),
      };

      // Update cache (delete old name entry if name changed)
      if (current.name !== updated.name) this.cacheByName.delete(current.name);
      this.cacheSet(updated);
      if (dto.profile?.settings) {
        this.syncEndpointLogLevel(endpointId, dto.profile.settings as Record<string, any>);
        this.syncEndpointFileLogging(endpointId, updated.name, dto.profile.settings as Record<string, any>);
      }
      this.profileChangeListener?.(endpointId, updated.profile ?? null);
      this.scimLogger.info(LogCategory.ENDPOINT, 'Endpoint updated', {
        endpointId, name: updated.name,
      });

      return this.toFullResponse(updated);
    }

    let endpoint: Endpoint | null;
    try {
      endpoint = await this.prisma.endpoint.findUnique({
        where: { id: endpointId }
      });
    } catch (e) {
      this.scimLogger.debug(LogCategory.ENDPOINT, 'Endpoint lookup failed during update', { endpointId, error: (e as Error).message });
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    // Build profile update
    let profileUpdate: any = undefined;

    // Partial profile update: settings deep-merged, schemas/RTs/SPC replaced
    if (dto.profile) {
      const currentProfile = (endpoint.profile as EndpointProfile | null) ?? undefined;
      profileUpdate = this.mergeProfilePartial(currentProfile, dto.profile);
    }

    const dbUpdated = await this.prisma.endpoint.update({
      where: { id: endpointId },
      data: {
        displayName: dto.displayName,
        description: dto.description,
        profile: profileUpdate,
        active: dto.active
      }
    });

    const cached = this.toCached(dbUpdated);
    // Update cache (delete old name entry if name changed)
    if (current && current.name !== cached.name) this.cacheByName.delete(current.name);
    this.cacheSet(cached);

    if (dto.profile?.settings) {
      this.syncEndpointLogLevel(endpointId, dto.profile.settings as Record<string, any>);
      this.syncEndpointFileLogging(endpointId, cached.name, dto.profile.settings as Record<string, any>);
    }
    this.profileChangeListener?.(endpointId, cached.profile ?? null);

    this.scimLogger.info(LogCategory.ENDPOINT, 'Endpoint updated', {
      endpointId, name: cached.name,
    });

    return this.toFullResponse(cached);
  }

  /**
   * Merge a partial profile update into the current endpoint profile.
   * - `settings` - deep-merged (additive, individual keys can be overwritten)
   * - `schemas`, `resourceTypes`, `serviceProviderConfig` - replaced wholesale
   *
   * If `schemas` or `resourceTypes` are provided they are validated & expanded.
   */
  private mergeProfilePartial(
    current: EndpointProfile | undefined,
    partial: Partial<import('../../scim/endpoint-profile/endpoint-profile.types').ShorthandProfileInput>,
  ): EndpointProfile | undefined {
    if (!current) {
      // No existing profile - validate the partial as a full profile
      const result = validateAndExpandProfile(partial);
      if (!result.valid) {
        throw new BadRequestException(`Profile validation failed: ${result.errors.map((e: any) => e.detail).join('; ')}`);
      }
      return result.profile!;
    }

    // Build merged profile: start from current
    const merged: any = { ...current };

    // Replace schemas if provided
    if (partial.schemas !== undefined) {
      merged.schemas = partial.schemas;
    }
    // Replace resourceTypes if provided
    if (partial.resourceTypes !== undefined) {
      merged.resourceTypes = partial.resourceTypes;
    }
    // Replace SPC if provided
    if (partial.serviceProviderConfig !== undefined) {
      merged.serviceProviderConfig = { ...current.serviceProviderConfig, ...partial.serviceProviderConfig };
    }
    // Deep-merge settings (additive)
    if (partial.settings !== undefined) {
      // Validate individual settings values before merging
      try {
        validateEndpointConfig(partial.settings as Record<string, any>);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      merged.settings = { ...current.settings, ...partial.settings };
    }

    // Validate & expand the merged profile
    const result = validateAndExpandProfile(merged);
    if (!result.valid) {
      throw new BadRequestException(`Profile validation failed: ${result.errors.map((e: any) => e.detail).join('; ')}`);
    }
    return result.profile!;
  }

  async deleteEndpoint(endpointId: string): Promise<void> {
    const cached = this.cacheById.get(endpointId);

    if (this.isInMemoryBackend) {
      if (!cached) {
        throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
      }
      this.cacheDelete(cached);
      this.scimLogger.clearEndpointLevel(endpointId);
      this.profileChangeListener?.(endpointId, null);
      this.scimLogger.info(LogCategory.ENDPOINT, 'Endpoint deleted', { endpointId, name: cached.name });
      return;
    }

    let endpoint: Endpoint | null;
    try {
      endpoint = await this.prisma.endpoint.findUnique({
        where: { id: endpointId }
      });
    } catch {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    await this.prisma.endpoint.delete({
      where: { id: endpointId }
    });

    if (cached) this.cacheDelete(cached);
    this.scimLogger.clearEndpointLevel(endpointId);
    this.profileChangeListener?.(endpointId, null);
    this.scimLogger.info(LogCategory.ENDPOINT, 'Endpoint deleted', { endpointId, name: endpoint.name });
  }

  async getEndpointStats(endpointId: string): Promise<EndpointStatsResponse> {
    // Verify endpoint exists (via cache)
    if (!this.cacheById.has(endpointId)) {
      if (this.isInMemoryBackend) {
        throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
      }
      // Try DB
      const ep = await this.prisma.endpoint.findUnique({ where: { id: endpointId } });
      if (!ep) throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    if (this.isInMemoryBackend) {
      // Use repository layer to count actual resources (not hardcoded zeros)
      let totalUsers = 0, activeUsers = 0, totalGroups = 0, activeGroups = 0;
      if (this.userRepo) {
        const users = await this.userRepo.findAll(endpointId);
        totalUsers = users.length;
        activeUsers = users.filter(u => u.active).length;
      }
      if (this.groupRepo) {
        const groups = await this.groupRepo.findAllWithMembers(endpointId);
        totalGroups = groups.length;
        activeGroups = totalGroups; // Groups don't have active field
      }
      return {
        users: { total: totalUsers, active: activeUsers, inactive: totalUsers - activeUsers },
        groups: { total: totalGroups, active: activeGroups, inactive: 0 },
        groupMembers: { total: 0 }, // InMemory member count not easily derived without iterating
        requestLogs: { total: 0 },
      };
    }

    const [totalUsers, activeUsers, inactiveUsers,
           totalGroups, activeGroups, inactiveGroups,
           totalGroupMembers, requestLogCount] = await Promise.all([
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'User' } }),
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'User', active: true } }),
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'User', active: false } }),
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'Group' } }),
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'Group', active: true } }),
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'Group', active: false } }),
      this.prisma.resourceMember.count({ where: { group: { endpointId } } }),
      this.prisma.requestLog.count({ where: { endpointId } })
    ]);

    return {
      users: { total: totalUsers, active: activeUsers, inactive: inactiveUsers },
      groups: { total: totalGroups, active: activeGroups, inactive: inactiveGroups },
      groupMembers: { total: totalGroupMembers },
      requestLogs: { total: requestLogCount },
    };
  }

  // ─── Presets ────────────────────────────────────────────────────────

  /**
   * List all built-in presets with their profile summaries.
   */
  listPresets(): PresetListResponse {
    const presets: PresetSummaryResponse[] = [];

    for (const name of PRESET_NAMES) {
      const preset = BUILT_IN_PRESETS.get(name);
      if (!preset) continue;

      // Expand the preset profile to get full attribute data for summary
      const expanded = validateAndExpandProfile(preset.profile);
      const profile = expanded.profile;

      presets.push({
        name: preset.metadata.name,
        description: preset.metadata.description,
        default: preset.metadata.default ?? false,
        summary: profile
          ? EndpointService.buildProfileSummary(profile)
          : {
              schemaCount: 0,
              schemas: [],
              resourceTypeCount: 0,
              resourceTypes: [],
              serviceProviderConfig: { patch: false, bulk: false, filter: false, changePassword: false, sort: false, etag: false },
              activeSettings: {},
            },
      });
    }

    return { totalResults: presets.length, presets };
  }

  /**
   * Get a single built-in preset by name with its full expanded profile.
   */
  getPreset(name: string): { metadata: { name: string; description: string; default: boolean }; profile: EndpointProfile } {
    const preset = BUILT_IN_PRESETS.get(name);
    if (!preset) {
      const validNames = [...BUILT_IN_PRESETS.keys()].join(', ');
      throw new NotFoundException(`Unknown preset "${name}". Valid presets: ${validNames}`);
    }

    const expanded = validateAndExpandProfile(preset.profile);
    if (!expanded.profile) {
      throw new BadRequestException(`Failed to expand preset "${name}"`);
    }

    return {
      metadata: {
        name: preset.metadata.name,
        description: preset.metadata.description,
        default: preset.metadata.default ?? false,
      },
      profile: expanded.profile,
    };
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  /**
   * Normalize deprecated settings keys to their current names.
   * Called from both toCached() (DB path) and in-memory CRUD paths so
   * deprecated keys never survive in the cached profile regardless of
   * persistence backend.
   */
  private normalizeStaleSettingsKeys(profile: EndpointProfile | undefined): void {
    if (!profile?.settings) return;
    const s = profile.settings as Record<string, unknown>;
    const STALE_KEY_MAP: Record<string, string> = {
      SoftDeleteEnabled: 'UserSoftDeleteEnabled',
      MultiOpPatchRequestAddMultipleMembersToGroup: 'MultiMemberPatchOpForGroupEnabled',
      MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'MultiMemberPatchOpForGroupEnabled',
    };
    for (const [oldKey, newKey] of Object.entries(STALE_KEY_MAP)) {
      if (oldKey in s && !(newKey in s)) {
        s[newKey] = s[oldKey];
      }
      if (oldKey in s) {
        delete s[oldKey];
      }
    }
  }

  private toCached(endpoint: Endpoint): CachedEndpoint {
    const profile = endpoint.profile as Record<string, any> | null;
    const typedProfile = profile as EndpointProfile | undefined;

    // Strip any serialized _schemaCaches artifact from DB (plain object, not Map).
    // The cache is built lazily by getSchemaCache() on first request access.
    if (typedProfile?._schemaCaches) {
      delete typedProfile._schemaCaches;
    }

    // Normalize stale settings keys from pre-v0.29 profiles to current names.
    this.normalizeStaleSettingsKeys(typedProfile);

    return {
      id: endpoint.id,
      name: endpoint.name,
      displayName: endpoint.displayName || endpoint.name,
      description: endpoint.description ?? undefined,
      profile: typedProfile,
      active: endpoint.active,
      scimBasePath: `/scim/endpoints/${endpoint.id}`,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt
    };
  }

  /**
   * Sync per-endpoint log level from profile settings to ScimLogger.
   */
  private syncEndpointLogLevel(endpointId: string, settings?: Record<string, any> | null): void {
    const logLevelValue = settings?.[ENDPOINT_CONFIG_FLAGS.LOG_LEVEL];
    if (logLevelValue !== undefined) {
      const level = typeof logLevelValue === 'number'
        ? logLevelValue
        : parseLogLevel(String(logLevelValue));
      this.scimLogger.setEndpointLevel(endpointId, level);
      this.scimLogger.info(LogCategory.ENDPOINT, `Set log level ${logLevelName(level)} for endpoint ${endpointId}`);
    } else {
      this.scimLogger.clearEndpointLevel(endpointId);
    }
  }

  /** Sync per-endpoint file logging based on logFileEnabled setting (default: true). */
  private syncEndpointFileLogging(endpointId: string, endpointName: string, settings?: Record<string, any> | null): void {
    const enabled = settings?.logFileEnabled;
    // Default to true: undefined/null → enable; only explicit false/"false"/"False"/"0" disables
    if (enabled === false || enabled === 'false' || enabled === 'False' || enabled === '0') {
      this.scimLogger.disableEndpointFileLogging(endpointId);
    } else {
      this.scimLogger.enableEndpointFileLogging(endpointId, endpointName);
    }
  }
}
