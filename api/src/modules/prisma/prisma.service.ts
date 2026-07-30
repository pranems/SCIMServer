import { Injectable, OnModuleDestroy, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { ScimLogger } from '../logging/scim-logger.service';
import { LogCategory } from '../logging/log-levels';
import { resolveRuntimeConfig } from '../../bootstrap/runtime-config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: pg.Pool;

  @Optional() @Inject(ScimLogger)
  private readonly scimLogger?: ScimLogger;

  constructor() {
    // Phase 3: PostgreSQL via @prisma/adapter-pg (Prisma 7 requires driver adapter).
    const fallback = 'postgresql://scim:scim@localhost:5432/scimdb';
    const effectiveUrl = process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0
      ? process.env.DATABASE_URL
      : fallback;

    if (!process.env.DATABASE_URL) {
      // eslint-disable-next-line no-console
      console.warn(`[PrismaService] DATABASE_URL not set – using fallback '${fallback}'.`);
    }

    // ── Connection pool (X15-F3) ──
    // Prisma 7 requires a driver adapter, so this is a RAW pg.Pool and every
    // option we do not pass takes the `pg` default. That silently dropped a
    // bound that Prisma v6 had: `pg` defaults `connectionTimeoutMillis` to 0,
    // meaning WAIT FOREVER for a connection, where v6 defaulted `pool_timeout`
    // to 10 s. Under pool exhaustion that turned a fast, legible failure into a
    // hung request. Every option is therefore passed EXPLICITLY - never rely on
    // a library default you have not asserted.
    //
    // `max` is a GLOBAL budget, not a local choice: poolMax * maxReplicas must
    // stay under the database's max_connections. Re-derive it whenever the
    // replica ceiling or the DB tier changes.
    const db = resolveRuntimeConfig((k) => process.env[k]).groups.database;
    const pool = new pg.Pool({
      connectionString: effectiveUrl,
      max: db.poolMax.effective as number,
      connectionTimeoutMillis: db.poolAcquireTimeoutMs.effective as number,
      idleTimeoutMillis: db.poolIdleTimeoutMs.effective as number,
    });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['warn', 'error'],
    });

    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    // When using InMemory backend, PostgreSQL may not be available - skip connection
    const backend = process.env.PERSISTENCE_BACKEND?.toLowerCase();
    if (backend === 'inmemory') {
      this.scimLogger?.warn(LogCategory.DATABASE, 'PERSISTENCE_BACKEND=inmemory - skipping PostgreSQL connection');
      return;
    }
    try {
      await this.$connect();
    } catch (error) {
      this.scimLogger?.error(LogCategory.DATABASE, 'PostgreSQL connection failed', error as Error);
      throw error;
    }
    this.scimLogger?.info(LogCategory.DATABASE, 'PostgreSQL connected successfully');
    this.scimLogger?.info(LogCategory.DATABASE, `Using database: ${process.env.DATABASE_URL || 'postgresql://scim:scim@localhost:5432/scimdb (fallback)'}`);
  }

  async onModuleDestroy(): Promise<void> {
    const backend = process.env.PERSISTENCE_BACKEND?.toLowerCase();
    if (backend !== 'inmemory') {
      await this.$disconnect();
    }
    await this.pool.end();
  }
}
