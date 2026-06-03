/**
 * PrismaGenericResourceRepository - IGenericResourceRepository backed by Prisma (PostgreSQL).
 *
 * Phase 8b: Queries the unified `ScimResource` table with the custom resourceType
 * discriminator. JSONB payload contains all resource attributes.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IGenericResourceRepository } from '../../../domain/repositories/generic-resource.repository.interface';
import type {
  GenericResourceRecord,
  GenericResourceCreateInput,
  GenericResourceUpdateInput,
} from '../../../domain/models/generic-resource.model';
import type { Prisma } from '../../../generated/prisma/client';
import { isValidUuid } from './uuid-guard';
import { wrapPrismaError } from './prisma-error.util';

/** Maps a ScimResource row to the GenericResourceRecord domain type. */
function toGenericRecord(resource: Record<string, unknown>): GenericResourceRecord {
  const payload = resource.payload;
  const rawPayload = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return {
    id: resource.id as string,
    endpointId: resource.endpointId as string,
    resourceType: resource.resourceType as string,
    scimId: resource.scimId as string,
    externalId: (resource.externalId as string) ?? null,
    displayName: (resource.displayName as string) ?? null,
    active: resource.active as boolean,
    rawPayload,
    version: (resource.version as number) ?? 1,
    meta: (resource.meta as string) ?? null,
    createdAt: resource.createdAt as Date,
    updatedAt: resource.updatedAt as Date,
  };
}

@Injectable()
export class PrismaGenericResourceRepository implements IGenericResourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: GenericResourceCreateInput): Promise<GenericResourceRecord> {
    try {
      const created = await this.prisma.scimResource.create({
        data: {
          resourceType: input.resourceType,
          scimId: input.scimId,
          externalId: input.externalId,
          displayName: input.displayName,
          active: input.active,
          payload: JSON.parse(input.rawPayload),
          meta: input.meta,
          endpoint: { connect: { id: input.endpointId } },
        },
      });
      return toGenericRecord(created as unknown as Record<string, unknown>);
    } catch (error) {
      throw wrapPrismaError(error, `GenericResource create(${input.scimId})`);
    }
  }

  async findByScimId(
    endpointId: string,
    resourceType: string,
    scimId: string,
  ): Promise<GenericResourceRecord | null> {
    if (!isValidUuid(scimId)) return null;
    try {
      const resource = await this.prisma.scimResource.findFirst({
        where: { scimId, endpointId, resourceType },
      });
      return resource ? toGenericRecord(resource as unknown as Record<string, unknown>) : null;
    } catch (error) {
      throw wrapPrismaError(error, `GenericResource findByScimId(${scimId})`);
    }
  }

  async findAll(
    endpointId: string,
    resourceType: string,
    dbFilter?: Record<string, unknown>,
  ): Promise<GenericResourceRecord[]> {
    const where: Prisma.ScimResourceWhereInput = {
      ...(dbFilter as Prisma.ScimResourceWhereInput),
      endpointId,
      resourceType,
    };
    try {
      const resources = await this.prisma.scimResource.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });
      return resources.map((r) => toGenericRecord(r as unknown as Record<string, unknown>));
    } catch (error) {
      throw wrapPrismaError(error, `GenericResource findAll(${endpointId}, ${resourceType})`);
    }
  }

  async update(id: string, data: GenericResourceUpdateInput): Promise<GenericResourceRecord> {
    const prismaData: Record<string, unknown> = { ...data };
    if (data.rawPayload !== undefined) {
      prismaData.payload = JSON.parse(data.rawPayload);
      delete prismaData.rawPayload;
    }
    prismaData.version = { increment: 1 };
    try {
      const updated = await this.prisma.scimResource.update({
        where: { id },
        data: prismaData as Prisma.ScimResourceUpdateInput,
      });
      return toGenericRecord(updated as unknown as Record<string, unknown>);
    } catch (error) {
      throw wrapPrismaError(error, `GenericResource update(${id})`);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.scimResource.delete({ where: { id } });
    } catch (error) {
      throw wrapPrismaError(error, `GenericResource delete(${id})`);
    }
  }

  async findByExternalId(
    endpointId: string,
    resourceType: string,
    externalId: string,
  ): Promise<GenericResourceRecord | null> {
    try {
      const resource = await this.prisma.scimResource.findFirst({
        where: { endpointId, resourceType, externalId },
      });
      return resource ? toGenericRecord(resource as unknown as Record<string, unknown>) : null;
    } catch (error) {
      throw wrapPrismaError(error, `GenericResource findByExternalId(${endpointId}, ${externalId})`);
    }
  }

  async findByDisplayName(
    endpointId: string,
    resourceType: string,
    displayName: string,
  ): Promise<GenericResourceRecord | null> {
    try {
      const resource = await this.prisma.scimResource.findFirst({
        where: { endpointId, resourceType, displayName },
      });
      return resource ? toGenericRecord(resource as unknown as Record<string, unknown>) : null;
    } catch (error) {
      throw wrapPrismaError(error, `GenericResource findByDisplayName(${endpointId}, ${displayName})`);
    }
  }
}
