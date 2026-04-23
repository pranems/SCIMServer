/**
 * InMemoryGenericResourceRepository - IGenericResourceRepository backed by an in-memory Map.
 *
 * Phase 8b: Stores custom SCIM resources in memory with resourceType discrimination.
 * Suitable for testing and lightweight deployments without a database.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IGenericResourceRepository } from '../../../domain/repositories/generic-resource.repository.interface';
import type {
  GenericResourceRecord,
  GenericResourceCreateInput,
  GenericResourceUpdateInput,
} from '../../../domain/models/generic-resource.model';
import { matchesPrismaFilter } from './prisma-filter-evaluator';
import { RepositoryError } from '../../../domain/errors/repository-error';

@Injectable()
export class InMemoryGenericResourceRepository implements IGenericResourceRepository {
  private readonly resources: Map<string, GenericResourceRecord> = new Map();

  async create(input: GenericResourceCreateInput): Promise<GenericResourceRecord> {
    const now = new Date();
    const record: GenericResourceRecord = {
      id: randomUUID(),
      endpointId: input.endpointId,
      resourceType: input.resourceType,
      scimId: input.scimId,
      externalId: input.externalId,
      displayName: input.displayName,
      active: input.active,
      rawPayload: input.rawPayload,
      version: 1,
      meta: input.meta,
      createdAt: now,
      updatedAt: now,
    };
    this.resources.set(record.id, record);
    return { ...record };
  }

  async findByScimId(
    endpointId: string,
    resourceType: string,
    scimId: string,
  ): Promise<GenericResourceRecord | null> {
    for (const r of this.resources.values()) {
      if (r.endpointId === endpointId && r.resourceType === resourceType && r.scimId === scimId) {
        return { ...r };
      }
    }
    return null;
  }

  async findAll(
    endpointId: string,
    resourceType: string,
    dbFilter?: Record<string, unknown>,
  ): Promise<GenericResourceRecord[]> {
    let results = Array.from(this.resources.values())
      .filter((r) => r.endpointId === endpointId && r.resourceType === resourceType);

    if (dbFilter && Object.keys(dbFilter).length > 0) {
      results = results.filter((r) =>
        matchesPrismaFilter(r as unknown as Record<string, unknown>, dbFilter),
      );
    }

    return results
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async update(id: string, data: GenericResourceUpdateInput): Promise<GenericResourceRecord> {
    const existing = this.resources.get(id);
    if (!existing) {
      throw new RepositoryError('NOT_FOUND', `GenericResource with id "${id}" not found.`);
    }

    const updated: GenericResourceRecord = {
      ...existing,
      ...data,
      rawPayload: data.rawPayload ?? existing.rawPayload,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.resources.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
    if (!this.resources.has(id)) {
      throw new RepositoryError('NOT_FOUND', `GenericResource with id "${id}" not found.`);
    }
    this.resources.delete(id);
  }

  async findByExternalId(
    endpointId: string,
    resourceType: string,
    externalId: string,
  ): Promise<GenericResourceRecord | null> {
    for (const r of this.resources.values()) {
      if (
        r.endpointId === endpointId &&
        r.resourceType === resourceType &&
        r.externalId === externalId
      ) {
        return { ...r };
      }
    }
    return null;
  }

  async findByDisplayName(
    endpointId: string,
    resourceType: string,
    displayName: string,
  ): Promise<GenericResourceRecord | null> {
    for (const r of this.resources.values()) {
      if (
        r.endpointId === endpointId &&
        r.resourceType === resourceType &&
        r.displayName !== null &&
        r.displayName.toLowerCase() === displayName.toLowerCase()
      ) {
        return { ...r };
      }
    }
    return null;
  }
}
