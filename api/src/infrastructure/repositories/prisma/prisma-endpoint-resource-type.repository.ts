/**
 * PrismaEndpointResourceTypeRepository — IEndpointResourceTypeRepository backed by Prisma (PostgreSQL).
 *
 * Phase 8b: Persists per-endpoint custom SCIM resource type registrations in the
 * EndpointResourceType table. Schema extensions are stored as JSONB.
 * The ScimSchemaRegistry loads these on startup to hydrate per-endpoint resource types.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IEndpointResourceTypeRepository } from '../../../domain/repositories/endpoint-resource-type.repository.interface';
import type {
  EndpointResourceTypeRecord,
  EndpointResourceTypeCreateInput,
  ResourceTypeSchemaExtension,
} from '../../../domain/models/endpoint-resource-type.model';

function toRecord(row: Record<string, unknown>): EndpointResourceTypeRecord {
  const rawExtensions = row.schemaExtensions;
  const schemaExtensions: ResourceTypeSchemaExtension[] = Array.isArray(rawExtensions)
    ? (rawExtensions as ResourceTypeSchemaExtension[])
    : [];

  return {
    id: row.id as string,
    endpointId: row.endpointId as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    schemaUri: row.schemaUri as string,
    endpoint: row.endpoint as string,
    schemaExtensions,
    active: row.active as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

@Injectable()
export class PrismaEndpointResourceTypeRepository implements IEndpointResourceTypeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: EndpointResourceTypeCreateInput): Promise<EndpointResourceTypeRecord> {
    const created = await this.prisma.endpointResourceType.create({
      data: {
        endpointId: input.endpointId,
        name: input.name,
        description: input.description ?? null,
        schemaUri: input.schemaUri,
        endpoint: input.endpoint,
        schemaExtensions: (input.schemaExtensions ?? []) as any,
      },
    });
    return toRecord(created as unknown as Record<string, unknown>);
  }

  async findByEndpointId(endpointId: string): Promise<EndpointResourceTypeRecord[]> {
    const rows = await this.prisma.endpointResourceType.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toRecord(r as unknown as Record<string, unknown>));
  }

  async findAll(): Promise<EndpointResourceTypeRecord[]> {
    const rows = await this.prisma.endpointResourceType.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toRecord(r as unknown as Record<string, unknown>));
  }

  async findByEndpointAndName(
    endpointId: string,
    name: string,
  ): Promise<EndpointResourceTypeRecord | null> {
    const row = await this.prisma.endpointResourceType.findUnique({
      where: { endpointId_name: { endpointId, name } },
    });
    return row ? toRecord(row as unknown as Record<string, unknown>) : null;
  }

  async deleteByEndpointAndName(
    endpointId: string,
    name: string,
  ): Promise<boolean> {
    try {
      await this.prisma.endpointResourceType.delete({
        where: { endpointId_name: { endpointId, name } },
      });
      return true;
    } catch {
      return false;
    }
  }

  async deleteByEndpointId(endpointId: string): Promise<number> {
    const result = await this.prisma.endpointResourceType.deleteMany({
      where: { endpointId },
    });
    return result.count;
  }
}
