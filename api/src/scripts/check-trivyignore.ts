/**
 * .trivyignore staleness checker - periodic-review automation.
 *
 * Parses repo-root .trivyignore, extracts every CVE entry plus its
 * `Reviewed:` and `Re-check-by:` metadata from the surrounding comments,
 * and reports any entry whose `Re-check-by` date is in the past.
 *
 * Used by:
 *   - .github/workflows/trivyignore-review.yml (weekly cron, opens an Issue
 *     listing stale entries - non-blocking so urgent fixes can still land)
 *   - `npm run check:trivyignore` (local on-demand)
 *
 * Output contract: returns a structured CheckResult so the workflow can
 * machine-format the issue body.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * The two reasons an entry can legitimately exist. They demand very
 * different review cadences, and conflating them is the bug this class
 * system exists to prevent.
 *
 * - `judgment`          - a standing decision that the CVE is not worth acting
 *                         on (e.g. upstream published the "fix" and then
 *                         deprecated it). Open-ended; 90-day cadence is right.
 * - `quarantine-window` - a fix EXISTS and we intend to take it, but the fixed
 *                         version is younger than the 7-day corporate minimum
 *                         release age, so consuming it today would violate the
 *                         supply-chain policy. Purely a TIMING wait, measured
 *                         in days. A 90-day cadence here would silently turn a
 *                         one-week hold into a quarter.
 */
export type TrivyIgnoreEntryClass = 'judgment' | 'quarantine-window';

export const ENTRY_CLASSES: ReadonlyArray<TrivyIgnoreEntryClass> = ['judgment', 'quarantine-window'];

/**
 * Hard cap on how long a quarantine-window suppression may run, measured from
 * `Reviewed:` to `Re-check-by:`. The corporate control is 7 days; this allows a
 * little slack for a weekend or a delayed publish, and nothing more.
 */
export const MAX_QUARANTINE_WINDOW_DAYS = 14;

export interface TrivyIgnoreEntry {
  /** The bare CVE ID Trivy reads (line that contains it). */
  cveId: string;
  /** 1-based line number in the .trivyignore file. */
  lineNumber: number;
  /** Owner mentioned in the `Owner:` comment, if any. */
  owner?: string;
  /** ISO date in `Reviewed:` comment, if any. */
  reviewedDate?: string;
  /** ISO date in `Re-check-by:` comment, if any. */
  recheckBy?: string;
  /**
   * Why this suppression exists. Defaults to `judgment` when no `Class:` field
   * is present, so entries written before the class system keep working.
   */
  entryClass: TrivyIgnoreEntryClass;
  /** Raw `Class:` value as written, so an invalid one can be reported verbatim. */
  rawClass?: string;
  /** `Fixed-version:` - the version that resolves the CVE. Quarantine entries only. */
  fixedVersion?: string;
  /** `Fix-available-from:` - the date that version clears the 7-day window. */
  fixAvailableFrom?: string;
  /** Free-form rationale lines collected from the comment block. */
  rationaleLines: string[];
}

export interface StaleEntry extends TrivyIgnoreEntry {
  /** Days past the recheckBy date (positive = overdue). */
  daysOverdue: number;
  /** Why this entry is flagged. */
  reason:
    | 'overdue'
    | 'missing-recheck-by'
    | 'invalid-recheck-by'
    | 'invalid-class'
    | 'missing-quarantine-fields'
    | 'invalid-fix-available-from'
    | 'quarantine-window-too-long'
    | 'fix-now-available';
}

export interface CheckResult {
  /** All parsed entries. */
  entries: ReadonlyArray<TrivyIgnoreEntry>;
  /** Entries needing immediate attention. */
  stale: ReadonlyArray<StaleEntry>;
  /** Convenience: stale.length === 0. */
  ok: boolean;
  /** Path that was scanned. */
  filePath: string;
  /** ISO date used as "today" for comparisons. */
  now: string;
}

const RE_CVE = /^([A-Z][A-Z0-9-]+)\s*$/;
const RE_OWNER = /^#\s*Owner:\s*(.+?)\s*$/i;
const RE_REVIEWED = /^#\s*Reviewed:\s*(.+?)\s*$/i;
const RE_RECHECK = /^#\s*Re-check-by:\s*(.+?)\s*$/i;
const RE_CLASS = /^#\s*Class:\s*(.+?)\s*$/i;
const RE_FIXED_VERSION = /^#\s*Fixed-version:\s*(.+?)\s*$/i;
const RE_FIX_AVAILABLE = /^#\s*Fix-available-from:\s*(.+?)\s*$/i;
const RE_HEADER_SEP = /^#\s*[\u2500-]{5,}\s*$/;

/**
 * Parse the .trivyignore file content into entries with their metadata.
 *
 * The file format is line-oriented:
 *   - bare `CVE-...` lines are entries Trivy reads
 *   - `# ...` lines above an entry (until a separator or another entry) are
 *     that entry's metadata block
 */
export function parseTrivyIgnore(content: string): TrivyIgnoreEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: TrivyIgnoreEntry[] = [];

  // Walk forward; for each CVE line, scan backward to collect its comment block.
  for (let i = 0; i < lines.length; i++) {
    const m = RE_CVE.exec(lines[i]);
    if (!m) continue;

    const entry: TrivyIgnoreEntry = {
      cveId: m[1],
      lineNumber: i + 1,
      entryClass: 'judgment',
      rationaleLines: [],
    };

    // Walk backward from i-1, stop at:
    //   - a blank line preceded by another blank line (block break), OR
    //   - a separator (─────...), OR
    //   - the previous entry, OR
    //   - top of file
    let j = i - 1;
    const blockComments: string[] = [];
    while (j >= 0) {
      const prev = lines[j];
      if (prev.trim() === '') {
        // Single blank line: keep walking (top of comment block ends at separator).
        // But if we hit two blanks in a row, stop.
        if (j > 0 && lines[j - 1].trim() === '') break;
        j--;
        continue;
      }
      if (RE_HEADER_SEP.test(prev)) {
        // Include the separator's block content above? No - separator IS the boundary.
        break;
      }
      if (RE_CVE.test(prev)) {
        // Hit the previous entry; stop.
        break;
      }
      if (prev.startsWith('#')) {
        blockComments.unshift(prev);
        j--;
        continue;
      }
      break;
    }

    for (const line of blockComments) {
      const owner = RE_OWNER.exec(line);
      if (owner) {
        entry.owner = owner[1];
        continue;
      }
      const reviewed = RE_REVIEWED.exec(line);
      if (reviewed) {
        entry.reviewedDate = reviewed[1];
        continue;
      }
      const recheck = RE_RECHECK.exec(line);
      if (recheck) {
        entry.recheckBy = recheck[1];
        continue;
      }
      const cls = RE_CLASS.exec(line);
      if (cls) {
        entry.rawClass = cls[1];
        // Only adopt a recognised value; an unknown one is reported by the
        // checker rather than silently treated as some default.
        if ((ENTRY_CLASSES as ReadonlyArray<string>).includes(cls[1])) {
          entry.entryClass = cls[1] as TrivyIgnoreEntryClass;
        }
        continue;
      }
      const fixedVersion = RE_FIXED_VERSION.exec(line);
      if (fixedVersion) {
        entry.fixedVersion = fixedVersion[1];
        continue;
      }
      const fixFrom = RE_FIX_AVAILABLE.exec(line);
      if (fixFrom) {
        entry.fixAvailableFrom = fixFrom[1];
        continue;
      }
      entry.rationaleLines.push(line);
    }

    entries.push(entry);
  }

  return entries;
}

function parseIsoDate(s: string): Date | null {
  // Strict YYYY-MM-DD parse - avoid Date()'s timezone games.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Construct in UTC noon to avoid DST/midnight edge cases.
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export interface CheckOptions {
  /** Override "today" for testing. Defaults to current UTC date. */
  now?: Date;
  /** Path to .trivyignore. Defaults to repo-root resolution. */
  filePath?: string;
}

/**
 * Check a .trivyignore file for stale entries.
 *
 * Stale = `Re-check-by` is missing, malformed, or in the past relative to
 * `options.now` (default: today UTC).
 */
export async function checkTrivyIgnore(options: CheckOptions = {}): Promise<CheckResult> {
  const filePath =
    options.filePath ??
    path.resolve(__dirname, '..', '..', '..', '.trivyignore');
  const now = options.now ?? new Date();
  const content = await fs.readFile(filePath, 'utf8');
  const entries = parseTrivyIgnore(content);
  const stale: StaleEntry[] = [];

  for (const entry of entries) {
    // A `Class:` value we do not recognise is reported rather than guessed at.
    // Guessing would let a typo ("quarantine" vs "quarantine-window") silently
    // downgrade a 7-day hold into a 90-day one, which is the exact failure the
    // class system exists to prevent.
    if (entry.rawClass && !(ENTRY_CLASSES as ReadonlyArray<string>).includes(entry.rawClass)) {
      stale.push({ ...entry, daysOverdue: Number.POSITIVE_INFINITY, reason: 'invalid-class' });
      continue;
    }

    if (entry.entryClass === 'quarantine-window') {
      // A quarantine entry is a promise to take a specific fix on a specific
      // date. Without both facts it is indistinguishable from an open-ended
      // suppression, and nobody can tell when it became actionable.
      if (!entry.fixedVersion || !entry.fixAvailableFrom) {
        stale.push({
          ...entry,
          daysOverdue: Number.POSITIVE_INFINITY,
          reason: 'missing-quarantine-fields',
        });
        continue;
      }
      const fixDate = parseIsoDate(entry.fixAvailableFrom);
      if (!fixDate) {
        stale.push({
          ...entry,
          daysOverdue: Number.POSITIVE_INFINITY,
          reason: 'invalid-fix-available-from',
        });
        continue;
      }

      // Cap the total window. 90 days is right for a judgment call and 13x too
      // long for a timing wait.
      const reviewedDate = entry.reviewedDate ? parseIsoDate(entry.reviewedDate) : null;
      const recheckDate = entry.recheckBy ? parseIsoDate(entry.recheckBy) : null;
      if (reviewedDate && recheckDate) {
        const windowDays = daysBetween(recheckDate, reviewedDate);
        if (windowDays > MAX_QUARANTINE_WINDOW_DAYS) {
          stale.push({
            ...entry,
            daysOverdue: windowDays - MAX_QUARANTINE_WINDOW_DAYS,
            reason: 'quarantine-window-too-long',
          });
          continue;
        }
      }

      // The moment the fix ages past the corporate window it is actionable.
      // Waiting for `Re-check-by` would leave a known-fixed HIGH CVE suppressed
      // for no reason, so this fires independently of the re-check date.
      const daysSinceAvailable = daysBetween(now, fixDate);
      if (daysSinceAvailable >= 0) {
        stale.push({
          ...entry,
          daysOverdue: daysSinceAvailable,
          reason: 'fix-now-available',
        });
        continue;
      }
    }

    if (!entry.recheckBy) {
      stale.push({ ...entry, daysOverdue: Number.POSITIVE_INFINITY, reason: 'missing-recheck-by' });
      continue;
    }
    const recheckDate = parseIsoDate(entry.recheckBy);
    if (!recheckDate) {
      stale.push({ ...entry, daysOverdue: Number.POSITIVE_INFINITY, reason: 'invalid-recheck-by' });
      continue;
    }
    const days = daysBetween(now, recheckDate);
    if (days > 0) {
      stale.push({ ...entry, daysOverdue: days, reason: 'overdue' });
    }
  }

  return {
    entries,
    stale,
    ok: stale.length === 0,
    filePath,
    now: (options.now ?? now).toISOString().slice(0, 10),
  };
}

/**
 * Render a Markdown report suitable for a GitHub Issue body.
 */
export function renderMarkdownReport(result: CheckResult): string {
  const lines: string[] = [];
  lines.push(`# .trivyignore review needed`);
  lines.push('');
  lines.push(`Scanned: \`${path.basename(result.filePath)}\``);
  lines.push(`Date:    ${result.now}`);
  lines.push(`Entries: ${result.entries.length} total, ${result.stale.length} stale`);
  lines.push('');

  if (result.ok) {
    lines.push('All entries are within their re-check window. No action required.');
    return lines.join('\n');
  }

  lines.push('## Stale entries');
  lines.push('');
  for (const e of result.stale) {
    lines.push(`### \`${e.cveId}\` (line ${e.lineNumber})`);
    lines.push('');
    lines.push(`- **Class**: ${e.entryClass}`);
    if (e.reason === 'overdue') {
      lines.push(`- **Status**: overdue by **${e.daysOverdue} day(s)** (Re-check-by: ${e.recheckBy})`);
    } else if (e.reason === 'missing-recheck-by') {
      lines.push(`- **Status**: missing \`Re-check-by:\` field - every entry MUST have one.`);
    } else if (e.reason === 'invalid-class') {
      lines.push(
        `- **Status**: unrecognised \`Class:\` value (\`${e.rawClass}\`) - must be one of ${ENTRY_CLASSES.map((c) => `\`${c}\``).join(', ')}.`,
      );
    } else if (e.reason === 'missing-quarantine-fields') {
      lines.push(
        '- **Status**: a `quarantine-window` entry MUST declare both `Fixed-version:` and `Fix-available-from:`, otherwise nobody can tell when it became actionable.',
      );
    } else if (e.reason === 'invalid-fix-available-from') {
      lines.push(
        `- **Status**: malformed \`Fix-available-from:\` value (\`${e.fixAvailableFrom}\`) - must be \`YYYY-MM-DD\`.`,
      );
    } else if (e.reason === 'quarantine-window-too-long') {
      lines.push(
        `- **Status**: quarantine window is **${e.daysOverdue} day(s) longer** than the ${MAX_QUARANTINE_WINDOW_DAYS}-day cap (Reviewed: ${e.reviewedDate} \u2192 Re-check-by: ${e.recheckBy}). A quarantine hold is a TIMING wait, not a judgment call - if this needs to run longer, it is a \`judgment\` entry and needs a rationale.`,
      );
    } else if (e.reason === 'fix-now-available') {
      lines.push(
        `- **Status**: **actionable now.** \`${e.fixedVersion}\` cleared the 7-day minimum-release-age window on ${e.fixAvailableFrom} (${e.daysOverdue} day(s) ago). Take the fix and delete this entry.`,
      );
    } else {
      lines.push(`- **Status**: malformed \`Re-check-by:\` value (\`${e.recheckBy}\`) - must be \`YYYY-MM-DD\`.`);
    }
    if (e.owner) lines.push(`- **Owner**: ${e.owner}`);
    if (e.reviewedDate) lines.push(`- **Last reviewed**: ${e.reviewedDate}`);
    if (e.entryClass === 'quarantine-window' && e.fixedVersion) {
      lines.push(`- **Fixed version**: \`${e.fixedVersion}\` (available from ${e.fixAvailableFrom ?? 'unknown'})`);
    }
    lines.push('');
    if (e.rationaleLines.length > 0) {
      lines.push('<details><summary>Recorded rationale</summary>');
      lines.push('');
      lines.push('```');
      for (const r of e.rationaleLines) lines.push(r);
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  const hasQuarantine = result.stale.some((e) => e.entryClass === 'quarantine-window');

  lines.push('## What to do');
  lines.push('');

  if (hasQuarantine) {
    lines.push('### For `quarantine-window` entries');
    lines.push('');
    lines.push(
      'These are TIMING waits, not judgment calls: a fix exists and we are holding only until it clears the 7-day minimum release age. Once `Fix-available-from` has passed:',
    );
    lines.push('');
    lines.push('1. Edit the pinned version in `api/package.json` (`overrides`) or the dependency itself.');
    lines.push(
      '2. Run the **regen-lockfile** workflow against your branch (`.github/workflows/regen-lockfile.yml`). Do NOT run `npm install --package-lock-only` on a corp-managed device - it rewrites `resolved` to an internal feed and downgrades `integrity` to sha1.',
    );
    lines.push('3. Commit the regenerated lockfile **and delete the `.trivyignore` entry in the same commit.**');
    lines.push('');
    lines.push('Never extend a quarantine entry to buy time. If it needs to outlive the cap, it is a `judgment` entry and needs a written rationale.');
    lines.push('');
  }

  lines.push('### For `judgment` entries');
  lines.push('');
  lines.push('Do ONE of:');
  lines.push('');
  lines.push('1. **Drop the suppression** if the upstream fix has shipped - remove the entry, push a build, confirm Trivy stays green.');
  lines.push('2. **Re-validate** the rationale and bump `Reviewed:` + `Re-check-by:` (default cadence: +90 days).');
  lines.push('3. **Add `Re-check-by:` / fix malformed value** if the field was missing or invalid.');
  lines.push('');
  lines.push('Close this issue once `.trivyignore` is updated. The workflow re-runs on schedule and will reopen if anything goes stale again.');
  return lines.join('\n');
}

/**
 * CLI entry. Always exits 0 - this script is informational; the scheduled
 * workflow turns its output into a GitHub Issue. CI build is NOT failed by
 * staleness so urgent security fixes can still land.
 */
export async function runCli(): Promise<number> {
  const result = await checkTrivyIgnore();
  const report = renderMarkdownReport(result);
  process.stdout.write(report + '\n');
  // Emit a machine-readable summary on stderr for the workflow step to grep.
  process.stderr.write(
    `STALE_COUNT=${result.stale.length}\nOK=${result.ok ? 'true' : 'false'}\n`,
  );
  return 0;
}

if (require.main === module) {
  runCli().then(
    (code) => process.exit(code),
    (err) => {
      console.error('check-trivyignore: fatal error', err);
      process.exit(2);
    },
  );
}
