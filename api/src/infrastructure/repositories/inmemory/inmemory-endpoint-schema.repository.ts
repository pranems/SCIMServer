/**
 * InMemoryEndpointSchemaRepository — IEndpointSchemaRepository backed by an in-memory Map.
 *
 * Phase 6: Stores per-endpoint SCIM schema extensions in memory.
 * Suitable for testing and lightweight deployments without a database.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IEndpointSchemaRepository } from '../../../domain/repositories/endpoint-schema.repository.interface';
import type {
  EndpointSchemaRecord,
  EndpointSchemaCreateInput,
} from '../../../domain/models/endpoint-schema.model';

@Injectable()
export class InMemoryEndpointSchemaRepository implements IEndpointSchemaRepository {
  private readonly schemas: Map<string, EndpointSchemaRecord> = new Map();

  /** Composite key for the unique constraint [endpointId, schemaUrn] */
  private compositeKey(endpointId: string, schemaUrn: string): string {
    return `${endpointId}::${schemaUrn}`;
  }

  async create(input: EndpointSchemaCreateInput): Promise<EndpointSchemaRecord> {
    const key = this.compositeKey(input.endpointId, input.schemaUrn);

    // Enforce unique constraint
    if (this.schemas.has(key)) {
      throw new Error(
        `EndpointSchema already exists for endpoint ${input.endpointId} with URN ${input.schemaUrn}`,
      );
    }

    const now = new Date();
    const record: EndpointSchemaRecord = {
      id: randomUUID(),
      endpointId: input.endpointId,
      schemaUrn: input.schemaUrn,
      name: input.name,
      description: input.description ?? null,
      resourceTypeId: input.resourceTypeId ?? null,
      required: input.required ?? false,
      attributes: input.attributes,
      createdAt: now,
      updatedAt: now,
    };

    this.schemas.set(key, record);
    return { ...record };
  }

  async findByEndpointId(endpointId: string): Promise<EndpointSchemaRecord[]> {
    return Array.from(this.schemas.values())
      .filter((s) => s.endpointId === endpointId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findAll(): Promise<EndpointSchemaRecord[]> {
    return Array.from(this.schemas.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async findByEndpointAndUrn(
    endpointId: string,
    schemaUrn: string,
  ): Promise<EndpointSchemaRecord | null> {
    const key = this.compositeKey(endpointId, schemaUrn);
    const record = this.schemas.get(key);
    return record ? { ...record } : null;
  }

  async deleteByEndpointAndUrn(
    endpointId: string,
    schemaUrn: string,
  ): Promise<boolean> {
    const key = this.compositeKey(endpointId, schemaUrn);
    return this.schemas.delete(key);
  }

  async deleteByEndpointId(endpointId: string): Promise<number> {
    let count = 0;
    for (const [key, record] of this.schemas.entries()) {
      if (record.endpointId === endpointId) {
        this.schemas.delete(key);
        count++;
      }
    }
    return count;
  }
}
