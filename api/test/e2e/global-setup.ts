import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Jest globalSetup — runs once before all E2E suites.
 *
 * Phase 3: When PERSISTENCE_BACKEND=inmemory, no database setup is needed.
 * When using Prisma backend, applies PostgreSQL migrations via prisma migrate deploy.
 */
export default async function globalSetup(): Promise<void> {
  const backend = process.env.PERSISTENCE_BACKEND?.toLowerCase() ?? 'prisma';

  if (backend === 'inmemory') {
    // InMemory backend — no database setup required
    const markerPath = path.resolve(__dirname, '.test-db-path');
    fs.writeFileSync(markerPath, 'inmemory', 'utf-8');
    return;
  }

  // Prisma backend — PostgreSQL migrations
  const dbUrl = process.env.DATABASE_URL ?? 'postgresql://scim:scim@localhost:5432/scimdb';

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
  });

  const markerPath = path.resolve(__dirname, '.test-db-path');
  fs.writeFileSync(markerPath, dbUrl, 'utf-8');
}
