/**
 * In-memory repository for the WI-15 JWKS host allowlist (persisted layer).
 * Used when PERSISTENCE_BACKEND=inmemory (E2E tests, dev).
 */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { IJwksHostAllowlistRepository } from '../../../domain/repositories/jwks-host-allowlist.repository.interface';
import type { JwksHostAllowlistEntryModel } from '../../../domain/repositories/jwks-host-allowlist.repository.interface';

@Injectable()
export class InMemoryJwksHostAllowlistRepository implements IJwksHostAllowlistRepository {
  private readonly store = new Map<string, JwksHostAllowlistEntryModel>();

  async findAll(): Promise<JwksHostAllowlistEntryModel[]> {
    return Array.from(this.store.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async add(host: string, label: string | null): Promise<JwksHostAllowlistEntryModel> {
    const normalized = host.trim().toLowerCase();
    // Idempotent on the unique host.
    const existing = Array.from(this.store.values()).find((e) => e.host === normalized);
    if (existing) return existing;
    const model: JwksHostAllowlistEntryModel = {
      id: randomUUID(),
      host: normalized,
      label: label ?? null,
      createdAt: new Date(),
    };
    this.store.set(model.id, model);
    return model;
  }

  async removeByHost(host: string): Promise<boolean> {
    const normalized = host.trim().toLowerCase();
    const entry = Array.from(this.store.values()).find((e) => e.host === normalized);
    if (!entry) return false;
    this.store.delete(entry.id);
    return true;
  }

  async update(id: string, host: string, label: string | null): Promise<JwksHostAllowlistEntryModel | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const normalized = host.trim().toLowerCase();
    const updated: JwksHostAllowlistEntryModel = { ...existing, host: normalized, label: label ?? null };
    this.store.set(id, updated);
    return updated;
  }
}
