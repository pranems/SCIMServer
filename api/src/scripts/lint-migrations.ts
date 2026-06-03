/**
 * Migration linter - detects destructive Prisma SQL migrations.
 *
 * Scans api/prisma/migrations/<timestamp>_*\/migration.sql for forbidden DDL
 * that would cause data loss without explicit acknowledgment, and produces a
 * structured report. Used by:
 *   - The validate job in .github/workflows/build-and-push.yml (CI gate)
 *   - The validate job in .github/workflows/build-test.yml
 *   - Local pre-commit / pre-merge sanity checks
 *
 * Forbidden patterns (case-insensitive):
 *   DROP TABLE                  - permanent data loss
 *   DROP COLUMN                 - permanent column data loss
 *   ALTER COLUMN ... TYPE       - type changes can truncate or coerce silently
 *   RENAME (TO|COLUMN)          - silent client breakage
 *   INSERT ... SELECT FROM      - data movement risk (use expand-contract instead)
 *
 * Override: `allowDestructive: true` (or env var ALLOW_DESTRUCTIVE_MIGRATION=1)
 * makes the linter still report violations but return ok: true. The PR template
 * (OPS-4) requires a justification box to be checked when the override is used.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export interface LintOptions {
  /** Path to the prisma migrations directory. */
  migrationsDir: string;
  /** When true, violations are still reported but ok stays true. */
  allowDestructive?: boolean;
  /**
   * Path to a baseline JSON file (default: .migration-lint-baseline.json next
   * to the migrations dir) that lists the SHA-256 hash of each accepted
   * historical destructive migration. Files whose hash matches are skipped.
   * The baseline locks history; any NEW destructive migration adds a new
   * file with a new hash and is reported.
   */
  baselinePath?: string;
}

export interface Violation {
  file: string;
  lineNumber: number;
  pattern: string;
  line: string;
}

export interface LintResult {
  ok: boolean;
  overridden: boolean;
  violations: ReadonlyArray<Violation>;
  summary: string;
}

interface RuleDef {
  pattern: string;
  // Single regex applied to each line (already normalized: stripped comments,
  // collapsed whitespace, lowercased).
  matcher: RegExp;
}

const RULES: ReadonlyArray<RuleDef> = [
  // Order matters: more specific rules first so a single line is reported
  // under the most useful label.
  { pattern: 'DROP TABLE',           matcher: /\bdrop\s+table\b/ },
  { pattern: 'DROP COLUMN',          matcher: /\bdrop\s+column\b/ },
  { pattern: 'ALTER COLUMN ... TYPE', matcher: /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/ },
  { pattern: 'RENAME',               matcher: /\brename\s+(to|column)\b/ },
  { pattern: 'INSERT ... SELECT FROM', matcher: /\binsert\s+into\b[\s\S]*?\bselect\b[\s\S]*?\bfrom\b/ },
];

function normalizeLine(line: string): string {
  // Strip line comments (-- ...) and trim. Block comments would need a
  // multi-line scanner; current Prisma migrations don't use /* */ blocks
  // and we are conservative (false positives are easier to fix than misses).
  const noComment = line.replace(/--.*$/, '');
  return noComment.trim().toLowerCase();
}

async function listMigrationSqlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sqlFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name, 'migration.sql');
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) sqlFiles.push(candidate);
    } catch {
      // No migration.sql in this dir; skip.
    }
  }
  return sqlFiles.sort();
}

function scanContent(file: string, content: string): Violation[] {
  const out: Violation[] = [];
  const rawLines = content.split(/\r?\n/);
  // For multi-line patterns (INSERT ... SELECT FROM), join the entire file
  // for the cross-line check, then map back to a representative line number
  // by finding the line that contains "insert into".
  const normalizedJoined = rawLines.map(normalizeLine).join(' ');
  for (const rule of RULES) {
    if (rule.pattern === 'INSERT ... SELECT FROM') {
      if (rule.matcher.test(normalizedJoined)) {
        const idx = rawLines.findIndex(l => /\binsert\s+into\b/i.test(l));
        out.push({
          file,
          lineNumber: idx >= 0 ? idx + 1 : 1,
          pattern: rule.pattern,
          line: idx >= 0 ? rawLines[idx].trim() : '',
        });
      }
      continue;
    }
    rawLines.forEach((raw, idx) => {
      const norm = normalizeLine(raw);
      if (norm.length === 0) return;
      if (rule.matcher.test(norm)) {
        out.push({ file, lineNumber: idx + 1, pattern: rule.pattern, line: raw.trim() });
      }
    });
  }
  return out;
}

interface BaselineFile {
  /**
   * Map of relative migration path (e.g. "20260223203811_externalid_citext_case_insensitive/migration.sql")
   * to SHA-256 hash of the file content. A change to the file invalidates
   * the baseline entry, surfacing the file in the linter again.
   */
  acceptedHashes: Record<string, string>;
}

async function loadBaseline(baselinePath: string): Promise<BaselineFile | null> {
  try {
    const raw = await fs.readFile(baselinePath, 'utf8');
    const parsed = JSON.parse(raw) as BaselineFile;
    if (parsed && typeof parsed === 'object' && parsed.acceptedHashes && typeof parsed.acceptedHashes === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function sha256(content: string): string {
  // Normalize CRLF -> LF before hashing so the same migration file hashes
  // identically on Windows (CRLF working tree) and Linux CI (LF working tree).
  // Without this, baseline hashes generated on one platform never match the
  // other, re-flagging baselined historical destructives on every CI run.
  const normalized = content.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export async function lintMigrations(options: LintOptions): Promise<LintResult> {
  const sqlFiles = await listMigrationSqlFiles(options.migrationsDir);
  const baselinePath =
    options.baselinePath ?? path.join(options.migrationsDir, '..', '.migration-lint-baseline.json');
  const baseline = await loadBaseline(baselinePath);

  const all: Violation[] = [];
  for (const file of sqlFiles) {
    const content = await fs.readFile(file, 'utf8');
    const fileViolations = scanContent(file, content);
    if (fileViolations.length === 0) continue;

    if (baseline) {
      const relFromMigrations = path
        .relative(options.migrationsDir, file)
        .replace(/\\/g, '/');
      const expected = baseline.acceptedHashes[relFromMigrations];
      if (expected && expected === sha256(content)) {
        // Historical destructive migration accepted via baseline; skip.
        continue;
      }
    }
    all.push(...fileViolations);
  }

  const overridden = options.allowDestructive === true;
  const ok = all.length === 0 || overridden;

  let summary: string;
  if (all.length === 0) {
    summary = `lint-migrations: 0 violations across ${sqlFiles.length} migration(s).`;
  } else {
    const fileLabels = Array.from(new Set(all.map(v => path.basename(path.dirname(v.file))))).join(', ');
    summary =
      `lint-migrations: ${all.length} destructive operation(s) detected ` +
      `in ${fileLabels}` + (overridden ? ' (override active)' : '');
  }

  return { ok, overridden, violations: all, summary };
}

/**
 * CLI entry point. Used by .github/workflows/*.yml validate job.
 * Resolves the migrations directory relative to this file unless overridden
 * with --dir <path>. Honors ALLOW_DESTRUCTIVE_MIGRATION=1 env var.
 */
export async function runCli(argv: ReadonlyArray<string>): Promise<number> {
  const dirIdx = argv.indexOf('--dir');
  const migrationsDir =
    dirIdx >= 0 && argv[dirIdx + 1]
      ? argv[dirIdx + 1]
      : path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
  const allowDestructive = process.env.ALLOW_DESTRUCTIVE_MIGRATION === '1';

  const result = await lintMigrations({ migrationsDir, allowDestructive });

  for (const v of result.violations) {
    const rel = path.relative(process.cwd(), v.file).replace(/\\/g, '/');
    process.stderr.write(`${rel}:${v.lineNumber}: [${v.pattern}] ${v.line}\n`);
  }
  process.stderr.write(`${result.summary}\n`);

  if (!result.ok) {
    process.stderr.write(
      'Failing the build. To override (with explicit justification in the PR), ' +
        'set ALLOW_DESTRUCTIVE_MIGRATION=1 and document the migration plan ' +
        'in the PR description per the standing rule on additive-only migrations.\n',
    );
    return 1;
  }
  if (result.overridden && result.violations.length > 0) {
    process.stderr.write(
      'WARNING: destructive migration overridden via ALLOW_DESTRUCTIVE_MIGRATION=1.\n',
    );
  }
  return 0;
}

// When invoked directly via `node dist/scripts/lint-migrations.js`.
// Not via ts-node-dev (which loads main.ts and does its own thing).
if (require.main === module) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      // eslint-disable-next-line no-console
      console.error('lint-migrations: fatal error', err);
      process.exit(2);
    },
  );
}
