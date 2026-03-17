import { Injectable, BadRequestException, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import type { Endpoint, Prisma } from '../../../generated/prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEndpointDto } from '../dto/create-endpoint.dto';
import type { UpdateEndpointDto } from '../dto/update-endpoint.dto';
import { ENDPOINT_CONFIG_FLAGS, validateEndpointConfig } from '../endpoint-config.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { parseLogLevel, logLevelName } from '../../logging/log-levels';
import { validateAndExpandProfile } from '../../scim/endpoint-profile/endpoint-profile.service';
import { getBuiltInPreset, DEFAULT_PRESET_NAME } from '../../scim/endpoint-profile/built-in-presets';
import type { EndpointProfile } from '../../scim/endpoint-profile/endpoint-profile.types';

/** Callback type for profile change notifications (registry hydration) */
export type ProfileChangeListener = (endpointId: string, profile: EndpointProfile | null) => void;

export interface EndpointResponse {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  profile?: EndpointProfile;
  active: boolean;
  scimEndpoint: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EndpointService implements OnModuleInit {
  private readonly logger = new Logger(EndpointService.name);
  private readonly isInMemoryBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase() === 'inmemory';

  // ─── Unified Endpoint Cache ─────────────────────────────────────────
  // Both Prisma and InMemory backends use these caches for reads.
  // Writes go to DB first (Prisma) or directly (InMemory), then update cache.
  private readonly cacheById = new Map<string, EndpointResponse>();
  private readonly cacheByName = new Map<string, EndpointResponse>();

  /** Callback for registry hydration on profile changes */
  private profileChangeListener?: ProfileChangeListener;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scimLogger: ScimLogger,
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
      this.logger.debug('InMemory backend — endpoint cache starts empty.');
      return;
    }

    try {
      const endpoints = await this.prisma.endpoint.findMany({
        orderBy: { createdAt: 'desc' },
      });

      for (const ep of endpoints) {
        const response = this.toResponse(ep);
        this.cacheSet(response);

        // Restore per-endpoint log levels
        const settings = response.profile?.settings as Record<string, any> | undefined;
        const logLevel = settings?.[ENDPOINT_CONFIG_FLAGS.LOG_LEVEL];
        if (logLevel !== undefined) {
          const level = typeof logLevel === 'number' ? logLevel : parseLogLevel(String(logLevel));
          this.scimLogger.setEndpointLevel(ep.id, level);
        }
      }

      this.logger.log(`Warmed endpoint cache with ${endpoints.length} endpoint(s).`);
    } catch (error) {
      this.logger.warn(`Failed to warm endpoint cache: ${(error as Error).message}`);
    }
  }

  // ─── Cache helpers ──────────────────────────────────────────────────

  private cacheSet(ep: EndpointResponse): void {
    this.cacheById.set(ep.id, ep);
    this.cacheByName.set(ep.name, ep);
  }

  private cacheDelete(ep: EndpointResponse): void {
    this.cacheById.delete(ep.id);
    this.cacheByName.delete(ep.name);
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
      const now = new Date();
      const response: EndpointResponse = {
        id: randomUUID(),
        name: dto.name,
        displayName: dto.displayName ?? dto.name,
        description: dto.description ?? undefined,
        profile: resolvedProfile,
        active: true,
        scimEndpoint: '',
        createdAt: now,
        updatedAt: now,
      };
      response.scimEndpoint = `/scim/endpoints/${response.id}`;
      this.cacheSet(response);
      this.syncEndpointLogLevel(response.id, resolvedProfile.settings);
      this.profileChangeListener?.(response.id, resolvedProfile);
      return response;
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

    const response = this.toResponse(endpoint);
    this.cacheSet(response);
    this.syncEndpointLogLevel(endpoint.id, resolvedProfile.settings);
    this.profileChangeListener?.(endpoint.id, resolvedProfile);
    return response;
  }

  async getEndpoint(endpointId: string): Promise<EndpointResponse> {
    const cached = this.cacheById.get(endpointId);
    if (cached) return cached;

    // Cache miss — try DB (Prisma only; InMemory is always in cache)
    if (this.isInMemoryBackend) {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
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

    const response = this.toResponse(endpoint);
    this.cacheSet(response); // warm cache for next time
    return response;
  }

  async getEndpointByName(name: string): Promise<EndpointResponse> {
    const cached = this.cacheByName.get(name);
    if (cached) return cached;

    if (this.isInMemoryBackend) {
      throw new NotFoundException(`Endpoint with name "${name}" not found`);
    }

    const endpoint = await this.prisma.endpoint.findUnique({
      where: { name }
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with name "${name}" not found`);
    }

    const response = this.toResponse(endpoint);
    this.cacheSet(response);
    return response;
  }

  async listEndpoints(active?: boolean): Promise<EndpointResponse[]> {
    // If cache is warmed, serve from cache
    if (this.cacheById.size > 0 || this.isInMemoryBackend) {
      const all = [...this.cacheById.values()];
      const filtered = active === undefined ? all : all.filter(ep => ep.active === active);
      return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    // Fallback: load from DB (first call before cache is warmed)
    const where: Prisma.EndpointWhereInput = {};
    if (active !== undefined) {
      where.active = active;
    }

    const endpoints = await this.prisma.endpoint.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return endpoints.map(e => {
      const response = this.toResponse(e);
      this.cacheSet(response);
      return response;
    });
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

      // Legacy config merge into profile.settings for backward compat
      const updated: EndpointResponse = {
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
      }
      this.profileChangeListener?.(endpointId, updated.profile ?? null);

      return updated;
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

    const response = this.toResponse(dbUpdated);
    // Update cache (delete old name entry if name changed)
    if (current && current.name !== response.name) this.cacheByName.delete(current.name);
    this.cacheSet(response);

    if (dto.profile?.settings) {
      this.syncEndpointLogLevel(endpointId, dto.profile.settings as Record<string, any>);
    }
    this.profileChangeListener?.(endpointId, response.profile ?? null);

    return response;
  }

  /**
   * Merge a partial profile update into the current endpoint profile.
   * - `settings` — deep-merged (additive, individual keys can be overwritten)
   * - `schemas`, `resourceTypes`, `serviceProviderConfig` — replaced wholesale
   *
   * If `schemas` or `resourceTypes` are provided they are validated & expanded.
   */
  private mergeProfilePartial(
    current: EndpointProfile | undefined,
    partial: Partial<import('../../scim/endpoint-profile/endpoint-profile.types').ShorthandProfileInput>,
  ): EndpointProfile | undefined {
    if (!current) {
      // No existing profile — validate the partial as a full profile
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
  }

  async getEndpointStats(endpointId: string): Promise<{
    totalUsers: number;
    totalGroups: number;
    totalGroupMembers: number;
    requestLogCount: number;
  }> {
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
      return { totalUsers: 0, totalGroups: 0, totalGroupMembers: 0, requestLogCount: 0 };
    }

    const [totalUsers, totalGroups, totalGroupMembers, requestLogCount] = await Promise.all([
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'User' } }),
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'Group' } }),
      this.prisma.resourceMember.count({ where: { group: { endpointId } } }),
      this.prisma.requestLog.count({ where: { endpointId } })
    ]);

    return { totalUsers, totalGroups, totalGroupMembers, requestLogCount };
  }

  private toResponse(endpoint: Endpoint): EndpointResponse {
    const profile = endpoint.profile as Record<string, any> | null;
    return {
      id: endpoint.id,
      name: endpoint.name,
      displayName: endpoint.displayName || endpoint.name,
      description: endpoint.description ?? undefined,
      profile: profile as EndpointProfile | undefined,
      active: endpoint.active,
      scimEndpoint: `/scim/endpoints/${endpoint.id}`,
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
      this.logger.log(`Set log level ${logLevelName(level)} for endpoint ${endpointId}`);
    } else {
      this.scimLogger.clearEndpointLevel(endpointId);
    }
  }
}
