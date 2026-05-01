/**
 * Tests for required CI/governance files - CODEOWNERS + PR template.
 *
 * Closes OPS-4 (DELIVERY_PLAN.md Week 1 Day 5). Asserts presence and
 * structural content. If any of these files goes missing or loses a required
 * checklist item, CI fails - the .github/ governance contract stays intact.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// Walk up from api/src/security to repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

describe('Required governance files', () => {
  describe('.github/CODEOWNERS', () => {
    let content: string | null;

    beforeAll(async () => {
      content = await readIfExists(path.join(REPO_ROOT, '.github', 'CODEOWNERS'));
    });

    it('exists at .github/CODEOWNERS', () => {
      expect(content).not.toBeNull();
    });

    it('contains a global default owner (* path entry)', () => {
      expect(content).not.toBeNull();
      const lines = (content ?? '').split(/\r?\n/);
      const hasGlobal = lines.some(
        (line) => /^\*\s+@/.test(line.trim()),
      );
      expect(hasGlobal).toBe(true);
    });

    it('declares an owner for the api/ directory (production code path)', () => {
      const lines = (content ?? '').split(/\r?\n/);
      const hasApi = lines.some((line) => /^\/?api(\/|\s).*@/.test(line.trim()));
      expect(hasApi).toBe(true);
    });

    it('declares an owner for the .github/ directory (CI ownership)', () => {
      const lines = (content ?? '').split(/\r?\n/);
      const hasGithub = lines.some((line) =>
        /^\/?\.github(\/|\s).*@/.test(line.trim()),
      );
      expect(hasGithub).toBe(true);
    });
  });

  describe('.github/pull_request_template.md', () => {
    let content: string | null;

    beforeAll(async () => {
      content = await readIfExists(
        path.join(REPO_ROOT, '.github', 'pull_request_template.md'),
      );
    });

    it('exists at .github/pull_request_template.md', () => {
      expect(content).not.toBeNull();
    });

    it.each([
      ['Unit Tests'],
      ['E2E Tests'],
      ['Live Integration Tests'],
      ['Feature Documentation'],
      ['INDEX.md Update'],
      ['CHANGELOG.md Update'],
      ['Session & Context Updates'],
      ['Version Management'],
      ['Response Contract Tests'],
    ])(
      'contains the "%s" item from the standing Feature/Bug-Fix Commit Checklist',
      (item) => {
        expect(content).not.toBeNull();
        expect(content).toMatch(new RegExp(item, 'i'));
      },
    );

    it('reminds the author about the no-em-dash standing rule', () => {
      expect(content).not.toBeNull();
      expect(content?.toLowerCase()).toContain('em-dash');
    });

    it('references the migration linter override mechanism for destructive migrations', () => {
      expect(content).not.toBeNull();
      expect(content).toMatch(/ALLOW_DESTRUCTIVE_MIGRATION/);
    });

    it('links to DELIVERY_PLAN.md so reviewers can locate the named defect ID', () => {
      expect(content).not.toBeNull();
      expect(content?.toLowerCase()).toContain('delivery_plan');
    });
  });

  describe('.github/dependabot.yml (OPS-3 - dependency update automation)', () => {
    let content: string | null;

    beforeAll(async () => {
      content = await readIfExists(path.join(REPO_ROOT, '.github', 'dependabot.yml'));
    });

    it('exists at .github/dependabot.yml', () => {
      expect(content).not.toBeNull();
    });

    it('declares package-ecosystem "npm" with directory api/', () => {
      expect(content).toMatch(/package-ecosystem:\s*["']?npm["']?/);
      expect(content).toMatch(/directory:\s*["']?\/api["']?/);
    });

    it('declares package-ecosystem "npm" with directory web/', () => {
      expect(content).toMatch(/directory:\s*["']?\/web["']?/);
    });

    it('declares package-ecosystem "github-actions"', () => {
      expect(content).toMatch(/package-ecosystem:\s*["']?github-actions["']?/);
    });

    it('declares package-ecosystem "docker"', () => {
      expect(content).toMatch(/package-ecosystem:\s*["']?docker["']?/);
    });

    it('uses weekly schedule (avoids PR flooding from daily updates)', () => {
      expect(content).toMatch(/interval:\s*["']?weekly["']?/);
    });
  });

  describe('.github/workflows/codeql.yml (OPS-3 - static analysis)', () => {
    let content: string | null;

    beforeAll(async () => {
      content = await readIfExists(
        path.join(REPO_ROOT, '.github', 'workflows', 'codeql.yml'),
      );
    });

    it('exists at .github/workflows/codeql.yml', () => {
      expect(content).not.toBeNull();
    });

    it('uses the official github/codeql-action/init action', () => {
      expect(content).toMatch(/github\/codeql-action\/init/);
    });

    it('uses the official github/codeql-action/analyze action', () => {
      expect(content).toMatch(/github\/codeql-action\/analyze/);
    });

    it('analyzes javascript-typescript (covers both API and web)', () => {
      expect(content).toMatch(/javascript-typescript|javascript|typescript/);
    });

    it('runs on a schedule (weekly background scan independent of PRs)', () => {
      expect(content).toMatch(/schedule:/);
      expect(content).toMatch(/cron:/);
    });
  });

  describe('Trivy step in build workflows (OPS-3 - container CVE scanning)', () => {
    it('build-and-push.yml runs aquasecurity/trivy-action on the built image', async () => {
      const wf = await readIfExists(
        path.join(REPO_ROOT, '.github', 'workflows', 'build-and-push.yml'),
      );
      expect(wf).not.toBeNull();
      expect(wf).toMatch(/aquasecurity\/trivy-action/);
      // Severity gate: must fail on at least HIGH+CRITICAL.
      expect(wf).toMatch(/HIGH|CRITICAL/);
    });

    it('build-test.yml runs aquasecurity/trivy-action on the built image', async () => {
      const wf = await readIfExists(
        path.join(REPO_ROOT, '.github', 'workflows', 'build-test.yml'),
      );
      expect(wf).not.toBeNull();
      expect(wf).toMatch(/aquasecurity\/trivy-action/);
      expect(wf).toMatch(/HIGH|CRITICAL/);
    });
  });
});
