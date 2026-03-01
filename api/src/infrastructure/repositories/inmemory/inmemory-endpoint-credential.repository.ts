/**
 * In-memory repository for EndpointCredential (Phase 11).
 * Used when PERSISTENCE_BACKEND=inmemory (E2E tests, dev).
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import type { EndpointCredentialModel, EndpointCredentialCreateInput } from '../../../domain/models/endpoint-credential.model';

@Injectable()
export class InMemoryEndpointCredentialRepository implements IEndpointCredentialRepository {
  private readonly store = new Map<string, EndpointCredentialModel>();

  async create(input: EndpointCredentialCreateInput): Promise<EndpointCredentialModel> {
    const model: EndpointCredentialModel = {
      id: randomUUID(),
      endpointId: input.endpointId,
      credentialType: input.credentialType,
      credentialHash: input.credentialHash,
      label: input.label ?? null,
      metadata: input.metadata ?? null,
      active: true,
      createdAt: new Date(),
      expiresAt: input.expiresAt ?? null,
    };
    this.store.set(model.id, model);
    return model;
  }

  async findActiveByEndpoint(endpointId: string): Promise<EndpointCredentialModel[]> {
    const now = new Date();
    return Array.from(this.store.values()).filter(
      (c) =>
        c.endpointId === endpointId &&
        c.active &&
        (c.expiresAt === null || c.expiresAt > now),
    );
  }

  async findById(id: string): Promise<EndpointCredentialModel | null> {
    return this.store.get(id) ?? null;
  }

  async findByEndpoint(endpointId: string): Promise<EndpointCredentialModel[]> {
    return Array.from(this.store.values())
      .filter((c) => c.endpointId === endpointId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deactivate(id: string): Promise<EndpointCredentialModel | null> {
    const cred = this.store.get(id);
    if (!cred) return null;
    cred.active = false;
    return cred;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
