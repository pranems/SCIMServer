/**
 * purge-health-logs.ts
 *
 * Deletes RequestLog rows whose URL matches a LIKE pattern (default
 * '/scim/health%') from a target PostgreSQL.
 *
 * Inputs (env):
 *   TARGET_DATABASE_URL  - required, the connection string to operate on
 *   URL_PATTERN          - optional, default '/scim/health%'
 *   DRY_RUN=1            - count only, do not delete
 *
 * Run:
 *   $env:TARGET_DATABASE_URL = "postgresql://..."
 *   pnpm --filter ./api exec ts-node --transpile-only src/scripts/purge-health-logs.ts
 */
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const TARGET_URL = process.env.TARGET_DATABASE_URL;
if (!TARGET_URL) {
  throw new Error('TARGET_DATABASE_URL must be set');
}
const PATTERN = process.env.URL_PATTERN ?? '/scim/health%';
const DRY_RUN = process.env.DRY_RUN === '1';

function maskUrl(u: string): string {
  return u.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

async function main(): Promise<void> {
  console.log('=================================================================');
  console.log(' purge-health-logs');
  console.log(`   target  : ${maskUrl(TARGET_URL!)}`);
  console.log(`   pattern : ${PATTERN}`);
  console.log(`   dry run : ${DRY_RUN}`);
  console.log('=================================================================');

  const pool = new pg.Pool({ connectionString: TARGET_URL, max: 2 });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter, log: ['warn', 'error'] });

  try {
    await db.$connect();
    const before = await db.requestLog.count({ where: { url: { startsWith: PATTERN.replace('%', '') } } });
    console.log(`[count] rows matching url LIKE '${PATTERN}': ${before}`);

    if (DRY_RUN) {
      console.log('[dry-run] no rows deleted');
      return;
    }
    if (before === 0) {
      console.log('[skip] nothing to delete');
      return;
    }

    const startedAt = Date.now();
    const result = await db.$executeRawUnsafe(
      `DELETE FROM "RequestLog" WHERE "url" LIKE $1`,
      PATTERN,
    );
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[delete] removed ${result} rows in ${elapsed}s`);

    const after = await db.requestLog.count({ where: { url: { startsWith: PATTERN.replace('%', '') } } });
    console.log(`[verify] rows remaining matching pattern: ${after}`);
  } finally {
    await db.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  console.error('[purge-health-logs] FATAL', err);
  process.exit(1);
});
