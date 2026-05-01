/**
 * Tests for check-trivyignore - the .trivyignore staleness checker.
 *
 * The script parses the repo-root .trivyignore file, extracts each CVE
 * entry's machine-readable metadata (Owner / Reviewed / Re-check-by) from
 * the surrounding comment block, and reports any entry whose Re-check-by
 * date is in the past, missing, or malformed.
 *
 * The companion .github/workflows/trivyignore-review.yml runs this weekly
 * and opens a GitHub Issue from the rendered Markdown report. Locally,
 * `npm run check:trivyignore` produces the same report.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseTrivyIgnore,
  checkTrivyIgnore,
  renderMarkdownReport,
} from './check-trivyignore';

async function makeTempIgnore(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'trivyignore-test-'));
  const file = path.join(dir, '.trivyignore');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

describe('parseTrivyIgnore', () => {
  it('returns [] for an empty file', () => {
    expect(parseTrivyIgnore('')).toEqual([]);
  });

  it('returns [] for a comments-only file', () => {
    expect(parseTrivyIgnore('# header\n# more\n')).toEqual([]);
  });

  it('parses a single CVE with full metadata', () => {
    const content = [
      '# CVE-2026-1234 - example',
      '# Owner:       @alice',
      '# Reviewed:    2026-01-01',
      '# Re-check-by: 2026-04-01',
      'CVE-2026-1234',
    ].join('\n');
    const entries = parseTrivyIgnore(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        cveId: 'CVE-2026-1234',
        lineNumber: 5,
        owner: '@alice',
        reviewedDate: '2026-01-01',
        recheckBy: '2026-04-01',
      }),
    );
  });

  it('parses multiple CVEs and keeps each metadata block separate', () => {
    const content = [
      '# Header for the file',
      '',
      '# CVE-A first',
      '# Owner:       @a',
      '# Reviewed:    2026-01-01',
      '# Re-check-by: 2026-04-01',
      'CVE-2026-1001',
      '',
      '# ─────────────────────────────────',
      '# CVE-B second',
      '# Owner:       @b',
      '# Reviewed:    2026-02-01',
      '# Re-check-by: 2026-05-01',
      'CVE-2026-1002',
    ].join('\n');
    const entries = parseTrivyIgnore(content);
    expect(entries).toHaveLength(2);
    expect(entries[0].cveId).toBe('CVE-2026-1001');
    expect(entries[0].owner).toBe('@a');
    expect(entries[0].recheckBy).toBe('2026-04-01');
    expect(entries[1].cveId).toBe('CVE-2026-1002');
    expect(entries[1].owner).toBe('@b');
    expect(entries[1].recheckBy).toBe('2026-05-01');
  });

  it('marks entries with no preceding metadata as bare', () => {
    const entries = parseTrivyIgnore('CVE-2026-9999\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].cveId).toBe('CVE-2026-9999');
    expect(entries[0].owner).toBeUndefined();
    expect(entries[0].reviewedDate).toBeUndefined();
    expect(entries[0].recheckBy).toBeUndefined();
  });

  it('handles CRLF line endings', () => {
    const content = '# Re-check-by: 2026-04-01\r\nCVE-2026-1234\r\n';
    const entries = parseTrivyIgnore(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].recheckBy).toBe('2026-04-01');
  });

  it('case-insensitive metadata field names', () => {
    const content = [
      '# OWNER: @cap',
      '# reviewed: 2026-01-01',
      '# RE-CHECK-BY: 2026-04-01',
      'CVE-2026-1111',
    ].join('\n');
    const entry = parseTrivyIgnore(content)[0];
    expect(entry.owner).toBe('@cap');
    expect(entry.reviewedDate).toBe('2026-01-01');
    expect(entry.recheckBy).toBe('2026-04-01');
  });
});

describe('checkTrivyIgnore', () => {
  it('flags an entry whose Re-check-by is in the past', async () => {
    const file = await makeTempIgnore(
      [
        '# Owner:       @a',
        '# Reviewed:    2025-01-01',
        '# Re-check-by: 2025-04-01',
        'CVE-2026-1001',
      ].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0].cveId).toBe('CVE-2026-1001');
    expect(result.stale[0].reason).toBe('overdue');
    expect(result.stale[0].daysOverdue).toBeGreaterThan(0);
  });

  it('does NOT flag an entry whose Re-check-by is in the future', async () => {
    const file = await makeTempIgnore(
      ['# Re-check-by: 2099-01-01', 'CVE-2026-1002'].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.stale).toEqual([]);
  });

  it('flags an entry with NO Re-check-by field', async () => {
    const file = await makeTempIgnore(
      ['# Owner: @a', '# Reviewed: 2026-01-01', 'CVE-2026-1003'].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.stale[0].reason).toBe('missing-recheck-by');
  });

  it('flags an entry with malformed Re-check-by', async () => {
    const file = await makeTempIgnore(
      ['# Re-check-by: not-a-date', 'CVE-2026-1004'].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.stale[0].reason).toBe('invalid-recheck-by');
  });

  it('treats Re-check-by exactly equal to today as NOT stale (entire day grace)', async () => {
    const file = await makeTempIgnore(
      ['# Re-check-by: 2026-05-01', 'CVE-2026-1005'].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    expect(result.ok).toBe(true);
  });

  it('reports ok and zero stale for a fully clean file', async () => {
    const file = await makeTempIgnore(
      [
        '# Header',
        '',
        '# Re-check-by: 2099-01-01',
        'CVE-2026-A001',
        '',
        '# Re-check-by: 2099-12-31',
        'CVE-2026-A002',
      ].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(2);
    expect(result.stale).toHaveLength(0);
  });

  it('parses the live repo .trivyignore without throwing', async () => {
    // Sanity check the real file in the repo is parseable. We deliberately
    // pin `now` to the file's authored date (not real-now) so this test does
    // NOT start failing once the entries reach their Re-check-by deadline -
    // staleness is the workflow's job to surface as an Issue, not unit-test's
    // job to block unrelated PRs. We still assert every entry parsed has a
    // CVE-shaped ID and a Re-check-by, which IS a hard rule.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const livePath = path.join(repoRoot, '.trivyignore');
    const result = await checkTrivyIgnore({
      filePath: livePath,
      now: new Date('2026-04-30T12:00:00Z'),
    });
    expect(result.entries.length).toBeGreaterThan(0);
    for (const e of result.entries) {
      expect(e.cveId).toMatch(/^[A-Z][A-Z0-9-]+$/);
      expect(e.recheckBy).toBeDefined();
      expect(e.owner).toBeDefined();
    }
  });
});

describe('renderMarkdownReport', () => {
  it('renders a clean-state report when ok', async () => {
    const file = await makeTempIgnore(
      ['# Re-check-by: 2099-01-01', 'CVE-2026-OK01'].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    const md = renderMarkdownReport(result);
    expect(md).toContain('# .trivyignore review needed');
    expect(md).toContain('No action required');
    expect(md).not.toContain('## Stale entries');
  });

  it('renders a per-entry section for each stale entry with status, owner, and date', async () => {
    const file = await makeTempIgnore(
      [
        '# Owner:       @bob',
        '# Reviewed:    2025-01-01',
        '# Re-check-by: 2025-04-01',
        'CVE-2026-STALE1',
      ].join('\n'),
    );
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    const md = renderMarkdownReport(result);
    expect(md).toContain('## Stale entries');
    expect(md).toContain('CVE-2026-STALE1');
    expect(md).toContain('overdue by');
    expect(md).toContain('@bob');
    expect(md).toContain('2025-01-01');
    expect(md).toContain('What to do');
  });

  it('shows a distinct status line for missing-recheck-by entries', async () => {
    const file = await makeTempIgnore(['CVE-2026-NORECHECK'].join('\n'));
    const result = await checkTrivyIgnore({
      filePath: file,
      now: new Date('2026-05-01T12:00:00Z'),
    });
    const md = renderMarkdownReport(result);
    expect(md).toContain('CVE-2026-NORECHECK');
    expect(md).toMatch(/missing\s+`Re-check-by:`/);
  });
});
