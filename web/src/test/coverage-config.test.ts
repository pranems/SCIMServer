/**
 * Phase H4 - vitest coverage gate config contract test.
 *
 * Verifies that the coverage block in [web/vite.config.ts](../../vite.config.ts)
 * declares the V8 provider, the documented include / exclude lists, and
 * the ratchet-floor thresholds so a future PR cannot accidentally
 * weaken (or remove) the gate.
 *
 * Why this test exists: the coverage gate is enforced by vitest at
 * runtime, but if someone edits `vite.config.ts` and drops the
 * `thresholds` block, the gate silently disappears. This test reads
 * the config file as text and asserts the gate-critical fields are
 * present.
 *
 * @see docs/PHASE_H4_COVERAGE_GATES.md
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'vite.config.ts');
const CONFIG_TEXT = fs.readFileSync(CONFIG_PATH, 'utf-8');

describe('Phase H4 - coverage gate config contract', () => {
  it('declares the V8 coverage provider', () => {
    expect(CONFIG_TEXT).toMatch(/provider:\s*['"]v8['"]/);
  });

  it('reports to ../test-results/web-coverage so CI can collect artifacts', () => {
    expect(CONFIG_TEXT).toMatch(/reportsDirectory:\s*['"]\.\.\/test-results\/web-coverage['"]/);
  });

  it('emits text + html + lcov + json-summary reporters', () => {
    expect(CONFIG_TEXT).toMatch(/reporter:\s*\[[\s\S]*?'text'/);
    expect(CONFIG_TEXT).toMatch(/'html'/);
    expect(CONFIG_TEXT).toMatch(/'lcov'/);
    expect(CONFIG_TEXT).toMatch(/'json-summary'/);
  });

  it('declares ratchet-floor thresholds (lines>=78, branches>=70, functions>=65, statements>=75)', () => {
    // Match each threshold individually so a partial edit is caught.
    // The values intentionally encode the Phase H4 baseline measurement
    // documented in vite.config.ts. Raising thresholds is OK; lowering
    // is not (a coverage gate that only ratchets up).
    const linesMatch = CONFIG_TEXT.match(/lines:\s*(\d+)/);
    const branchesMatch = CONFIG_TEXT.match(/branches:\s*(\d+)/);
    const functionsMatch = CONFIG_TEXT.match(/functions:\s*(\d+)/);
    const statementsMatch = CONFIG_TEXT.match(/statements:\s*(\d+)/);

    expect(linesMatch).not.toBeNull();
    expect(branchesMatch).not.toBeNull();
    expect(functionsMatch).not.toBeNull();
    expect(statementsMatch).not.toBeNull();

    expect(Number(linesMatch![1])).toBeGreaterThanOrEqual(78);
    expect(Number(branchesMatch![1])).toBeGreaterThanOrEqual(70);
    expect(Number(functionsMatch![1])).toBeGreaterThanOrEqual(65);
    expect(Number(statementsMatch![1])).toBeGreaterThanOrEqual(75);
  });

  it('explicitly excludes test infrastructure + bootstrap files (no-logic surface)', () => {
    // After Phase I2 deleted the legacy component tree, the only
    // exclusions left are bootstrap (main.tsx / App.tsx) + design
    // tokens (no logic) + test infrastructure (test files exclude
    // themselves; src/test/** is helpers).
    const expectedExcludes = [
      'src/main.tsx',
      'src/App.tsx',
      'src/env.d.ts',
      'src/design/**',
      'src/test/**',
    ];
    for (const pattern of expectedExcludes) {
      const literal = pattern.replace(/\*/g, '\\*');
      expect(
        CONFIG_TEXT,
        `expected exclude list to contain ${pattern}`,
      ).toMatch(new RegExp(`['"]${literal}['"]`));
    }
  });

  it('uses the wide src/**/*.{ts,tsx} include after Phase I2 legacy cleanup', () => {
    // Pre-I2 the include was a per-folder allowlist (api/queries.ts,
    // components/primitives/**, hooks/**, etc) because the legacy tree
    // would otherwise drag coverage down. Phase I2 deleted the legacy
    // tree, so the include can be the whole src/ tree.
    expect(CONFIG_TEXT).toMatch(/['"]src\/\*\*\/\*\.\{ts,tsx\}['"]/);
  });
});
