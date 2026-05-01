/**
 * Tests for lintMigrations - the destructive-migration detector.
 *
 * The linter scans api/prisma/migrations/<timestamp>_*\/migration.sql for
 * forbidden DDL that would cause data loss without explicit acknowledgment.
 * Closes DELIVERY_PLAN.md Week 1 Day 4 "Migration linter in CI".
 *
 * Forbidden patterns (case-insensitive match outside SQL strings/comments):
 *   - DROP TABLE
 *   - DROP COLUMN
 *   - ALTER COLUMN ... TYPE          (type changes can truncate)
 *   - RENAME TO / RENAME COLUMN      (clients break silently)
 *   - INSERT ... SELECT FROM <table> (data movement risk)
 *
 * Override mechanism: setting ALLOW_DESTRUCTIVE_MIGRATION=1 in the env makes
 * the linter warn but not fail. The PR template (OPS-4) requires the author
 * to check a box documenting why before CI runs with the override.
 */
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { lintMigrations, type LintResult } from './lint-migrations';

async function makeTempMigrationsDir(
  files: Record<string, string>,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'migration-lint-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(root, relativePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return root;
}

describe('lintMigrations', () => {
  it('returns ok when migrations directory does not exist', async () => {
    const result = await lintMigrations({ migrationsDir: '/nonexistent/path' });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns ok for an empty migrations directory', async () => {
    const dir = await makeTempMigrationsDir({});
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns ok for an additive-only migration (CREATE TABLE, ADD COLUMN, CREATE INDEX)', async () => {
    const dir = await makeTempMigrationsDir({
      '20260101000000_add_users/migration.sql': `
        CREATE TABLE "User" ("id" UUID PRIMARY KEY, "email" TEXT NOT NULL);
        ALTER TABLE "User" ADD COLUMN "createdAt" TIMESTAMPTZ DEFAULT now();
        CREATE INDEX "User_email_idx" ON "User"("email");
      `,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags DROP TABLE as destructive', async () => {
    const dir = await makeTempMigrationsDir({
      '20260102000000_drop_legacy/migration.sql': `DROP TABLE "LegacyUser";`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].pattern).toBe('DROP TABLE');
  });

  it('flags ALTER TABLE ... DROP COLUMN as destructive', async () => {
    const dir = await makeTempMigrationsDir({
      '20260103000000_drop_col/migration.sql': `ALTER TABLE "User" DROP COLUMN "legacyField";`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations[0].pattern).toBe('DROP COLUMN');
  });

  it('flags ALTER COLUMN ... TYPE as destructive (truncation risk)', async () => {
    const dir = await makeTempMigrationsDir({
      '20260104000000_alter_type/migration.sql': `ALTER TABLE "User" ALTER COLUMN "name" TYPE VARCHAR(50);`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations[0].pattern).toBe('ALTER COLUMN ... TYPE');
  });

  it('flags ALTER TABLE ... RENAME TO as destructive (silent client break)', async () => {
    const dir = await makeTempMigrationsDir({
      '20260105000000_rename_table/migration.sql': `ALTER TABLE "User" RENAME TO "Account";`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations[0].pattern).toBe('RENAME');
  });

  it('flags ALTER TABLE ... RENAME COLUMN as destructive', async () => {
    const dir = await makeTempMigrationsDir({
      '20260106000000_rename_col/migration.sql': `ALTER TABLE "User" RENAME COLUMN "displayName" TO "fullName";`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations[0].pattern).toBe('RENAME');
  });

  it('flags INSERT ... SELECT FROM <table> as destructive (data-movement risk)', async () => {
    const dir = await makeTempMigrationsDir({
      '20260107000000_data_move/migration.sql': `INSERT INTO "User_v2" SELECT * FROM "User";`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations[0].pattern).toBe('INSERT ... SELECT FROM');
  });

  it('does NOT flag INSERT ... VALUES (regular seed insert)', async () => {
    const dir = await makeTempMigrationsDir({
      '20260108000000_seed/migration.sql': `INSERT INTO "Endpoint" ("id", "name") VALUES (gen_random_uuid(), 'default');`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(true);
  });

  it('reports each violation with file path, line number, and matched line text', async () => {
    const dir = await makeTempMigrationsDir({
      '20260109000000_multi/migration.sql': `-- destructive set\nALTER TABLE "User" DROP COLUMN "legacyField";\nALTER TABLE "Group" DROP COLUMN "legacyField";\n`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toMatchObject({
      file: expect.stringContaining('20260109000000_multi'),
      lineNumber: 2,
      pattern: 'DROP COLUMN',
    });
    expect(result.violations[1].lineNumber).toBe(3);
  });

  it('aggregates violations across multiple migration directories', async () => {
    const dir = await makeTempMigrationsDir({
      '20260110000000_a/migration.sql': `DROP TABLE "A";`,
      '20260110000001_b/migration.sql': `DROP TABLE "B";`,
      '20260110000002_c/migration.sql': `CREATE TABLE "C"("id" UUID PRIMARY KEY);`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('returns ok=true with violations list populated when allowDestructive override is set', async () => {
    const dir = await makeTempMigrationsDir({
      '20260111000000_d/migration.sql': `DROP TABLE "Old";`,
    });
    const result = await lintMigrations({ migrationsDir: dir, allowDestructive: true });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.overridden).toBe(true);
  });

  it('ignores .toml lock files and non-SQL files in the migrations dir', async () => {
    const dir = await makeTempMigrationsDir({
      'migration_lock.toml': `provider = "postgresql"`,
      '20260112000000_a/migration.sql': `CREATE TABLE "A"("id" UUID PRIMARY KEY);`,
      '20260112000000_a/notes.md': `Migration notes - this is not a SQL file but should be ignored.`,
    });
    const result = await lintMigrations({ migrationsDir: dir });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('exposes a stable summary string for human and CI consumption', async () => {
    const dir = await makeTempMigrationsDir({
      '20260113000000_a/migration.sql': `DROP TABLE "A";`,
    });
    const result: LintResult = await lintMigrations({ migrationsDir: dir });
    expect(result.summary).toContain('1 destructive');
    expect(result.summary).toContain('20260113000000_a');
  });

  describe('baseline (.migration-lint-baseline.json)', () => {
    async function setupBaseline(
      dir: string,
      files: Record<string, string>,
    ): Promise<string> {
      // Compute the SHA-256 of each provided file and write the baseline file
      // one level up from the migrations dir (the default location).
      const { createHash } = await import('node:crypto');
      const acceptedHashes: Record<string, string> = {};
      for (const [rel, content] of Object.entries(files)) {
        acceptedHashes[rel] = createHash('sha256').update(content, 'utf8').digest('hex');
      }
      const baselinePath = path.join(dir, '..', '.migration-lint-baseline.json');
      await fs.writeFile(baselinePath, JSON.stringify({ acceptedHashes }, null, 2), 'utf8');
      return baselinePath;
    }

    it('skips destructive migrations whose hash matches the baseline', async () => {
      const dir = await makeTempMigrationsDir({
        '20260201000000_drop_legacy/migration.sql': `DROP TABLE "Legacy";`,
        '20260201000001_add_new/migration.sql': `CREATE TABLE "New" ("id" UUID PRIMARY KEY);`,
      });
      await setupBaseline(dir, {
        '20260201000000_drop_legacy/migration.sql': `DROP TABLE "Legacy";`,
      });
      const result = await lintMigrations({ migrationsDir: dir });
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('still flags destructive migrations whose hash does NOT match the baseline (file edited after acceptance)', async () => {
      const dir = await makeTempMigrationsDir({
        '20260202000000_drop_legacy/migration.sql': `DROP TABLE "Legacy";\nDROP TABLE "Other";`,
      });
      // Baseline records a different content for the same file -> hash mismatch.
      await setupBaseline(dir, {
        '20260202000000_drop_legacy/migration.sql': `DROP TABLE "Legacy";`,
      });
      const result = await lintMigrations({ migrationsDir: dir });
      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('flags new destructive migrations even when older ones are baselined', async () => {
      const dir = await makeTempMigrationsDir({
        '20260203000000_baselined/migration.sql': `DROP TABLE "Old";`,
        '20260203000001_new/migration.sql': `DROP COLUMN "X" FROM "Y";`,
      });
      await setupBaseline(dir, {
        '20260203000000_baselined/migration.sql': `DROP TABLE "Old";`,
      });
      const result = await lintMigrations({ migrationsDir: dir });
      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].file).toContain('20260203000001_new');
    });

    it('continues to work when no baseline file exists (back-compat)', async () => {
      const dir = await makeTempMigrationsDir({
        '20260204000000_a/migration.sql': `CREATE TABLE "A" ("id" UUID PRIMARY KEY);`,
      });
      // No baseline file written.
      const result = await lintMigrations({ migrationsDir: dir });
      expect(result.ok).toBe(true);
    });
  });
});
