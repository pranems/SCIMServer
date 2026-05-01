/**
 * .trivyignore staleness checker — periodic-review automation.
 *
 * Parses repo-root .trivyignore, extracts every CVE entry plus its
 * `Reviewed:` and `Re-check-by:` metadata from the surrounding comments,
 * and reports any entry whose `Re-check-by` date is in the past.
 *
 * Used by:
 *   - .github/workflows/trivyignore-review.yml (weekly cron, opens an Issue
 *     listing stale entries — non-blocking so urgent fixes can still land)
 *   - `npm run check:trivyignore` (local on-demand)
 *
 * Output contract: returns a structured CheckResult so the workflow can
 * machine-format the issue body.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

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
  /** Free-form rationale lines collected from the comment block. */
  rationaleLines: string[];
}

export interface StaleEntry extends TrivyIgnoreEntry {
  /** Days past the recheckBy date (positive = overdue). */
  daysOverdue: number;
  /** Why this entry is flagged: 'overdue' | 'missing-recheck-by' | 'invalid-recheck-by'. */
  reason: 'overdue' | 'missing-recheck-by' | 'invalid-recheck-by';
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
const RE_HEADER_SEP = /^#\s*[─-]{5,}\s*$/;

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
      entry.rationaleLines.push(line);
    }

    entries.push(entry);
  }

  return entries;
}

function parseIsoDate(s: string): Date | null {
  // Strict YYYY-MM-DD parse — avoid Date()'s timezone games.
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
    if (e.reason === 'overdue') {
      lines.push(`- **Status**: overdue by **${e.daysOverdue} day(s)** (Re-check-by: ${e.recheckBy})`);
    } else if (e.reason === 'missing-recheck-by') {
      lines.push(`- **Status**: missing \`Re-check-by:\` field — every entry MUST have one.`);
    } else {
      lines.push(`- **Status**: malformed \`Re-check-by:\` value (\`${e.recheckBy}\`) — must be \`YYYY-MM-DD\`.`);
    }
    if (e.owner) lines.push(`- **Owner**: ${e.owner}`);
    if (e.reviewedDate) lines.push(`- **Last reviewed**: ${e.reviewedDate}`);
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

  lines.push('## What to do');
  lines.push('');
  lines.push('For each stale entry, do ONE of:');
  lines.push('');
  lines.push('1. **Drop the suppression** if the upstream fix has shipped — remove the entry, push a build, confirm Trivy stays green.');
  lines.push('2. **Re-validate** the rationale and bump `Reviewed:` + `Re-check-by:` (default cadence: +90 days).');
  lines.push('3. **Add `Re-check-by:` / fix malformed value** if the field was missing or invalid.');
  lines.push('');
  lines.push('Close this issue once `.trivyignore` is updated. The workflow re-runs weekly and will reopen if anything goes stale again.');
  return lines.join('\n');
}

/**
 * CLI entry. Always exits 0 — this script is informational; the scheduled
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
      // eslint-disable-next-line no-console
      console.error('check-trivyignore: fatal error', err);
      process.exit(2);
    },
  );
}
