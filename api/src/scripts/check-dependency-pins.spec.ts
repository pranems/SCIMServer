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
  runCli,
  type PackageAdvisory,
} from './check-dependency-pins';
import fs from 'fs/promises';
import { dirname, resolve } from 'node:path';

describe('request-body security remediation (#256)', () => {
  it('gives every compatible iconv-lite owner one exact shared override context', async () => {
    const manifest = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { overrides: Record<string, unknown> };
    const lock = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../package-lock.json'), 'utf8'),
    ) as {
      packages: Record<string, {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      }>;
    };
    const owners = Object.entries(lock.packages).flatMap(([path, entry]) =>
      ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap(kind => {
        const range = entry[kind as keyof typeof entry]?.['iconv-lite'];
        return range ? [[path, range]] : [];
      }),
    );
    expect(owners).toEqual([
      ['node_modules/body-parser', '^0.7.3'],
      ['node_modules/mysql2', '^0.7.2'],
      ['node_modules/raw-body', '~0.7.0'],
    ]);
    const overridePaths: string[] = [];
    const collect = (overrides: Record<string, unknown>, parents: string[] = []): void => {
      for (const [selector, value] of Object.entries(overrides)) {
        const path = [...parents, selector];
        if (selector.includes('iconv-lite')) overridePaths.push(path.join(' > '));
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          collect(value as Record<string, unknown>, path);
        }
      }
    };
    collect(manifest.overrides);
    expect(overridePaths).toEqual(['iconv-lite']);
    expect(manifest.overrides['iconv-lite']).toBe('0.7.3');
    for (const [owner] of owners) {
      const ownerPath = resolve(__dirname, '../..', owner, 'package.json');
      const installedPath = require.resolve('iconv-lite/package.json', { paths: [dirname(ownerPath)] });
      const installed = JSON.parse(await fs.readFile(installedPath, 'utf8')) as { version: string };
      expect(installed.version).toBe('0.7.3');
    }
  });

  it.each([
    ['body-parser', '2.3.0', '2.4.0', '>= 2.0.0, < 2.4.0'],
    ['multer', '2.4.0', '2.5.0', '>= 2.0.0, < 2.5.0'],
  ])('pins %s to the exact patched 2.x release', async (name, oldVersion, patched, range) => {
    const manifest = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { overrides: Record<string, string> };
    expect(satisfiesGhsaRange(oldVersion, range)).toBe(true);
    expect(satisfiesGhsaRange(patched, range)).toBe(false);
    expect(manifest.overrides[name]).toBe(patched);
  });

  it('covers the actual Express and Nest multipart ownership without adding browser parsers', async () => {
    const api = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { dependencies?: Record<string, string> }> };
    const web = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../../web/package-lock.json'), 'utf8'),
    ) as { packages: Record<string, unknown> };
    expect(api.packages['node_modules/express'].dependencies?.['body-parser']).toBeDefined();
    expect(api.packages['node_modules/@nestjs/platform-express'].dependencies?.multer).toBeDefined();
    for (const name of ['body-parser', 'multer']) {
      expect(Object.keys(api.packages).filter(path =>
        path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`,
      ).length).toBeGreaterThan(0);
      expect(Object.keys(web.packages).filter(path =>
        path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`,
      )).toEqual([]);
    }
  });

  it.each([
    ['body-parser', '2.4.0', 'express', '>= 2.0.0, < 2.4.0'],
    ['multer', '2.5.0', '@nestjs/platform-express', '>= 2.0.0, < 2.5.0'],
  ])('locks every actual %s occurrence to the patched release with public provenance', async (name, patched, owner, range) => {
    const lock = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../package-lock.json'), 'utf8'),
    ) as {
      packages: Record<string, { version: string; resolved?: string; integrity?: string }>;
    };
    const entries = Object.entries(lock.packages).filter(([path]) =>
      path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`,
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const [, entry] of entries) {
      expect(entry.version).toBe(patched);
      expect(satisfiesGhsaRange(entry.version, range)).toBe(false);
      expect(entry.resolved).toBe(`https://registry.npmjs.org/${name}/-/${name}-${patched}.tgz`);
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
    const ownerPath = require.resolve(`${owner}/package.json`);
    const installedPath = require.resolve(`${name}/package.json`, { paths: [dirname(ownerPath)] });
    const installed = JSON.parse(await fs.readFile(installedPath, 'utf8')) as { version: string };
    expect(installed.version).toBe(patched);
  });
});

describe('web ip-address security remediation (GHSA-rxp7-6hxx-x8q5)', () => {
  const vulnerableRange = '<= 10.7.3';

  it('recognizes the active advisory boundary and the minimal exact patch', () => {
    expect(satisfiesGhsaRange('10.7.1', vulnerableRange)).toBe(true);
    expect(satisfiesGhsaRange('10.7.3', vulnerableRange)).toBe(true);
    expect(satisfiesGhsaRange('10.7.4', vulnerableRange)).toBe(false);
    const advisory: PackageAdvisory = {
      packageName: 'ip-address',
      ghsaId: 'GHSA-rxp7-6hxx-x8q5',
      cveId: 'CVE-2026-111997',
      severity: 'medium',
      summary: 'Address6 performs quadratic zone-identifier matching before its length limit',
      vulnerableRanges: [vulnerableRange],
      firstPatchedVersions: ['10.7.4'],
    };
    expect(evaluatePins({ 'ip-address': '10.7.1' }, [advisory])[0].recommendedVersion)
      .toBe('10.7.4');
    expect(evaluatePins({ 'ip-address': '10.7.4' }, [advisory])).toEqual([]);
  });

  it('pins the dormant web override exactly without introducing a dependency', async () => {
    const manifest = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../../web/package.json'), 'utf8'),
    ) as { overrides: Record<string, string> };
    const lock = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../../web/package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { dependencies?: Record<string, string> }> };
    expect(manifest.overrides['ip-address']).toBe('10.7.4');
    // This is an override-only correction, not a new parser dependency.
    expect(Object.keys(lock.packages).filter(name =>
      /(?:^|\/)node_modules\/ip-address$/.test(name),
    )).toEqual([]);
    expect(Object.values(lock.packages).filter(entry =>
      Object.hasOwn(entry.dependencies ?? {}, 'ip-address'),
    )).toEqual([]);
  });
});

describe('Hono security remediation (GHSA-5r4p-p66f-jhc7)', () => {
  const vulnerableRange = '>= 4.12.4, < 4.13.11';

  it('recognizes the affected range and recommends the minimal exact patch', () => {
    expect(satisfiesGhsaRange('4.12.3', vulnerableRange)).toBe(false);
    expect(satisfiesGhsaRange('4.13.7', vulnerableRange)).toBe(true);
    expect(satisfiesGhsaRange('4.13.11', vulnerableRange)).toBe(false);
    const findings = evaluatePins(
      { hono: '4.13.7' },
      [{
        packageName: 'hono',
        ghsaId: 'GHSA-5r4p-p66f-jhc7',
        cveId: 'CVE-2026-111757',
        severity: 'medium',
        summary: 'serveStatic double decoding can bypass protected static-prefix middleware',
        vulnerableRanges: [vulnerableRange],
        firstPatchedVersions: ['4.13.11'],
      }],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].recommendedVersion).toBe('4.13.11');
  });

  it('locks every actual Hono occurrence to the exact patched override with public provenance', async () => {
    const manifest = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { overrides: { hono: string } };
    const lock = JSON.parse(
      await fs.readFile(resolve(__dirname, '../../package-lock.json'), 'utf8'),
    ) as {
      packages: Record<string, { version: string; resolved?: string; integrity?: string }>;
    };
    const entries = Object.entries(lock.packages).filter(([name]) =>
      /(?:^|\/)node_modules\/hono$/.test(name),
    );
    expect(manifest.overrides.hono).toBe('4.13.11');
    expect(entries.length).toBeGreaterThan(0);
    for (const [, entry] of entries) {
      expect(entry.version).toBe(manifest.overrides.hono);
      expect(satisfiesGhsaRange(entry.version, vulnerableRange)).toBe(false);
      expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\/hono\/-\//);
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
  });
});

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

  it('checks version-qualified override selectors against the package advisory', () => {
    const findings = evaluatePins({ 'fast-uri@^3.0.0': '3.1.4', 'fast-uri@^4.0.0': '4.1.2' }, [
      fastUriAdvisory,
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].packageName).toBe('fast-uri');
    expect(findings[0].pinnedVersion).toBe('3.1.4');
  });

  it('preserves scoped names when removing the version selector', () => {
    const advisory = { ...fastUriAdvisory, packageName: '@example/fast-uri' };
    expect(
      evaluatePins({ '@example/fast-uri@^3.0.0': '3.1.4', '@example/fast-uri': '4.1.2' }, [
        advisory,
      ]),
    ).toHaveLength(1);
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

describe('runCli', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads both workspaces and queries package names, not version selectors', async () => {
    const read = jest
      .spyOn(fs, 'readFile')
      .mockResolvedValueOnce(JSON.stringify({ overrides: { 'fast-uri@^3.0.0': '3.1.5' } }))
      .mockResolvedValueOnce(JSON.stringify({ overrides: { seroval: '1.6.3' } }));
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(await runCli()).toBe(0);
    expect(read).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/[\\/]api[\\/]package\.json$/),
      'utf8',
    );
    expect(read).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/[\\/]web[\\/]package\.json$/),
      'utf8',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('affects=fast-uri&'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('affects=seroval&'),
      expect.any(Object),
    );
    expect(output).toHaveBeenCalledWith(expect.stringContaining('web/package.json'));
  });
});
