/**
 * npm `overrides` pin watcher - the counterpart to the .trivyignore review.
 *
 * WHY THIS EXISTS
 * ---------------
 * api/package.json pins transitive packages via `overrides`, each added to
 * resolve a HIGH CVE. Two properties make that list dangerous over time:
 *
 *   1. An override FREEZES the version. The dependency tree can never float
 *      off it, so the pin cannot self-heal when upstream ships a fix.
 *   2. Dependabot does not manage the `overrides` block, so nothing ever
 *      proposes changing it.
 *
 * So every pin is a time bomb: the version pinned as the FIX for one advisory
 * can later become the VULNERABLE version of the next. fast-uri did exactly
 * that - pinned at 3.1.4 to fix an earlier CVE, and 3.1.4 is the vulnerable
 * version of CVE-2026-18446. Nothing watched for it; Trivy caught it only
 * after building the image, by failing a required status check on a push.
 *
 * This script asks the GitHub Advisory Database, for each pinned package,
 * whether the pinned version falls inside any known vulnerable range, and
 * recommends the smallest patched version at or above the current pin.
 *
 * DESIGN NOTE - no semver dependency on purpose.
 * `semver` is present only as a TRANSITIVE dependency with no @types, so
 * importing it would be a phantom dependency, and adding it directly would
 * require regenerating a lockfile - which cannot be done safely on a
 * corp-managed device (see docs/strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md).
 * GHSA ranges are a tiny grammar, so the comparator below is hand-written and
 * fully unit-tested instead.
 *
 * Used by:
 *   - .github/workflows/dependency-pins-review.yml (scheduled, opens an Issue)
 *   - `npm run check:pins` (local on-demand; needs network)
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface PackageAdvisory {
  packageName: string;
  ghsaId: string;
  cveId: string | null;
  severity: string;
  summary: string;
  /** Raw GHSA range strings, e.g. ">= 3.0.0, < 3.1.5". */
  vulnerableRanges: string[];
  /** First patched version per corresponding range. */
  firstPatchedVersions: string[];
}

export interface PinFinding {
  packageName: string;
  pinnedVersion: string;
  cveId: string | null;
  ghsaId: string;
  severity: string;
  summary: string;
  /** Smallest patched version at or above the pin, or null if none applies. */
  recommendedVersion: string | null;
}

/**
 * Compare two dotted version strings numerically.
 *
 * Hand-written because a lexical compare is wrong in ways that matter here:
 * "3.1.10" < "3.1.9" and "10.0.0" < "9.0.0" are both true as strings and both
 * false as versions. A prerelease ranks below its release (1.0.0-rc < 1.0.0).
 *
 * Returns <0, 0 or >0 like a standard comparator.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): { nums: number[]; pre: string | null } => {
    const [core, ...rest] = v.trim().split('-');
    return {
      nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      pre: rest.length > 0 ? rest.join('-') : null,
    };
  };
  const va = split(a);
  const vb = split(b);
  const len = Math.max(va.nums.length, vb.nums.length);
  for (let i = 0; i < len; i++) {
    // A missing segment is zero, so "4.1" and "4.1.0" are equal.
    const d = (va.nums[i] ?? 0) - (vb.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (va.pre === vb.pre) return 0;
  // Having a prerelease makes a version LOWER than the same core release.
  if (va.pre !== null && vb.pre === null) return -1;
  if (va.pre === null && vb.pre !== null) return 1;
  return (va.pre as string) < (vb.pre as string) ? -1 : 1;
}

const RE_COMPARATOR = /^(>=|<=|>|<|=)\s*(\d[\w.+-]*)$/;

/**
 * Does `version` fall inside a GHSA `vulnerable_version_range`?
 *
 * The grammar is a comma-separated conjunction of comparators, e.g.
 *   "< 2.4.4"                 -> one comparator
 *   ">= 3.0.0, < 3.1.5"       -> ALL must hold
 *
 * An unparseable range returns false. That is deliberate: this function must
 * never throw inside a scheduled job, and the caller reports unparseable
 * ranges separately rather than letting them read as "safe by silence".
 */
export function satisfiesGhsaRange(version: string, range: string): boolean {
  const parts = range
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;

  for (const part of parts) {
    const m = RE_COMPARATOR.exec(part);
    if (!m) return false;
    const [, op, bound] = m;
    const c = compareVersions(version, bound);
    const ok =
      op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
    if (!ok) return false;
  }
  return true;
}

/**
 * Given the `overrides` map and the advisories fetched for those packages,
 * return one finding per pin that sits inside a vulnerable range.
 */
export function evaluatePins(
  pins: Readonly<Record<string, string>>,
  advisories: ReadonlyArray<PackageAdvisory>,
): PinFinding[] {
  const findings: PinFinding[] = [];

  for (const [packageName, pinnedVersion] of Object.entries(pins)) {
    for (const adv of advisories.filter((a) => a.packageName === packageName)) {
      const hitIndex = adv.vulnerableRanges.findIndex((r) => satisfiesGhsaRange(pinnedVersion, r));
      if (hitIndex === -1) continue;

      // Recommend the smallest patched version that is not a DOWNGRADE from
      // the current pin. An advisory usually lists one patched version per
      // affected major line, so picking the global minimum would move us
      // backwards, and picking the maximum would force an unrequested major.
      const forward = adv.firstPatchedVersions
        .filter((v) => compareVersions(v, pinnedVersion) > 0)
        .sort(compareVersions);

      findings.push({
        packageName,
        pinnedVersion,
        cveId: adv.cveId,
        ghsaId: adv.ghsaId,
        severity: adv.severity,
        summary: adv.summary,
        recommendedVersion: forward[0] ?? null,
      });
    }
  }

  return findings;
}

export interface PinReportContext {
  pinCount: number;
  now: string;
}

/** Render a Markdown report suitable for a GitHub Issue body. */
export function renderPinReport(
  findings: ReadonlyArray<PinFinding>,
  ctx: PinReportContext,
): string {
  const lines: string[] = [];
  lines.push('# Pinned dependency review');
  lines.push('');
  lines.push(`Date:  ${ctx.now}`);
  lines.push(`Pins:  ${ctx.pinCount} in \`api/package.json\` \`overrides\``);
  lines.push(`Flagged: ${findings.length}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push(`All ${ctx.pinCount} pinned versions are clear of known advisories. No action required.`);
    return lines.join('\n');
  }

  lines.push('## Pins that are themselves vulnerable');
  lines.push('');
  lines.push(
    'Each of these was pinned to FIX an advisory. The pinned version has since become the VULNERABLE version of another one.',
  );
  lines.push('');
  for (const f of findings) {
    lines.push(`### \`${f.packageName}@${f.pinnedVersion}\``);
    lines.push('');
    lines.push(`- **Advisory**: ${f.ghsaId}${f.cveId ? ` (${f.cveId})` : ''} - ${f.severity}`);
    lines.push(`- **Summary**: ${f.summary}`);
    if (f.recommendedVersion) {
      lines.push(`- **Move to**: \`${f.recommendedVersion}\` (smallest patched version at or above the current pin)`);
    } else {
      lines.push('- **Move to**: no patched version at or above the current pin. Needs a human decision.');
    }
    lines.push('');
  }

  lines.push('## Why this needs a human');
  lines.push('');
  lines.push(
    '**Dependabot does not manage the `overrides` block.** These pins are frozen: the dependency tree cannot float off them, so they will never self-heal and no bot will propose the change.',
  );
  lines.push('');
  lines.push('## What to do');
  lines.push('');
  lines.push('1. Edit the version in `api/package.json` `overrides`.');
  lines.push(
    '2. Check the target is at least 7 days old (`npm view <pkg> time --json`). If it is younger, do NOT take it - add a `Class: quarantine-window` entry to `.trivyignore` with `Fix-available-from` set to publish date + 7 days, and take the fix on that date.',
  );
  lines.push(
    '3. Regenerate the lockfile with the **regen-lockfile** workflow. Do NOT run `npm install --package-lock-only` on a corp-managed device - it rewrites `resolved` to an internal feed and downgrades `integrity` from sha512 to sha1.',
  );
  lines.push('4. Commit the regenerated lockfile, and drop any `.trivyignore` entry the fix retires in the same commit.');
  lines.push('');
  lines.push('Close this issue once the pins are updated. The workflow re-runs on schedule and will reopen if anything regresses.');
  return lines.join('\n');
}

/** Read the `overrides` map out of a package.json. */
export async function readPins(packageJsonPath: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { overrides?: Record<string, string> };
  return parsed.overrides ?? {};
}

interface GhAdvisoryVulnerability {
  package?: { ecosystem?: string; name?: string };
  vulnerable_version_range?: string;
  first_patched_version?: string;
}

interface GhAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  severity: string;
  summary: string;
  vulnerabilities?: GhAdvisoryVulnerability[];
}

/**
 * Fetch advisories for one npm package from the GitHub Advisory Database.
 * Unauthenticated works but is rate limited; the workflow passes GITHUB_TOKEN.
 */
export async function fetchAdvisories(
  packageName: string,
  token?: string,
): Promise<PackageAdvisory[]> {
  const url = `https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(packageName)}&per_page=100`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'scimserver-dependency-pin-check',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub advisories query failed for ${packageName}: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as GhAdvisory[];

  return body.map((a) => {
    const rel = (a.vulnerabilities ?? []).filter(
      (v) => v.package?.ecosystem === 'npm' && v.package?.name === packageName,
    );
    return {
      packageName,
      ghsaId: a.ghsa_id,
      cveId: a.cve_id,
      severity: a.severity,
      summary: a.summary,
      vulnerableRanges: rel.map((v) => v.vulnerable_version_range ?? '').filter((s) => s.length > 0),
      firstPatchedVersions: rel
        .map((v) => v.first_patched_version ?? '')
        .filter((s) => s.length > 0),
    };
  });
}

/**
 * CLI entry. Exits non-zero when a pin is vulnerable so it can be used as a
 * gate, while the scheduled workflow turns the report into an Issue.
 */
export async function runCli(): Promise<number> {
  const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
  const pins = await readPins(pkgPath);
  const names = Object.keys(pins);
  const token = process.env.GITHUB_TOKEN;

  const advisories: PackageAdvisory[] = [];
  const failed: string[] = [];
  for (const name of names) {
    try {
      advisories.push(...(await fetchAdvisories(name, token)));
    } catch (err) {
      // A network failure must not read as "all clear".
      failed.push(`${name}: ${(err as Error).message}`);
    }
  }

  const findings = evaluatePins(pins, advisories);
  let report = renderPinReport(findings, {
    pinCount: names.length,
    now: new Date().toISOString().slice(0, 10),
  });
  if (failed.length > 0) {
    report += `\n\n## Could not be checked\n\nThese lookups failed, so their status is UNKNOWN - not clean:\n\n${failed
      .map((f) => `- ${f}`)
      .join('\n')}\n`;
  }

  process.stdout.write(report + '\n');
  process.stderr.write(
    `FINDING_COUNT=${findings.length}\nUNCHECKED_COUNT=${failed.length}\nOK=${findings.length === 0 && failed.length === 0 ? 'true' : 'false'}\n`,
  );
  return findings.length > 0 ? 1 : 0;
}

if (require.main === module) {
  runCli()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`check-dependency-pins failed: ${(err as Error).stack}\n`);
      process.exit(2);
    });
}
