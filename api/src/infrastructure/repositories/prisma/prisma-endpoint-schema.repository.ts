/**
 * PrismaEndpointSchemaRepository — IEndpointSchemaRepository backed by Prisma (PostgreSQL).
 *
 * Phase 6: Persists per-endpoint SCIM schema extensions in the EndpointSchema table.
 * Attributes are stored as JSONB. The ScimSchemaRegistry loads these on startup.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IEndpointSchemaRepository } from '../../../domain/repositories/endpoint-schema.repository.interface';
import type {
  EndpointSchemaRecord,
  EndpointSchemaCreateInput,
} from '../../../domain/models/endpoint-schema.model';

function toRecord(row: Record<string, unknown>): EndpointSchemaRecord {
  return {
    id: row.id as string,
    endpointId: row.endpointId as string,
    schemaUrn: row.schemaUrn as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    resourceTypeId: (row.resourceTypeId as string) ?? null,
    required: row.required as boolean,
    attributes: row.attributes,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

@Injectable()
export class PrismaEndpointSchemaRepository implements IEndpointSchemaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: EndpointSchemaCreateInput): Promise<EndpointSchemaRecord> {
    const created = await this.prisma.endpointSchema.create({
      data: {
        endpointId: input.endpointId,
        schemaUrn: input.schemaUrn,
        name: input.name,
        description: input.description ?? null,
        resourceTypeId: input.resourceTypeId ?? null,
        required: input.required ?? false,
        attributes: input.attributes as any,
      },
    });
    return toRecord(created as unknown as Record<string, unknown>);
  }

  async findByEndpointId(endpointId: string): Promise<EndpointSchemaRecord[]> {
    const rows = await this.prisma.endpointSchema.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toRecord(r as unknown as Record<string, unknown>));
  }

  async findAll(): Promise<EndpointSchemaRecord[]> {
    const rows = await this.prisma.endpointSchema.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toRecord(r as unknown as Record<string, unknown>));
  }

  async findByEndpointAndUrn(
    endpointId: string,
    schemaUrn: string,
  ): Promise<EndpointSchemaRecord | null> {
    const row = await this.prisma.endpointSchema.findUnique({
      where: { endpointId_schemaUrn: { endpointId, schemaUrn } },
    });
    return row ? toRecord(row as unknown as Record<string, unknown>) : null;
  }

  async deleteByEndpointAndUrn(
    endpointId: string,
    schemaUrn: string,
  ): Promise<boolean> {
    try {
      await this.prisma.endpointSchema.delete({
        where: { endpointId_schemaUrn: { endpointId, schemaUrn } },
      });
      return true;
    } catch {
      return false;
    }
  }

  async deleteByEndpointId(endpointId: string): Promise<number> {
    const result = await this.prisma.endpointSchema.deleteMany({
      where: { endpointId },
    });
    return result.count;
  }
}
