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
});
