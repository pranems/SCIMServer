/**
 * InMemoryEndpointResourceTypeRepository — IEndpointResourceTypeRepository backed by an in-memory Map.
 *
 * Phase 8b: Stores per-endpoint custom SCIM resource type registrations in memory.
 * Suitable for testing and lightweight deployments without a database.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IEndpointResourceTypeRepository } from '../../../domain/repositories/endpoint-resource-type.repository.interface';
import type {
  EndpointResourceTypeRecord,
  EndpointResourceTypeCreateInput,
} from '../../../domain/models/endpoint-resource-type.model';

@Injectable()
export class InMemoryEndpointResourceTypeRepository implements IEndpointResourceTypeRepository {
  private readonly resourceTypes: Map<string, EndpointResourceTypeRecord> = new Map();

  /** Composite key for the unique constraint [endpointId, name] */
  private compositeKey(endpointId: string, name: string): string {
    return `${endpointId}::${name}`;
  }

  async create(input: EndpointResourceTypeCreateInput): Promise<EndpointResourceTypeRecord> {
    const key = this.compositeKey(input.endpointId, input.name);

    // Enforce unique constraint
    if (this.resourceTypes.has(key)) {
      throw new Error(
        `EndpointResourceType already exists for endpoint ${input.endpointId} with name ${input.name}`,
      );
    }

    // Enforce unique endpoint path constraint
    for (const record of this.resourceTypes.values()) {
      if (record.endpointId === input.endpointId && record.endpoint === input.endpoint) {
        throw new Error(
          `EndpointResourceType with endpoint path "${input.endpoint}" already exists for endpoint ${input.endpointId}`,
        );
      }
    }

    const now = new Date();
    const record: EndpointResourceTypeRecord = {
      id: randomUUID(),
      endpointId: input.endpointId,
      name: input.name,
      description: input.description ?? null,
      schemaUri: input.schemaUri,
      endpoint: input.endpoint,
      schemaExtensions: input.schemaExtensions ?? [],
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    this.resourceTypes.set(key, record);
    return { ...record, schemaExtensions: [...record.schemaExtensions] };
  }

  async findByEndpointId(endpointId: string): Promise<EndpointResourceTypeRecord[]> {
    return Array.from(this.resourceTypes.values())
      .filter((r) => r.endpointId === endpointId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({ ...r, schemaExtensions: [...r.schemaExtensions] }));
  }

  async findAll(): Promise<EndpointResourceTypeRecord[]> {
    return Array.from(this.resourceTypes.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({ ...r, schemaExtensions: [...r.schemaExtensions] }));
  }

  async findByEndpointAndName(
    endpointId: string,
    name: string,
  ): Promise<EndpointResourceTypeRecord | null> {
    const key = this.compositeKey(endpointId, name);
    const record = this.resourceTypes.get(key);
    return record ? { ...record, schemaExtensions: [...record.schemaExtensions] } : null;
  }

  async deleteByEndpointAndName(
    endpointId: string,
    name: string,
  ): Promise<boolean> {
    const key = this.compositeKey(endpointId, name);
    return this.resourceTypes.delete(key);
  }

  async deleteByEndpointId(endpointId: string): Promise<number> {
    let count = 0;
    for (const [key, record] of this.resourceTypes.entries()) {
      if (record.endpointId === endpointId) {
        this.resourceTypes.delete(key);
        count++;
      }
    }
    return count;
  }
}
