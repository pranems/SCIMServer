/**
 * Security regression tests - source-scan guards.
 *
 * These tests scan the API source tree for patterns that must never reappear
 * after they have been removed. They are stricter than lint rules because the
 * forbidden strings are constructed at runtime and matched literally in source
 * files, defeating any attempt to hide them behind variable names or comments.
 *
 * Add a new entry to FORBIDDEN_PATTERNS whenever you remove a credential, a
 * class, or a code smell that you never want to come back. Keep entries
 * narrow and well-justified - this guard runs on every commit.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '..');

interface ForbiddenPattern {
  /** Human-readable identifier for the closed defect (audit ID). */
  id: string;
  /** Why this pattern was removed, with link or doc reference. */
  rationale: string;
  /** Literal substring that must not appear in any matched file. */
  needle: string;
  /** File-extension allowlist (default: just .ts files in src/). */
  extensions?: ReadonlyArray<string>;
  /** Glob-style relative-path prefixes to skip in addition to the defaults. */
  excludeDirs?: ReadonlyArray<string>;
  /**
   * Restrict the scan to a specific relative path (or list of paths) instead
   * of the whole src/ tree. Useful when the needle is a generic operator like
   * `===` that is fine elsewhere but forbidden in one specific file.
   */
  onlyInPaths?: ReadonlyArray<string>;
}

// Default exclusions: build output, generated code, third-party, and this
// security spec itself (which references the needles to test for them).
const DEFAULT_EXCLUDE_DIRS: ReadonlyArray<string> = [
  'generated',
  'node_modules',
  'dist',
  'security',
];

const FORBIDDEN_PATTERNS: ReadonlyArray<ForbiddenPattern> = [
  {
    id: 'S-1',
    rationale:
      'Hardcoded legacy bearer credential removed when ScimAuthGuard was deleted. ' +
      'See docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md S-1.',
    // Constructed at runtime so this file does not contain the literal:
    needle: 'S@g@r' + '!' + '2011',
  },
  {
    id: 'S-1/S-3',
    rationale:
      'ScimAuthGuard class deleted - it bundled a hardcoded credential (S-1) ' +
      'and 5 console.log/console.error calls in the auth path (S-3). ' +
      'All routes are protected by SharedSecretGuard. ' +
      'See docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md S-1, S-3 and ' +
      'docs/LOGGING_ERROR_HANDLING_QUALITY_AUDIT.md.',
    // Class identifier as it would appear in declarations or imports:
    needle: 'Scim' + 'AuthGuard',
  },
  {
    id: 'S-2 (shared-secret.guard)',
    rationale:
      'Token comparison must use safeCompare() (timing-safe). ' +
      'A reappearance of the literal `=== expectedSecret` would ' +
      'reintroduce a timing-side-channel leak. ' +
      'See docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md S-2.',
    needle: '=' + '=' + '= expectedSecret',
    onlyInPaths: ['modules/auth/shared-secret.guard.ts'],
  },
  {
    id: 'S-2 (oauth.service)',
    rationale:
      'OAuth client_secret comparison must use safeCompare() (timing-safe). ' +
      'A reappearance of `client.clientSecret !== clientSecret` would ' +
      'reintroduce a timing-side-channel leak. ' +
      'See docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md S-2.',
    needle: 'client.clientSecret !' + '== clientSecret',
    onlyInPaths: ['oauth/oauth.service.ts'],
  },
];

interface Violation {
  patternId: string;
  file: string;
  lineNumber: number;
  line: string;
}

async function walkTypeScriptFiles(
  dir: string,
  excludeDirs: ReadonlyArray<string>,
  extensions: ReadonlyArray<string>,
): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) continue;
      out.push(...(await walkTypeScriptFiles(full, excludeDirs, extensions)));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!extensions.includes(ext)) continue;
    out.push(full);
  }
  return out;
}

async function scanForPattern(pattern: ForbiddenPattern): Promise<Violation[]> {
  const extensions = pattern.extensions ?? ['.ts'];
  const excludeDirs = [...DEFAULT_EXCLUDE_DIRS, ...(pattern.excludeDirs ?? [])];
  let files: string[];
  if (pattern.onlyInPaths && pattern.onlyInPaths.length > 0) {
    files = pattern.onlyInPaths.map(p => path.resolve(SRC_ROOT, p));
    // Validate listed files exist - silent miss would mask a deletion bug.
    for (const f of files) {
      try {
        await fs.access(f);
      } catch {
        throw new Error(
          `Pattern [${pattern.id}] declares onlyInPaths file that does not exist: ${path.relative(SRC_ROOT, f)}`,
        );
      }
    }
  } else {
    files = await walkTypeScriptFiles(SRC_ROOT, excludeDirs, extensions);
  }
  const violations: Violation[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    if (!content.includes(pattern.needle)) continue;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes(pattern.needle)) {
        violations.push({
          patternId: pattern.id,
          file: path.relative(SRC_ROOT, file).replace(/\\/g, '/'),
          lineNumber: idx + 1,
          line: line.trim(),
        });
      }
    });
  }
  return violations;
}

describe('Security regression: forbidden source patterns', () => {
  it.each(FORBIDDEN_PATTERNS.map(p => [p.id, p] as const))(
    '[%s] is absent from api/src/**/*.ts',
    async (_id, pattern) => {
      const violations = await scanForPattern(pattern);
      if (violations.length > 0) {
        const formatted = violations
          .map(v => `  ${v.file}:${v.lineNumber}: ${v.line}`)
          .join('\n');
        throw new Error(
          `Forbidden pattern [${pattern.id}] reappeared in source.\n` +
            `Rationale: ${pattern.rationale}\n` +
            `Violations:\n${formatted}\n`,
        );
      }
      expect(violations).toEqual([]);
    },
  );
});
