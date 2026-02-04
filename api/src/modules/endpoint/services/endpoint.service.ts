import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Endpoint, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEndpointDto } from '../dto/create-endpoint.dto';
import type { UpdateEndpointDto } from '../dto/update-endpoint.dto';
import { validateEndpointConfig } from '../endpoint-config.interface';

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
export class EndpointService {
  constructor(private readonly prisma: PrismaService) {}

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
}
