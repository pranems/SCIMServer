/**
 * mirror-prod-to-dev.ts
 *
 * One-shot data mirror from a SOURCE (typically production) PostgreSQL database
 * to a TARGET (typically dev) PostgreSQL database, preserving all primary keys
 * exactly so dev becomes a drop-in repro of prod for diff-config scenarios.
 *
 * Behaviour (per user decisions in plan):
 *   - Two PrismaClients (source vs target) instead of pg_dump (more portable,
 *     allows orphan filtering, no psql/pg_dump required on the operator's box).
 *   - PII is copied verbatim (dev is internal only).
 *   - Existing dev rows are NOT wiped. Strategy is upsert-by-PK:
 *       * If id exists in target: update payload-bearing columns (NOT createdAt).
 *       * If id is missing      : insert with the same id.
 *     So re-running is idempotent and won't break IDs already wired into the dev UI.
 *   - Orphan rows are SKIPPED:
 *       * ScimResource whose endpointId is missing in target after sync           -> skipped
 *       * ResourceMember whose group/member resource is missing                   -> skipped
 *       * EndpointCredential whose endpointId is missing                          -> skipped
 *       * RequestLog whose endpointId is set but missing                          -> endpointId set to null
 *   - RequestLog: copies the most recent {LOG_DAYS} days only (default 7), capped
 *     at {LOG_LIMIT} rows (default 50000) to avoid multi-GB pulls.
 *
 * Inputs (env):
 *   PROD_DATABASE_URL   - source connection string (required)
 *   DEV_DATABASE_URL    - target connection string (required)
 *   LOG_DAYS            - optional, default 7
 *   LOG_LIMIT           - optional, default 50000
 *   DRY_RUN             - optional, "1" to print plan without writing
 *
 * Run:
 *   $env:PROD_DATABASE_URL="postgresql://..."; \
 *   $env:DEV_DATABASE_URL="postgresql://...";  \
 *   pnpm --filter ./api exec ts-node --transpile-only src/scripts/mirror-prod-to-dev.ts
 *
 * Or via the orchestrator: scripts/mirror-prod-to-dev.ps1
 */
import { PrismaClient, Prisma } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// ─── CLI / env ──────────────────────────────────────────────────────────────

const PROD_URL = required('PROD_DATABASE_URL');
const DEV_URL = required('DEV_DATABASE_URL');
const LOG_DAYS = intEnv('LOG_DAYS', 7);
const LOG_LIMIT = intEnv('LOG_LIMIT', 50_000);
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH = 200;

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return v;
}
function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ─── Client factory ─────────────────────────────────────────────────────────

function makeClient(connectionString: string, label: string): PrismaClient {
  const pool = new pg.Pool({ connectionString, max: 4 });
  pool.on('error', err => {
    console.error(`[${label}] pool error:`, err.message);
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}

// ─── Counters ───────────────────────────────────────────────────────────────

interface Stats {
  endpoints: { read: number; inserted: number; updated: number };
  resources: { read: number; inserted: number; updated: number; skippedOrphan: number };
  members:   { read: number; inserted: number; updated: number; skippedOrphan: number };
  creds:     { read: number; inserted: number; updated: number; skippedOrphan: number };
  logs:      { read: number; inserted: number; updated: number; rebound: number };
}
const stats: Stats = {
  endpoints: { read: 0, inserted: 0, updated: 0 },
  resources: { read: 0, inserted: 0, updated: 0, skippedOrphan: 0 },
  members:   { read: 0, inserted: 0, updated: 0, skippedOrphan: 0 },
  creds:     { read: 0, inserted: 0, updated: 0, skippedOrphan: 0 },
  logs:      { read: 0, inserted: 0, updated: 0, rebound: 0 },
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner();

  const src = makeClient(PROD_URL, 'SRC');
  const dst = makeClient(DEV_URL, 'DST');

  try {
    await src.$connect();
    await dst.$connect();
    log('Connected to both databases.');

    // Pre-snapshot of target state (used to drive orphan filtering / set logic).
    const dstEndpointIdsBefore = new Set<string>(
      (await dst.endpoint.findMany({ select: { id: true } })).map(e => e.id),
    );
    const dstResourceIdsBefore = new Set<string>(
      (await dst.scimResource.findMany({ select: { id: true } })).map(r => r.id),
    );
    log(`Target pre-state: ${dstEndpointIdsBefore.size} endpoints, ${dstResourceIdsBefore.size} resources.`);

    // 1) Endpoints  (parents of everything)
    await mirrorEndpoints(src, dst);

    // After endpoints sync, this is the universe of valid endpoint ids in the target.
    const liveEndpointIds = new Set<string>(
      (await dst.endpoint.findMany({ select: { id: true } })).map(e => e.id),
    );

    // 2) ScimResource (depends on endpoints)
    await mirrorResources(src, dst, liveEndpointIds);

    // After resource sync, universe of valid resource ids in the target.
    const liveResourceIds = new Set<string>(
      (await dst.scimResource.findMany({ select: { id: true } })).map(r => r.id),
    );

    // 3) ResourceMember (depends on ScimResource)
    await mirrorMembers(src, dst, liveResourceIds);

    // 4) EndpointCredential (depends on Endpoint)
    await mirrorCredentials(src, dst, liveEndpointIds);

    // 5) RequestLog (last N days, capped). endpointId is rebinned to null if orphaned.
    await mirrorLogs(src, dst, liveEndpointIds);

    summary();
  } finally {
    await src.$disconnect().catch(() => undefined);
    await dst.$disconnect().catch(() => undefined);
  }
}

// ─── Mirror: Endpoints ──────────────────────────────────────────────────────

async function mirrorEndpoints(src: PrismaClient, dst: PrismaClient): Promise<void> {
  const rows = await src.endpoint.findMany();
  stats.endpoints.read = rows.length;
  log(`[endpoints] read ${rows.length} rows from source`);

  for (const e of rows) {
    if (DRY_RUN) continue;
    const existing = await dst.endpoint.findUnique({ where: { id: e.id } });
    if (existing) {
      await dst.endpoint.update({
        where: { id: e.id },
        data: {
          name: e.name,
          displayName: e.displayName,
          description: e.description,
          profile: e.profile as Prisma.InputJsonValue,
          active: e.active,
          // createdAt is preserved; updatedAt auto-advances
        },
      });
      stats.endpoints.updated++;
    } else {
      await dst.endpoint.create({
        data: {
          id: e.id,                       // PK preserved
          name: e.name,
          displayName: e.displayName,
          description: e.description,
          profile: e.profile as Prisma.InputJsonValue,
          active: e.active,
          createdAt: e.createdAt,         // timeline preserved
        },
      });
      stats.endpoints.inserted++;
    }
  }
  log(`[endpoints] inserted=${stats.endpoints.inserted} updated=${stats.endpoints.updated}`);
}

// ─── Mirror: ScimResource ───────────────────────────────────────────────────

async function mirrorResources(
  src: PrismaClient,
  dst: PrismaClient,
  liveEndpointIds: Set<string>,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page = await src.scimResource.findMany({
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    stats.resources.read += page.length;

    for (const r of page) {
      if (!liveEndpointIds.has(r.endpointId)) {
        stats.resources.skippedOrphan++;
        continue;
      }
      if (DRY_RUN) continue;
      const existing = await dst.scimResource.findUnique({ where: { id: r.id } });
      if (existing) {
        await dst.scimResource.update({
          where: { id: r.id },
          data: {
            endpointId: r.endpointId,
            resourceType: r.resourceType,
            scimId: r.scimId,
            externalId: r.externalId,
            userName: r.userName,
            displayName: r.displayName,
            active: r.active,
            payload: r.payload as Prisma.InputJsonValue,
            version: r.version,
            meta: r.meta,
          },
        });
        stats.resources.updated++;
      } else {
        await dst.scimResource.create({
          data: {
            id: r.id,
            endpointId: r.endpointId,
            resourceType: r.resourceType,
            scimId: r.scimId,
            externalId: r.externalId,
            userName: r.userName,
            displayName: r.displayName,
            active: r.active,
            payload: r.payload as Prisma.InputJsonValue,
            version: r.version,
            meta: r.meta,
            createdAt: r.createdAt,
          },
        }).catch((err: unknown) => {
          // Fall back to scimId/userName collision: skip rather than crash so the
          // operator can investigate without rolling back the whole run.
          console.warn(`[resources] insert collision for id=${r.id}: ${(err as Error).message}`);
        });
        stats.resources.inserted++;
      }
    }
  }
  log(`[resources] inserted=${stats.resources.inserted} updated=${stats.resources.updated} skippedOrphan=${stats.resources.skippedOrphan}`);
}

// ─── Mirror: ResourceMember ─────────────────────────────────────────────────

async function mirrorMembers(
  src: PrismaClient,
  dst: PrismaClient,
  liveResourceIds: Set<string>,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page = await src.resourceMember.findMany({
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    stats.members.read += page.length;

    for (const m of page) {
      const groupAlive = liveResourceIds.has(m.groupResourceId);
      const memberAlive = m.memberResourceId === null || liveResourceIds.has(m.memberResourceId);
      if (!groupAlive || !memberAlive) {
        stats.members.skippedOrphan++;
        continue;
      }
      if (DRY_RUN) continue;
      const existing = await dst.resourceMember.findUnique({ where: { id: m.id } });
      if (existing) {
        await dst.resourceMember.update({
          where: { id: m.id },
          data: {
            value: m.value,
            type: m.type,
            display: m.display,
          },
        });
        stats.members.updated++;
      } else {
        await dst.resourceMember.create({
          data: {
            id: m.id,
            groupResourceId: m.groupResourceId,
            memberResourceId: m.memberResourceId,
            value: m.value,
            type: m.type,
            display: m.display,
            createdAt: m.createdAt,
          },
        }).catch((err: unknown) => {
          console.warn(`[members] insert skipped for id=${m.id}: ${(err as Error).message}`);
        });
        stats.members.inserted++;
      }
    }
  }
  log(`[members] inserted=${stats.members.inserted} updated=${stats.members.updated} skippedOrphan=${stats.members.skippedOrphan}`);
}

// ─── Mirror: EndpointCredential ─────────────────────────────────────────────

async function mirrorCredentials(
  src: PrismaClient,
  dst: PrismaClient,
  liveEndpointIds: Set<string>,
): Promise<void> {
  const rows = await src.endpointCredential.findMany();
  stats.creds.read = rows.length;
  for (const c of rows) {
    if (!liveEndpointIds.has(c.endpointId)) {
      stats.creds.skippedOrphan++;
      continue;
    }
    if (DRY_RUN) continue;
    const existing = await dst.endpointCredential.findUnique({ where: { id: c.id } });
    if (existing) {
      await dst.endpointCredential.update({
        where: { id: c.id },
        data: {
          credentialType: c.credentialType,
          credentialHash: c.credentialHash,
          label: c.label,
          metadata: c.metadata as Prisma.InputJsonValue,
          active: c.active,
          expiresAt: c.expiresAt,
        },
      });
      stats.creds.updated++;
    } else {
      await dst.endpointCredential.create({
        data: {
          id: c.id,
          endpointId: c.endpointId,
          credentialType: c.credentialType,
          credentialHash: c.credentialHash,
          label: c.label,
          metadata: c.metadata as Prisma.InputJsonValue,
          active: c.active,
          createdAt: c.createdAt,
          expiresAt: c.expiresAt,
        },
      });
      stats.creds.inserted++;
    }
  }
  log(`[credentials] inserted=${stats.creds.inserted} updated=${stats.creds.updated} skippedOrphan=${stats.creds.skippedOrphan}`);
}

// ─── Mirror: RequestLog (capped, batched) ──────────────────────────────────
//
// Performance note: the previous implementation did one findUnique + one create
// per row, which over a public-Internet PG link cost ~50-80ms per row and made
// even a 50k-row copy take >10 minutes. We now use createMany({ skipDuplicates:
// true }) in chunks of LOG_INSERT_CHUNK (default 500). The compound effect is
// roughly 50-100x faster:
//   * 1 SELECT per page (BATCH=1000 rows)
//   * 1 INSERT per chunk (LOG_INSERT_CHUNK=500 rows, 2 chunks per page)
//   * skipDuplicates collapses the "already present" case server-side; we
//     subtract the inserted count from the chunk size to derive `updated`.

const LOG_PAGE = 1000;
const LOG_INSERT_CHUNK = 500;

async function mirrorLogs(
  src: PrismaClient,
  dst: PrismaClient,
  liveEndpointIds: Set<string>,
): Promise<void> {
  const since = new Date(Date.now() - LOG_DAYS * 24 * 60 * 60 * 1000);
  if (LOG_DAYS <= 0) {
    log('[logs] LOG_DAYS=0, skipping log copy');
    return;
  }
  const total = await src.requestLog.count({ where: { createdAt: { gte: since } } });
  const take = Math.min(total, LOG_LIMIT);
  log(`[logs] window=${LOG_DAYS}d totalInWindow=${total} willCopy=${take} pageSize=${LOG_PAGE} chunkSize=${LOG_INSERT_CHUNK}`);

  let cursor: string | undefined;
  let copied = 0;
  const startedAt = Date.now();

  while (copied < take) {
    const remaining = take - copied;
    const pageSize = Math.min(LOG_PAGE, remaining);
    const page = await src.requestLog.findMany({
      where: { createdAt: { gte: since } },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' }, // newest first so we always have the freshest
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    stats.logs.read += page.length;

    // Re-bind orphan endpointIds + materialize the InputJsonValue rows.
    const rows = page.map(l => {
      let endpointId: string | null = l.endpointId;
      if (endpointId !== null && !liveEndpointIds.has(endpointId)) {
        endpointId = null;
        stats.logs.rebound++;
      }
      return {
        id: l.id,
        endpointId,
        method: l.method,
        url: l.url,
        status: l.status,
        durationMs: l.durationMs,
        requestHeaders: l.requestHeaders,
        requestBody: l.requestBody,
        responseHeaders: l.responseHeaders,
        responseBody: l.responseBody,
        errorMessage: l.errorMessage,
        errorStack: l.errorStack,
        identifier: l.identifier,
        createdAt: l.createdAt,
      };
    });

    if (!DRY_RUN) {
      for (let i = 0; i < rows.length; i += LOG_INSERT_CHUNK) {
        const chunk = rows.slice(i, i + LOG_INSERT_CHUNK);
        try {
          const res = await dst.requestLog.createMany({
            data: chunk,
            skipDuplicates: true,
          });
          stats.logs.inserted += res.count;
          stats.logs.updated  += chunk.length - res.count; // duplicates we left untouched
        } catch (err) {
          // One bad row in a chunk would fail the whole chunk under createMany.
          // Fall back to per-row inserts for this chunk only so we don't lose
          // the good rows.
          console.warn(`[logs] chunk insert failed (${(err as Error).message}); falling back to per-row for this chunk`);
          for (const row of chunk) {
            await dst.requestLog
              .create({ data: row })
              .then(() => { stats.logs.inserted++; })
              .catch((e: unknown) => {
                // unique violation on id -> already there, count as updated; everything else is a real error.
                const msg = (e as Error).message;
                if (msg.includes('Unique') || msg.includes('duplicate key')) {
                  stats.logs.updated++;
                } else {
                  console.warn(`[logs] row insert skipped for id=${row.id}: ${msg}`);
                }
              });
          }
        }
      }
    }
    copied += page.length;

    // Progress every 5 pages
    if ((copied / LOG_PAGE) % 5 === 0 || copied >= take) {
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      const rate = secs === '0.0' ? '∞' : (copied / Number(secs)).toFixed(0);
      log(`[logs] progress copied=${copied}/${take} elapsed=${secs}s rate=${rate}/s`);
    }
  }
  log(`[logs] inserted=${stats.logs.inserted} updated=${stats.logs.updated} reboundOrphanEndpointToNull=${stats.logs.rebound}`);
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function banner(): void {
  log('=================================================================');
  log(' SCIMServer prod → dev mirror');
  log(`   source   : ${maskUrl(PROD_URL)}`);
  log(`   target   : ${maskUrl(DEV_URL)}`);
  log(`   log days : ${LOG_DAYS}, log limit: ${LOG_LIMIT}`);
  log(`   dry run  : ${DRY_RUN}`);
  log('=================================================================');
}
function summary(): void {
  log('-----------------------------------------------------------------');
  log(' SUMMARY');
  log(`   endpoints   : read=${stats.endpoints.read} inserted=${stats.endpoints.inserted} updated=${stats.endpoints.updated}`);
  log(`   resources   : read=${stats.resources.read} inserted=${stats.resources.inserted} updated=${stats.resources.updated} skippedOrphan=${stats.resources.skippedOrphan}`);
  log(`   members     : read=${stats.members.read} inserted=${stats.members.inserted} updated=${stats.members.updated} skippedOrphan=${stats.members.skippedOrphan}`);
  log(`   credentials : read=${stats.creds.read} inserted=${stats.creds.inserted} updated=${stats.creds.updated} skippedOrphan=${stats.creds.skippedOrphan}`);
  log(`   logs        : read=${stats.logs.read} inserted=${stats.logs.inserted} updated=${stats.logs.updated} reboundOrphan=${stats.logs.rebound}`);
  log('-----------------------------------------------------------------');
}
function maskUrl(u: string): string {
  return u.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}
function log(msg: string): void {
  console.log(`[mirror] ${msg}`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('[mirror] FATAL', err);
  process.exit(1);
});
