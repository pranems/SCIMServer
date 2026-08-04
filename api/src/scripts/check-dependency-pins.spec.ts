/**
 * Tests for check-dependency-pins - the npm `overrides` watcher.
 *
 * WHY THIS EXISTS
 * ---------------
 * api/package.json pins 8 transitive packages via `overrides`, each added to
 * fix a HIGH CVE at some point in the past. Two properties make that list
 * dangerous over time:
 *
 *   1. An override FREEZES the version. The dependency tree can never float
 *      off it, so the pin cannot self-heal when upstream ships a fix.
 *   2. Dependabot does not manage the `overrides` block, so nothing proposes
 *      changing it.
 *
 * The consequence is that every pin is a time bomb: the version pinned as the
 * FIX for one advisory can later become the VULNERABLE version of the next.
 * That is exactly what happened with fast-uri - pinned at 3.1.4 to fix an
 * earlier CVE, and 3.1.4 is the vulnerable version of CVE-2026-18446.
 *
 * Nothing in the repo watched for this. Trivy caught it only after the image
 * was built, on a push, by failing a required status check.
 */
import {
  compareVersions,
  satisfiesGhsaRange,
  evaluatePins,
  renderPinReport,
  type PackageAdvisory,
} from './check-dependency-pins';

describe('compareVersions', () => {
  it('orders by numeric segment, not lexically', () => {
    // The whole reason this is hand-written rather than string-compared.
    // Lexically "3.1.10" < "3.1.9" and "10.0.0" < "9.0.0", both wrong.
    expect(compareVersions('3.1.10', '3.1.9')).toBeGreaterThan(0);
    expect(compareVersions('10.0.0', '9.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('4.1', '4.1.0')).toBe(0);
    expect(compareVersions('4', '4.0.1')).toBeLessThan(0);
  });

  it('ranks a prerelease below its release', () => {
    expect(compareVersions('1.0.0-alpha.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-alpha.1')).toBeGreaterThan(0);
  });
});

describe('satisfiesGhsaRange', () => {
  // These are the literal range strings the GitHub Advisory API returned for
  // GHSA-7p8r-x3mc-p8w7 (fast-uri), kept verbatim as a regression fixture.
  it('matches the real fast-uri 3.x range', () => {
    expect(satisfiesGhsaRange('3.1.4', '>= 3.0.0, < 3.1.5')).toBe(true);
    expect(satisfiesGhsaRange('3.1.5', '>= 3.0.0, < 3.1.5')).toBe(false);
    expect(satisfiesGhsaRange('2.9.9', '>= 3.0.0, < 3.1.5')).toBe(false);
  });

  it('matches the real fast-uri 4.x range', () => {
    expect(satisfiesGhsaRange('4.1.1', '>= 4.0.0, < 4.1.2')).toBe(true);
    expect(satisfiesGhsaRange('4.1.2', '>= 4.0.0, < 4.1.2')).toBe(false);
  });

  it('matches an open-ended lower range', () => {
    expect(satisfiesGhsaRange('2.4.3', '< 2.4.4')).toBe(true);
    expect(satisfiesGhsaRange('2.4.4', '< 2.4.4')).toBe(false);
  });

  it('supports <=, > and =', () => {
    expect(satisfiesGhsaRange('1.2.3', '<= 1.2.3')).toBe(true);
    expect(satisfiesGhsaRange('1.2.4', '> 1.2.3')).toBe(true);
    expect(satisfiesGhsaRange('1.2.3', '> 1.2.3')).toBe(false);
    expect(satisfiesGhsaRange('1.2.3', '= 1.2.3')).toBe(true);
  });

  it('requires ALL comparators to hold, not any', () => {
    expect(satisfiesGhsaRange('5.0.0', '>= 3.0.0, < 3.1.5')).toBe(false);
  });

  it('returns false for an unparseable range rather than throwing', () => {
    // A range we cannot understand must never be reported as "safe by
    // silence" nor crash the job; the caller surfaces it separately.
    expect(satisfiesGhsaRange('1.0.0', 'sometimes')).toBe(false);
  });
});

describe('evaluatePins', () => {
  const fastUriAdvisory: PackageAdvisory = {
    packageName: 'fast-uri',
    ghsaId: 'GHSA-7p8r-x3mc-p8w7',
    cveId: 'CVE-2026-18446',
    severity: 'high',
    summary: 'fast-uri vulnerable to host confusion via backslash authority introducer',
    vulnerableRanges: ['< 2.4.4', '>= 3.0.0, < 3.1.5', '>= 4.0.0, < 4.1.2'],
    firstPatchedVersions: ['2.4.4', '3.1.5', '4.1.2'],
  };

  it('flags a pinned version that is itself vulnerable', () => {
    const findings = evaluatePins({ 'fast-uri': '3.1.4' }, [fastUriAdvisory]);
    expect(findings).toHaveLength(1);
    expect(findings[0].packageName).toBe('fast-uri');
    expect(findings[0].pinnedVersion).toBe('3.1.4');
    expect(findings[0].cveId).toBe('CVE-2026-18446');
  });

  it('recommends the smallest patched version at or above the current pin', () => {
    // Pinned on 3.x, so 3.1.5 is the minimal move. Recommending 4.1.2 would be
    // a major bump nobody asked for; recommending 2.4.4 would be a downgrade.
    const findings = evaluatePins({ 'fast-uri': '3.1.4' }, [fastUriAdvisory]);
    expect(findings[0].recommendedVersion).toBe('3.1.5');
  });

  it('does NOT flag a pin that is already on a patched version', () => {
    expect(evaluatePins({ 'fast-uri': '4.1.2' }, [fastUriAdvisory])).toEqual([]);
  });

  it('does NOT flag a pin with no advisories at all', () => {
    expect(evaluatePins({ multer: '2.2.0' }, [fastUriAdvisory])).toEqual([]);
  });

  it('evaluates every pin, not just the first match', () => {
    const other: PackageAdvisory = {
      ...fastUriAdvisory,
      packageName: 'multer',
      ghsaId: 'GHSA-test',
      cveId: 'CVE-2026-0001',
      vulnerableRanges: ['< 3.0.0'],
      firstPatchedVersions: ['3.0.0'],
    };
    const findings = evaluatePins({ 'fast-uri': '3.1.4', multer: '2.2.0' }, [
      fastUriAdvisory,
      other,
    ]);
    expect(findings.map((f) => f.packageName).sort()).toEqual(['fast-uri', 'multer']);
  });
});

describe('renderPinReport', () => {
  it('states clearly that overrides do not self-heal and Dependabot will not fix them', () => {
    const md = renderPinReport(
      [
        {
          packageName: 'fast-uri',
          pinnedVersion: '3.1.4',
          cveId: 'CVE-2026-18446',
          ghsaId: 'GHSA-7p8r-x3mc-p8w7',
          severity: 'high',
          summary: 'host confusion',
          recommendedVersion: '3.1.5',
        },
      ],
      { pinCount: 8, now: '2026-08-04' },
    );
    expect(md).toMatch(/fast-uri/);
    expect(md).toMatch(/3\.1\.5/);
    expect(md).toMatch(/regen-lockfile/);
    expect(md).toMatch(/Dependabot/i);
  });

  it('says so plainly when every pin is clean', () => {
    const md = renderPinReport([], { pinCount: 8, now: '2026-08-04' });
    expect(md).toMatch(/8/);
    expect(md).not.toMatch(/GHSA-/);
  });
});
