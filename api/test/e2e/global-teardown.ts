import * as fs from 'fs';
import * as path from 'path';

/**
 * Jest globalTeardown — runs once after all E2E suites.
 * Removes the temporary test database file and marker.
 *
 * Note: SQLite files may still be locked by Prisma connection pool
 * even after app.close(). We silently ignore EBUSY / EPERM errors
 * because global-setup always recreates the DB fresh.
 */
export default async function globalTeardown(): Promise<void> {
  const markerPath = path.resolve(__dirname, '.test-db-path');

  if (fs.existsSync(markerPath)) {
    const testDbPath = fs.readFileSync(markerPath, 'utf-8').trim();

    // Try to delete the DB — tolerate lock errors
    for (const file of [testDbPath, `${testDbPath}-journal`, `${testDbPath}-wal`]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        // File still locked by Prisma — global-setup will recreate it
      }
    }

    // Clean up the marker file
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Ignore
    }
  }
}
