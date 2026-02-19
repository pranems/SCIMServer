import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Provide a safe fallback for test / CI environments where DATABASE_URL is not injected.
    const fallback = 'file:./dev.db';
    const effectiveUrl = process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0
      ? process.env.DATABASE_URL
      : fallback;

    if (!process.env.DATABASE_URL) {
      // Surface a single clear warning but continue so tests / local builds don't explode.
      // In production (container) DATABASE_URL is always set via Dockerfile/ENV.
      // eslint-disable-next-line no-console
      console.warn(`[PrismaService] DATABASE_URL not set – using fallback '${fallback}'.`);
    }

    // Prisma 7: Use better-sqlite3 driver adapter (Rust-free, faster, smaller bundle)
    const adapter = new PrismaBetterSqlite3({ url: effectiveUrl });

    super({
      adapter,
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    // Enable WAL journal mode and set busy timeout for better concurrent write handling.
    // SQLite compromise (CRITICAL): SQLite allows only ONE writer at a time. WAL mode
    // lets readers proceed during writes but does NOT enable concurrent writers.
    // busy_timeout=15000 makes a blocked writer wait up to 15s instead of failing immediately.
    // PostgreSQL migration: remove these PRAGMAs entirely — MVCC provides true concurrent writes.
    // See docs/SQLITE_COMPROMISE_ANALYSIS.md §3.2.1
    try {
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await this.$queryRawUnsafe('PRAGMA busy_timeout = 15000;');
      this.logger.log('SQLite PRAGMAs set: journal_mode=WAL, busy_timeout=15000');
    } catch (err) {
      // Non-fatal: if the database is not SQLite (e.g. tests with in-memory), silently skip.
      this.logger.warn(`Could not set SQLite PRAGMAs: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.logger.log('Database connected successfully');
    this.logger.log(`Using database: ${process.env.DATABASE_URL || 'file:./dev.db (fallback)'}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
