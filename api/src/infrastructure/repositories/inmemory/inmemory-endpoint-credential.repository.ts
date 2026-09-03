/**
 * In-memory repository for EndpointCredential (Phase 11).
 * Used when PERSISTENCE_BACKEND=inmemory (E2E tests, dev).
 *
 * NOTE: Methods are async to satisfy IEndpointCredentialRepository (Promise<T>
 * return types) even when no await is needed in the in-memory implementation.
 */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { IEndpointCredentialRepository, CredentialAlgoCount } from '../../../domain/repositories/endpoint-credential.repository.interface';
import type { EndpointCredentialModel, EndpointCredentialCreateInput } from '../../../domain/models/endpoint-credential.model';
import { HASH_ALGO_BCRYPT } from '../../../security/credential-token';

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
      secretEnvelope: input.secretEnvelope ?? null,
      active: true,
      createdAt: new Date(),
      expiresAt: input.expiresAt ?? null,
      lookupKey: input.lookupKey ?? null,
      secretHash: input.secretHash ?? null,
      // Mirrors the column default, so an omitted value means the same thing in
      // both backends rather than `undefined` here and 'bcrypt' there.
      hashAlgo: input.hashAlgo ?? 'bcrypt',
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

  // P1 - mirrors the Prisma implementation's active/expiry semantics exactly;
  // a parity gap here would make the fast path behave differently per backend.
  async findActiveByLookupKey(lookupKey: string): Promise<EndpointCredentialModel | null> {
    if (!lookupKey) return null;
    const now = new Date();
    return (
      Array.from(this.store.values()).find(
        (c) =>
          c.lookupKey === lookupKey &&
          c.active &&
          (c.expiresAt === null || c.expiresAt > now),
      ) ?? null
    );
  }

  async findAllActiveByType(credentialType: string): Promise<EndpointCredentialModel[]> {
    const now = new Date();
    return Array.from(this.store.values()).filter(
      (c) =>
        c.credentialType === credentialType &&
        c.active &&
        (c.expiresAt === null || c.expiresAt > now),
    );
  }

  async findById(id: string): Promise<EndpointCredentialModel | null> {
    return this.store.get(id) ?? null;
  }

  async countByHashAlgo(): Promise<CredentialAlgoCount[]> {
    const buckets = new Map<string, CredentialAlgoCount>();
    for (const c of this.store.values()) {
      const algo = c.hashAlgo ?? HASH_ALGO_BCRYPT;
      const key = `${c.endpointId}|${c.credentialType}|${algo}|${c.active}`;
      const hit = buckets.get(key);
      if (hit) {
        hit.count += 1;
      } else {
        buckets.set(key, {
          endpointId: c.endpointId,
          credentialType: c.credentialType,
          hashAlgo: algo,
          active: c.active,
          count: 1,
        });
      }
    }
    return Array.from(buckets.values());
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

  async reactivate(id: string): Promise<EndpointCredentialModel | null> {
    const cred = this.store.get(id);
    if (!cred) return null;
    cred.active = true;
    return cred;
  }

  async clearSecretEnvelopesForEndpoint(endpointId: string): Promise<number> {
    let cleared = 0;
    for (const cred of this.store.values()) {
      if (cred.endpointId === endpointId && cred.secretEnvelope !== null) {
        cred.secretEnvelope = null;
        cleared += 1;
      }
    }
    return cleared;
  }

  async clearAllSecretEnvelopes(): Promise<number> {
    let cleared = 0;
    for (const cred of this.store.values()) {
      if (cred.secretEnvelope !== null) {
        cred.secretEnvelope = null;
        cleared += 1;
      }
    }
    return cleared;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
  ): Promise<EndpointCredentialModel | null> {
    const cred = this.store.get(id);
    if (!cred) return null;
    cred.metadata = metadata;
    return cred;
  }

  async updateLabel(id: string, label: string | null): Promise<EndpointCredentialModel | null> {
    const cred = this.store.get(id);
    if (!cred) return null;
    cred.label = label;
    return cred;
  }
}
