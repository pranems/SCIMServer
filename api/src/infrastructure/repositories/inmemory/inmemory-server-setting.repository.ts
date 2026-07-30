/**
 * In-memory repository for the WI-7 server-global settings.
 * Used when PERSISTENCE_BACKEND=inmemory (E2E tests, dev).
 *
 * NOTE: the inmemory backend seeds the same default the Prisma migration seeds
 * (credentialSecretVisibility=always) so behavior matches across backends.
 */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import type { IServerSettingRepository } from '../../../domain/repositories/server-setting.repository.interface';

@Injectable()
export class InMemoryServerSettingRepository implements IServerSettingRepository {
  private readonly store = new Map<string, string>([
    // Parity with the Prisma migration seed.
    ['credentialSecretVisibility', 'always'],
  ]);

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}
