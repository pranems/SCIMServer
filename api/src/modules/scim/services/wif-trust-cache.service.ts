import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { SCIM_EVENTS, type ScimEndpointEventPayload } from '../../stats/scim-events';
import { resolveRuntimeConfig } from '../../../bootstrap/runtime-config';

export interface CachedWifTrustSet {
  credentials: readonly EndpointCredentialModel[];
  byIssuer: ReadonlyMap<string, readonly EndpointCredentialModel[]>;
}

interface CacheEntry {
  value: CachedWifTrustSet;
  validUntil: number;
}

@Injectable()
export class WifTrustCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pendingLoads = new Map<string, Promise<CachedWifTrustSet>>();
  private readonly generations = new Map<string, number>();
  private readonly cacheTtlMs: number;
  private readonly maxEndpoints: number;

  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
  ) {
    const authConfig = resolveRuntimeConfig((key) => process.env[key]).groups.auth;
    this.cacheTtlMs = Number(authConfig.wifTrustCacheTtlMs.effective);
    this.maxEndpoints = Number(authConfig.wifTrustCacheMaxEndpoints.effective);
  }

  async get(endpointId: string): Promise<CachedWifTrustSet> {
    const now = Date.now();
    const cached = this.entries.get(endpointId);
    if (cached && cached.validUntil > now) {
      this.entries.delete(endpointId);
      this.entries.set(endpointId, cached);
      return cached.value;
    }

    const pending = this.pendingLoads.get(endpointId);
    if (pending) {
      return pending;
    }

    const generation = this.generations.get(endpointId) ?? 0;
    const load = this.load(endpointId, now, generation);
    this.pendingLoads.set(endpointId, load);
    try {
      return await load;
    } finally {
      if (this.pendingLoads.get(endpointId) === load) {
        this.pendingLoads.delete(endpointId);
      }
    }
  }

  invalidate(endpointId: string): void {
    this.entries.delete(endpointId);
    this.pendingLoads.delete(endpointId);
    this.generations.set(endpointId, (this.generations.get(endpointId) ?? 0) + 1);
  }

  @OnEvent(SCIM_EVENTS.ENDPOINT_DELETED)
  handleEndpointDeleted(payload: ScimEndpointEventPayload): void {
    this.invalidate(payload.endpointId);
  }

  private async load(
    endpointId: string,
    loadedAt: number,
    generation: number,
  ): Promise<CachedWifTrustSet> {
    const credentials = await this.credentialRepo.findActiveByEndpointAndType(endpointId, 'wif');
    const byIssuer = new Map<string, EndpointCredentialModel[]>();

    for (const credential of credentials) {
      const expectedIssuer = credential.metadata?.expectedIssuer;
      if (typeof expectedIssuer !== 'string' || expectedIssuer.length === 0) {
        continue;
      }
      const matching = byIssuer.get(expectedIssuer) ?? [];
      matching.push(credential);
      byIssuer.set(expectedIssuer, matching);
    }

    const nextExpiry = credentials.reduce(
      (earliest, credential) =>
        credential.expiresAt ? Math.min(earliest, credential.expiresAt.getTime()) : earliest,
      loadedAt + this.cacheTtlMs,
    );
    const value: CachedWifTrustSet = { credentials, byIssuer };
    if ((this.generations.get(endpointId) ?? 0) === generation) {
      if (!this.entries.has(endpointId) && this.entries.size >= this.maxEndpoints) {
        const leastRecentlyUsed = this.entries.keys().next().value as string | undefined;
        if (leastRecentlyUsed !== undefined) {
          this.entries.delete(leastRecentlyUsed);
        }
      }
      this.entries.set(endpointId, { value, validUntil: nextExpiry });
    }
    return value;
  }
}
