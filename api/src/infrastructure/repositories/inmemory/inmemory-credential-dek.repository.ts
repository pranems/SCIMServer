/**
 * In-memory repository for the WI-6 credential DEK.
 * Used when PERSISTENCE_BACKEND=inmemory (E2E tests, dev).
 *
 * NOTE: the DEK is regenerated per-process here (inmemory has no durable
 * store), which is correct for the inmemory backend - retained secrets live
 * only for the process lifetime, same as every other inmemory row.
 */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  ICredentialDekRepository,
  CredentialDekModel,
  CredentialDekCreateInput,
} from '../../../domain/repositories/credential-dek.repository.interface';

@Injectable()
export class InMemoryCredentialDekRepository implements ICredentialDekRepository {
  private readonly store = new Map<string, CredentialDekModel>();

  async findActive(): Promise<CredentialDekModel | null> {
    const active = Array.from(this.store.values())
      .filter((d) => d.active)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return active[0] ?? null;
  }

  async create(input: CredentialDekCreateInput): Promise<CredentialDekModel> {
    const model: CredentialDekModel = {
      id: randomUUID(),
      wrappedDek: input.wrappedDek,
      kekSalt: input.kekSalt,
      active: true,
      createdAt: new Date(),
    };
    this.store.set(model.id, model);
    return model;
  }
}
