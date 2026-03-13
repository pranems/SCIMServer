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

export interface EndpointResponse {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  /** @deprecated Use profile.settings — retained for backward compat in list views */
  config?: Record<string, any>;
  profile?: EndpointProfile;
  active: boolean;
  scimEndpoint: string;
  createdAt: Date;
  updatedAt: Date;
}

interface InMemoryEndpointRecord {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  profile: Record<string, unknown> | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EndpointService implements OnModuleInit {
  private readonly logger = new Logger(EndpointService.name);
  private readonly isInMemoryBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase() === 'inmemory';
  private readonly inMemoryEndpoints = new Map<string, InMemoryEndpointRecord>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scimLogger: ScimLogger,
  ) {}

  /**
   * On module init, restore per-endpoint log levels from the database.
   * This ensures that any previously configured logLevel in endpoint configs
   * is applied to ScimLogger after a server restart.
   */
  async onModuleInit(): Promise<void> {
    if (this.isInMemoryBackend) {
      return;
    }

    try {
      const endpoints = await this.prisma.endpoint.findMany({
        where: { active: true },
        select: { id: true, name: true, profile: true },
      });

      let restored = 0;
      for (const ep of endpoints) {
        if (!ep.profile) continue;
        try {
          const profile = ep.profile as Record<string, any>;
          const settings = profile?.settings as Record<string, any> | undefined;
          const logLevel = settings?.[ENDPOINT_CONFIG_FLAGS.LOG_LEVEL];
          if (logLevel !== undefined) {
            const level = typeof logLevel === 'number' ? logLevel : parseLogLevel(String(logLevel));
            this.scimLogger.setEndpointLevel(ep.id, level);
            restored++;
            this.logger.log(`Restored log level ${logLevelName(level)} for endpoint "${ep.name}" (${ep.id})`);
          }
        } catch {
          // Skip endpoints with malformed profile
        }
      }

      if (restored > 0) {
        this.logger.log(`Restored per-endpoint log levels for ${restored} endpoint(s)`);
      }
    } catch (error) {
      this.logger.warn(`Failed to restore endpoint log levels: ${(error as Error).message}`);
    }
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
      const result = validateAndExpandProfile(dto.profile);
      if (!result.valid) {
        throw new BadRequestException(`Profile validation failed: ${result.errors.map(e => e.detail).join('; ')}`);
      }
      resolvedProfile = result.profile!;
    } else if (dto.config) {
      // Backward compatibility: validate old config flags, then wrap into profile
      try {
        validateEndpointConfig(dto.config);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      resolvedProfile = this.configToProfile(dto.config);
    } else {
      // Default: entra-id preset
      const preset = getBuiltInPreset(DEFAULT_PRESET_NAME);
      const result = validateAndExpandProfile(preset.profile);
      resolvedProfile = result.profile!;
    }

    // Check if endpoint already exists
    if (this.isInMemoryBackend) {
      const existing = Array.from(this.inMemoryEndpoints.values()).find((ep) => ep.name === dto.name);
      if (existing) {
        throw new BadRequestException(`Endpoint with name "${dto.name}" already exists`);
      }

      const now = new Date();
      const endpoint: InMemoryEndpointRecord = {
        id: randomUUID(),
        name: dto.name,
        displayName: dto.displayName ?? null,
        description: dto.description ?? null,
        profile: resolvedProfile as unknown as Record<string, unknown>,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      this.inMemoryEndpoints.set(endpoint.id, endpoint);
      this.syncEndpointLogLevel(endpoint.id, resolvedProfile.settings);
      return this.toResponseInMemory(endpoint);
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

    this.syncEndpointLogLevel(endpoint.id, resolvedProfile.settings);
    return this.toResponse(endpoint);
  }

  async getEndpoint(endpointId: string): Promise<EndpointResponse> {
    if (this.isInMemoryBackend) {
      const endpoint = this.inMemoryEndpoints.get(endpointId);
      if (!endpoint) {
        throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
      }
      return this.toResponseInMemory(endpoint);
    }

    let endpoint: Endpoint | null;
    try {
      endpoint = await this.prisma.endpoint.findUnique({
        where: { id: endpointId }
      });
    } catch {
      // Prisma throws on invalid UUID format for @db.Uuid columns
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    return this.toResponse(endpoint);
  }

  async getEndpointByName(name: string): Promise<EndpointResponse> {
    if (this.isInMemoryBackend) {
      const endpoint = Array.from(this.inMemoryEndpoints.values()).find((ep) => ep.name === name);
      if (!endpoint) {
        throw new NotFoundException(`Endpoint with name "${name}" not found`);
      }
      return this.toResponseInMemory(endpoint);
    }

    const endpoint = await this.prisma.endpoint.findUnique({
      where: { name }
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with name "${name}" not found`);
    }

    return this.toResponse(endpoint);
  }

  async listEndpoints(active?: boolean): Promise<EndpointResponse[]> {
    if (this.isInMemoryBackend) {
      const endpoints = Array.from(this.inMemoryEndpoints.values())
        .filter((ep) => active === undefined || ep.active === active)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return endpoints.map((e) => this.toResponseInMemory(e));
    }

    const where: Prisma.EndpointWhereInput = {};
    if (active !== undefined) {
      where.active = active;
    }

    const endpoints = await this.prisma.endpoint.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return endpoints.map(e => this.toResponse(e));
  }

  async updateEndpoint(endpointId: string, dto: UpdateEndpointDto): Promise<EndpointResponse> {
    if (this.isInMemoryBackend) {
      const endpoint = this.inMemoryEndpoints.get(endpointId);
      if (!endpoint) {
        throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
      }

      // Merge config into profile.settings for backward compat
      let newProfile = endpoint.profile as Record<string, unknown> | null;
      if (dto.config) {
        try {
          validateEndpointConfig(dto.config);
        } catch (error) {
          throw new BadRequestException((error as Error).message);
        }
        newProfile = { ...newProfile, settings: { ...(newProfile as any)?.settings, ...dto.config } };
      }

      const updated: InMemoryEndpointRecord = {
        ...endpoint,
        displayName: dto.displayName !== undefined ? dto.displayName ?? null : endpoint.displayName,
        description: dto.description !== undefined ? dto.description ?? null : endpoint.description,
        profile: newProfile,
        active: dto.active !== undefined ? dto.active : endpoint.active,
        updatedAt: new Date(),
      };

      this.inMemoryEndpoints.set(endpointId, updated);
      if (dto.config !== undefined) {
        this.syncEndpointLogLevel(endpointId, dto.config);
      }

      return this.toResponseInMemory(updated);
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

    // Build profile update: merge config into settings for backward compat
    let profileUpdate: any = undefined;
    if (dto.config) {
      try {
        validateEndpointConfig(dto.config);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      const currentProfile = (endpoint.profile as Record<string, any>) ?? {};
      profileUpdate = { ...currentProfile, settings: { ...currentProfile.settings, ...dto.config } };
    }

    const updated = await this.prisma.endpoint.update({
      where: { id: endpointId },
      data: {
        displayName: dto.displayName,
        description: dto.description,
        profile: profileUpdate,
        active: dto.active
      }
    });

    if (dto.config !== undefined) {
      this.syncEndpointLogLevel(endpointId, dto.config);
    }

    return this.toResponse(updated);
  }

  async deleteEndpoint(endpointId: string): Promise<void> {
    if (this.isInMemoryBackend) {
      const endpoint = this.inMemoryEndpoints.get(endpointId);
      if (!endpoint) {
        throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
      }

      this.inMemoryEndpoints.delete(endpointId);
      this.scimLogger.clearEndpointLevel(endpointId);
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

    // Cascade delete: Prisma will handle deletion of associated users, groups, and logs
    await this.prisma.endpoint.delete({
      where: { id: endpointId }
    });

    // Clean up per-endpoint log level override in ScimLogger
    this.scimLogger.clearEndpointLevel(endpointId);
  }

  async getEndpointStats(endpointId: string): Promise<{
    totalUsers: number;
    totalGroups: number;
    totalGroupMembers: number;
    requestLogCount: number;
  }> {
    if (this.isInMemoryBackend) {
      const endpoint = this.inMemoryEndpoints.get(endpointId);
      if (!endpoint) {
        throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
      }

      return {
        totalUsers: 0,
        totalGroups: 0,
        totalGroupMembers: 0,
        requestLogCount: 0,
      };
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

    const [totalUsers, totalGroups, totalGroupMembers, requestLogCount] = await Promise.all([
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'User' } }),
      this.prisma.scimResource.count({ where: { endpointId, resourceType: 'Group' } }),
      this.prisma.resourceMember.count({
        where: { group: { endpointId } }
      }),
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
      config: profile?.settings ?? undefined,
      profile: profile as EndpointProfile | undefined,
      active: endpoint.active,
      scimEndpoint: `/scim/endpoints/${endpoint.id}`,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt
    };
  }

  private toResponseInMemory(endpoint: InMemoryEndpointRecord): EndpointResponse {
    const profile = endpoint.profile as Record<string, any> | null;
    return {
      id: endpoint.id,
      name: endpoint.name,
      displayName: endpoint.displayName || endpoint.name,
      description: endpoint.description ?? undefined,
      config: profile?.settings ?? undefined,
      profile: profile as EndpointProfile | undefined,
      active: endpoint.active,
      scimEndpoint: `/scim/endpoints/${endpoint.id}`,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    };
  }

  /** Backward compat: wrap old config into a minimal profile with settings */
  private configToProfile(config: Record<string, any>): EndpointProfile {
    const preset = getBuiltInPreset(DEFAULT_PRESET_NAME);
    const result = validateAndExpandProfile(preset.profile);
    const profile = result.profile!;
    return { ...profile, settings: { ...profile.settings, ...config } };
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
