import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Jest globalSetup — runs once before all E2E suites.
 * Creates a fresh SQLite test database and applies all Prisma migrations.
 *
 * SQLite compromise: Creates a physical .db file and runs prisma migrate deploy.
 * PostgreSQL migration: create an isolated test schema per worker process
 * and set DATABASE_URL to the schema-scoped connection string.
 * See docs/SQLITE_COMPROMISE_ANALYSIS.md §3.2.5
 */
export default async function globalSetup(): Promise<void> {
  const testDbPath = path.resolve(__dirname, '..', '..', 'prisma', 'test.db');
  const testDbUrl = `file:${testDbPath}`;

  // Remove stale test DB if it exists
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  // Apply all migrations to create a clean schema
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'pipe',
  });

  // Write DB path to a marker file so test suites (which run in worker processes) can read it
  const markerPath = path.resolve(__dirname, '.test-db-path');
  fs.writeFileSync(markerPath, testDbPath, 'utf-8');
}
