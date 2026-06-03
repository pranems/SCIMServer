import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

/**
 * Jest globalTeardown - runs once after all E2E suites.
 *
 * Truncates all SCIM data tables so test runs don't accumulate stale data.
 * When PERSISTENCE_BACKEND=inmemory, nothing to clean up.
 */
export default async function globalTeardown(): Promise<void> {
  const markerPath = path.resolve(__dirname, '.test-db-path');
  if (!fs.existsSync(markerPath)) return;

  const marker = fs.readFileSync(markerPath, 'utf-8').trim();

  // Clean up the marker file
  try {
    fs.unlinkSync(markerPath);
  } catch {
    // Ignore
  }

  // InMemory backend - nothing to clean up
  if (marker === 'inmemory') return;

  // Prisma/PostgreSQL backend - truncate all tables
  const pool = new pg.Pool({ connectionString: marker, max: 1 });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.$transaction([
      prisma.requestLog.deleteMany(),
      prisma.resourceMember.deleteMany(),
      prisma.scimResource.deleteMany(),
      prisma.endpoint.deleteMany(),
    ]);
  } catch {
    // Tolerate connection errors - DB may already be gone
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
