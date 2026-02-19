import { Injectable, BadRequestException, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import type { Endpoint, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEndpointDto } from '../dto/create-endpoint.dto';
import type { UpdateEndpointDto } from '../dto/update-endpoint.dto';
import { validateEndpointConfig, ENDPOINT_CONFIG_FLAGS } from '../endpoint-config.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { parseLogLevel, logLevelName } from '../../logging/log-levels';

export interface EndpointResponse {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  config?: Record<string, any>;
  active: boolean;
  scimEndpoint: string; // Endpoint-specific SCIM root path
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EndpointService implements OnModuleInit {
  private readonly logger = new Logger(EndpointService.name);

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
    try {
      const endpoints = await this.prisma.endpoint.findMany({
        where: { active: true },
        select: { id: true, name: true, config: true },
      });

      let restored = 0;
      for (const ep of endpoints) {
        if (!ep.config) continue;
        try {
          const config = JSON.parse(ep.config);
          const logLevel = config[ENDPOINT_CONFIG_FLAGS.LOG_LEVEL];
          if (logLevel !== undefined) {
            const level = typeof logLevel === 'number' ? logLevel : parseLogLevel(String(logLevel));
            this.scimLogger.setEndpointLevel(ep.id, level);
            restored++;
            this.logger.log(`Restored log level ${logLevelName(level)} for endpoint "${ep.name}" (${ep.id})`);
          }
        } catch {
          // Skip endpoints with malformed config JSON
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

    // Validate endpoint config values
    try {
      validateEndpointConfig(dto.config);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    // Check if endpoint already exists
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
        config: dto.config ? JSON.stringify(dto.config) : null,
        active: true
      }
    });

    // Sync per-endpoint log level to ScimLogger
    this.syncEndpointLogLevel(endpoint.id, dto.config);

    return this.toResponse(endpoint);
  }

  async getEndpoint(endpointId: string): Promise<EndpointResponse> {
    const endpoint = await this.prisma.endpoint.findUnique({
      where: { id: endpointId }
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    return this.toResponse(endpoint);
  }

  async getEndpointByName(name: string): Promise<EndpointResponse> {
    const endpoint = await this.prisma.endpoint.findUnique({
      where: { name }
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with name "${name}" not found`);
    }

    return this.toResponse(endpoint);
  }

  async listEndpoints(active?: boolean): Promise<EndpointResponse[]> {
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
    const endpoint = await this.prisma.endpoint.findUnique({
      where: { id: endpointId }
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    // Validate endpoint config values
    try {
      validateEndpointConfig(dto.config);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const updated = await this.prisma.endpoint.update({
      where: { id: endpointId },
      data: {
        displayName: dto.displayName,
        description: dto.description,
        config: dto.config ? JSON.stringify(dto.config) : undefined,
        active: dto.active
      }
    });

    // Sync per-endpoint log level (only when config was provided in the update)
    if (dto.config !== undefined) {
      this.syncEndpointLogLevel(endpointId, dto.config);
    }

    return this.toResponse(updated);
  }

  async deleteEndpoint(endpointId: string): Promise<void> {
    const endpoint = await this.prisma.endpoint.findUnique({
      where: { id: endpointId }
    });

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
    const endpoint = await this.prisma.endpoint.findUnique({
      where: { id: endpointId }
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID "${endpointId}" not found`);
    }

    const [totalUsers, totalGroups, totalGroupMembers, requestLogCount] = await Promise.all([
      this.prisma.scimUser.count({ where: { endpointId } }),
      this.prisma.scimGroup.count({ where: { endpointId } }),
      this.prisma.groupMember.count({
        where: { group: { endpointId } }
      }),
      this.prisma.requestLog.count({ where: { endpointId } })
    ]);

    return { totalUsers, totalGroups, totalGroupMembers, requestLogCount };
  }

  private toResponse(endpoint: Endpoint): EndpointResponse {
    return {
      id: endpoint.id,
      name: endpoint.name,
      displayName: endpoint.displayName || endpoint.name,
      description: endpoint.description ?? undefined,
      config: endpoint.config ? JSON.parse(endpoint.config) : undefined,
      active: endpoint.active,
      scimEndpoint: `/scim/endpoints/${endpoint.id}`,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt
    };
  }

  /**
   * Sync per-endpoint log level from endpoint config to ScimLogger.
   * If config contains logLevel, sets the endpoint-level override.
   * If logLevel is absent or config is null/undefined, clears any existing override.
   */
  private syncEndpointLogLevel(endpointId: string, config?: Record<string, any> | null): void {
    const logLevelValue = config?.[ENDPOINT_CONFIG_FLAGS.LOG_LEVEL];
    if (logLevelValue !== undefined) {
      const level = typeof logLevelValue === 'number'
        ? logLevelValue
        : parseLogLevel(String(logLevelValue));
      this.scimLogger.setEndpointLevel(endpointId, level);
      this.logger.log(`Set log level ${logLevelName(level)} for endpoint ${endpointId}`);
    } else {
      // logLevel not in config — clear any existing override
      this.scimLogger.clearEndpointLevel(endpointId);
    }
  }
}
