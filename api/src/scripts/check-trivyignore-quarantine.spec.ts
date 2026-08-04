/**
 * Tests for the quarantine-window exception class in .trivyignore.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two controls in this repo are in direct, designed-in conflict:
 *
 *   - Trivy blocks a build the moment a HIGH/CRITICAL advisory exists AND a
 *     fixed version is published (`ignore-unfixed: true` means every failure
 *     we see has a fix available).
 *   - The corporate supply-chain policy forbids consuming any package version
 *     younger than 7 days, and .github/workflows/regen-lockfile.yml holds CI
 *     to the same bar even though GitHub runners are not corp-managed.
 *
 * For any fast-moving advisory there is therefore a window of up to 7 days in
 * which NO compliant action makes the gate green. That window is not an
 * accident, so it gets a first-class representation rather than an ad-hoc
 * suppression each time.
 *
 * The danger being defended against: a quarantine wait (7 days) and a
 * judgment call (indefinite, e.g. upstream shipped a bad release) look
 * identical in the file, so the 90-day default cadence silently swallows a
 * one-week hold. These tests force the two to be distinguishable and force
 * the quarantine class to carry a short, derived deadline.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseTrivyIgnore,
  checkTrivyIgnore,
  renderMarkdownReport,
  MAX_QUARANTINE_WINDOW_DAYS,
} from './check-trivyignore';

async function makeTempIgnore(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'trivyignore-quarantine-'));
  const file = path.join(dir, '.trivyignore');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

/** A well-formed quarantine entry: fix exists, but is inside the 7-day window. */
function quarantineEntry(overrides: Partial<Record<string, string>> = {}): string {
  const f = {
    Class: 'quarantine-window',
    Owner: '@pranems',
    'Fixed-version': '4.1.2',
    'Fix-available-from': '2026-08-10',
    Reviewed: '2026-08-04',
    'Re-check-by': '2026-08-10',
    ...overrides,
  };
  const lines = ['# CVE-2026-18446 - fast-uri host confusion'];
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    lines.push(`# ${k}: ${v}`);
  }
  lines.push('CVE-2026-18446');
  return lines.join('\n') + '\n';
}

describe('quarantine-window exception class', () => {
  describe('parsing', () => {
    it('defaults an entry with no Class: to "judgment" so existing entries keep working', () => {
      const content = [
        '# CVE-2026-4800 - lodash',
        '# Owner: @pranems',
        '# Reviewed: 2026-04-30',
        '# Re-check-by: 2026-07-30',
        'CVE-2026-4800',
        '',
      ].join('\n');
      const [entry] = parseTrivyIgnore(content);
      expect(entry.entryClass).toBe('judgment');
    });

    it('parses Class, Fixed-version and Fix-available-from', () => {
      const [entry] = parseTrivyIgnore(quarantineEntry());
      expect(entry.entryClass).toBe('quarantine-window');
      expect(entry.fixedVersion).toBe('4.1.2');
      expect(entry.fixAvailableFrom).toBe('2026-08-10');
    });

    it('does not leak the new fields into the free-form rationale', () => {
      const [entry] = parseTrivyIgnore(quarantineEntry());
      const rationale = entry.rationaleLines.join('\n');
      expect(rationale).not.toMatch(/Class:/);
      expect(rationale).not.toMatch(/Fixed-version:/);
      expect(rationale).not.toMatch(/Fix-available-from:/);
    });
  });

  describe('validation', () => {
    it('accepts a well-formed quarantine entry before its deadline', async () => {
      const file = await makeTempIgnore(quarantineEntry());
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 5, 12)),
      });
      expect(result.stale).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('rejects an unknown Class value', async () => {
      const file = await makeTempIgnore(quarantineEntry({ Class: 'whatever' }));
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 5, 12)),
      });
      expect(result.stale.map((s) => s.reason)).toContain('invalid-class');
    });

    it('requires Fixed-version and Fix-available-from on a quarantine entry', async () => {
      const file = await makeTempIgnore(
        quarantineEntry({ 'Fixed-version': undefined, 'Fix-available-from': undefined }),
      );
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 5, 12)),
      });
      expect(result.stale.map((s) => s.reason)).toContain('missing-quarantine-fields');
    });

    it('does NOT require those fields on a judgment entry', async () => {
      const content = [
        '# CVE-2026-4800 - lodash, upstream shipped a bad release',
        '# Class: judgment',
        '# Owner: @pranems',
        '# Reviewed: 2026-08-01',
        '# Re-check-by: 2026-10-30',
        'CVE-2026-4800',
        '',
      ].join('\n');
      const file = await makeTempIgnore(content);
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 5, 12)),
      });
      expect(result.stale).toEqual([]);
    });

    // THE CORE OF THIS CHANGE. A 90-day cadence is right for a judgment call
    // and 13x too long for a 7-day wait. Without this rule the two classes
    // are indistinguishable in effect, which is the whole bug.
    it('rejects a quarantine entry whose window exceeds the cap, even though 90 days is fine for judgment', async () => {
      const file = await makeTempIgnore(
        quarantineEntry({ Reviewed: '2026-08-04', 'Re-check-by': '2026-11-02' }),
      );
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 5, 12)),
      });
      const reasons = result.stale.map((s) => s.reason);
      expect(reasons).toContain('quarantine-window-too-long');
      expect(MAX_QUARANTINE_WINDOW_DAYS).toBeLessThanOrEqual(14);
    });

    it('flags a quarantine entry once the fix has aged past the window, before Re-check-by lapses', async () => {
      // Re-check-by is deliberately later than Fix-available-from here. The
      // entry is actionable the moment the fix ages in - waiting for the
      // re-check date would leave a known-fixed HIGH CVE suppressed.
      const file = await makeTempIgnore(
        quarantineEntry({ 'Fix-available-from': '2026-08-10', 'Re-check-by': '2026-08-14' }),
      );
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 11, 12)), // 2026-08-11, past fix availability
      });
      expect(result.stale.map((s) => s.reason)).toContain('fix-now-available');
    });

    it('rejects a malformed Fix-available-from date', async () => {
      const file = await makeTempIgnore(quarantineEntry({ 'Fix-available-from': '10-08-2026' }));
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 5, 12)),
      });
      expect(result.stale.map((s) => s.reason)).toContain('invalid-fix-available-from');
    });
  });

  describe('reporting', () => {
    it('tells the reader to run regen-lockfile when a fix has become available', async () => {
      const file = await makeTempIgnore(
        quarantineEntry({ 'Fix-available-from': '2026-08-10', 'Re-check-by': '2026-08-14' }),
      );
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 11, 12)),
      });
      const md = renderMarkdownReport(result);
      expect(md).toMatch(/regen-lockfile/);
      expect(md).toMatch(/4\.1\.2/);
    });

    it('does not offer the +90 day bump as an option for a quarantine entry', async () => {
      const file = await makeTempIgnore(
        quarantineEntry({ Reviewed: '2026-08-04', 'Re-check-by': '2026-11-02' }),
      );
      const result = await checkTrivyIgnore({
        filePath: file,
        now: new Date(Date.UTC(2026, 7, 5, 12)),
      });
      const md = renderMarkdownReport(result);
      expect(md).toMatch(/quarantine/i);
    });
  });

  // Contract test against the file that actually ships. The unit tests above
  // all use synthetic fixtures, which cannot catch a real entry that was hand
  // written with a typo'd field name or a missing class. This one reads the
  // committed .trivyignore, so a malformed entry fails CI at the unit layer
  // instead of silently degrading the weekly review.
  describe('the real repo .trivyignore', () => {
    const realPath = path.resolve(__dirname, '..', '..', '..', '.trivyignore');

    it('every entry declares a recognised Class', async () => {
      const content = await fs.readFile(realPath, 'utf8');
      const entries = parseTrivyIgnore(content);
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        // rawClass may be undefined (legacy default), but if written it must parse.
        if (e.rawClass !== undefined) {
          expect(['judgment', 'quarantine-window']).toContain(e.rawClass);
        }
        expect(['judgment', 'quarantine-window']).toContain(e.entryClass);
      }
    });

    it('every quarantine-window entry carries Fixed-version and a valid Fix-available-from', async () => {
      const content = await fs.readFile(realPath, 'utf8');
      const entries = parseTrivyIgnore(content);
      for (const e of entries.filter((x) => x.entryClass === 'quarantine-window')) {
        expect(e.fixedVersion).toBeTruthy();
        expect(e.fixAvailableFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // The whole point of the class: the hold must be short.
        expect(e.reviewedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(e.recheckBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const reviewed = Date.parse(e.reviewedDate as string);
        const recheck = Date.parse(e.recheckBy as string);
        const days = (recheck - reviewed) / 86_400_000;
        expect(days).toBeLessThanOrEqual(MAX_QUARANTINE_WINDOW_DAYS);
      }
    });

    it('contains no em-dash, per the repo character rule', async () => {
      const content = await fs.readFile(realPath, 'utf8');
      expect(content).not.toMatch(/\u2014/);
    });
  });
});
