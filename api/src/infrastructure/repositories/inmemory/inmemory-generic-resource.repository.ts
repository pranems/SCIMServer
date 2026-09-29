/**
 * InMemoryGenericResourceRepository - IGenericResourceRepository backed by an in-memory Map.
 *
 * Phase 8b: Stores custom SCIM resources in memory with resourceType discrimination.
 * Suitable for testing and lightweight deployments without a database.
 *
 * NOTE: Methods are async to satisfy IGenericResourceRepository (Promise<T>
 * return types) even when no await is needed in the in-memory implementation.
 */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IGenericResourceRepository } from '../../../domain/repositories/generic-resource.repository.interface';
import type {
  GenericResourceRecord,
  GenericResourceCreateInput,
  GenericResourceUpdateInput,
} from '../../../domain/models/generic-resource.model';
import { matchesPrismaFilter } from './prisma-filter-evaluator';
import { assertUnique, uniquenessPayload, type UniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';
import { assertWritePrecondition, type ExpectedVersion } from '../../../domain/repositories/write-precondition';
import { InMemoryEndpointWriteGuard } from './inmemory-endpoint-write-guard';
import { prepareMapRemoval, type EndpointDeletionStep } from './endpoint-deletion-step';

@Injectable()
export class InMemoryGenericResourceRepository implements IGenericResourceRepository {
  private resources: Map<string, GenericResourceRecord> = new Map();

  constructor(private readonly writes: InMemoryEndpointWriteGuard = new InMemoryEndpointWriteGuard()) {}

  prepareEndpointDeletion(endpointId: string): EndpointDeletionStep {
    return prepareMapRemoval(this.resources, row => row.endpointId === endpointId, rows => { this.resources = rows; });
  }

  async create(input: GenericResourceCreateInput, uniqueness: UniquenessPolicy = []): Promise<GenericResourceRecord> {
    if (uniqueness.length > 0) assertUnique(uniqueness, uniquenessPayload(input), [...this.resources.values()]
      .filter((r) => r.endpointId === input.endpointId && r.resourceType === input.resourceType).map((r) => uniquenessPayload(r)));
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
    this.writes.assertWritable(input.endpointId);
    this.resources.set(record.id, record);
    return { ...record };
  }

  async findByScimId(
    endpointId: string,
    resourceType: string,
    scimId: string,
  ): Promise<GenericResourceRecord | null> {
    const normalizedScimId = scimId.toLowerCase();
    for (const r of this.resources.values()) {
      if (
        r.endpointId === endpointId
        && r.resourceType === resourceType
        && r.scimId.toLowerCase() === normalizedScimId
      ) {
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

  async update(id: string, data: GenericResourceUpdateInput, expectedVersion?: ExpectedVersion, uniqueness: UniquenessPolicy = []): Promise<GenericResourceRecord> {
    const existing = this.resources.get(id);
    assertWritePrecondition(existing, expectedVersion);
    if (uniqueness.length > 0) assertUnique(uniqueness, uniquenessPayload({ ...existing, ...data }), [...this.resources.values()]
      .filter((r) => r.id !== id && r.endpointId === existing.endpointId && r.resourceType === existing.resourceType).map((r) => uniquenessPayload(r)));

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

  async delete(id: string, expectedVersion?: ExpectedVersion): Promise<void> {
    assertWritePrecondition(this.resources.get(id), expectedVersion);
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
