import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: pg.Pool;

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

    const pool = new pg.Pool({ connectionString: effectiveUrl, max: 5 });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['warn', 'error'],
    });

    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    // When using InMemory backend, PostgreSQL may not be available — skip connection
    const backend = process.env.PERSISTENCE_BACKEND?.toLowerCase();
    if (backend === 'inmemory') {
      this.logger.warn('PERSISTENCE_BACKEND=inmemory — skipping PostgreSQL connection');
      return;
    }
    await this.$connect();
    this.logger.log('PostgreSQL connected successfully');
    this.logger.log(`Using database: ${process.env.DATABASE_URL || 'postgresql://scim:scim@localhost:5432/scimdb (fallback)'}`);
  }

  async onModuleDestroy(): Promise<void> {
    const backend = process.env.PERSISTENCE_BACKEND?.toLowerCase();
    if (backend !== 'inmemory') {
      await this.$disconnect();
    }
    await this.pool.end();
  }
}
