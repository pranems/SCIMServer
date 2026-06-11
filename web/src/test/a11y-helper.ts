/**
 * a11y-helper.ts - vitest-side accessibility assertion helper for the
 * redesigned UI.
 *
 * Phase H2: provides `assertNoA11yViolations(element)` which runs the
 * full axe-core rule pack against any rendered HTMLElement and fails
 * the test if any `serious` or `critical` violation is found.
 *
 * This is the unit-test counterpart to the Playwright `@axe-core/playwright`
 * integration in `web/e2e/a11y-playwright.ts`. The two helpers share the
 * same severity threshold and rule overrides so a violation that fails
 * vitest also fails the e2e run (and vice versa) - one source of truth
 * for what counts as an a11y regression.
 *
 * Why both layers:
 *   - vitest catches regressions per-component during PR review (fast,
 *     no browser needed, runs on every push)
 *   - Playwright catches regressions in the assembled page (real DOM,
 *     real layout, real focus management), runs nightly on dev
 *
 * Design notes:
 *   - axe-core needs a real DOM. jsdom (vitest's default environment)
 *     is sufficient for structural checks (label-for, button-name,
 *     duplicate-id, aria-required-attr, color-contrast on computed
 *     styles, etc.).
 *   - We disable `color-contrast` in the vitest layer because jsdom's
 *     `getComputedStyle` does not run the Fluent UI theme resolver, so
 *     every Fluent component reports a "contrast 0:0" false positive.
 *     Real color-contrast checking lives in the Playwright spec where
 *     the Chromium engine renders the actual theme tokens.
 *   - Rule overrides are documented inline so future contributors can
 *     see *why* a rule is disabled instead of guessing.
 *
 * @see web/e2e/a11y-playwright.ts (the Playwright counterpart)
 * @see docs/PHASE_H2_AXE_A11Y_GATE.md
 */
import axe, { type AxeResults, type RunOptions, type Result } from 'axe-core';

/** Severity buckets axe assigns to each rule. */
export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** Severity levels that fail the gate. */
export const FAIL_IMPACTS: ReadonlyArray<AxeImpact> = ['serious', 'critical'];

/**
 * The default rule override set, applied to every assertion in vitest.
 *
 * Each disabled rule has an inline justification and a follow-up tag
 * (Playwright catches the rule, so the gate is not weakened overall).
 */
export const DEFAULT_VITEST_RULE_OVERRIDES: RunOptions['rules'] = {
  // jsdom does not resolve Fluent UI's design-token-driven colors. Every
  // Fluent control trips a "contrast 0:0" false positive. Caught by the
  // Playwright a11y spec where Chromium renders the real theme.
  'color-contrast': { enabled: false },
  // The router's <Outlet /> renders one route at a time so there is
  // never a "main" landmark in component-isolation tests. Caught at
  // page level by the Playwright spec.
  'region': { enabled: false },
  // Same reason - landmark-one-main expects exactly one <main>, which
  // only exists when the AppShell wraps the route. Component tests
  // render a slice without the shell.
  'landmark-one-main': { enabled: false },
};

/**
 * Run axe against the supplied element and return its results.
 *
 * Most callers should use `assertNoA11yViolations` instead - this raw
 * accessor exists for tests that want to make custom assertions
 * against the violation set (e.g. "exactly 1 'minor' violation about X").
 */
export async function runAxe(
  element: Element,
  rulesOverride?: RunOptions['rules'],
): Promise<AxeResults> {
  return axe.run(element, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { ...DEFAULT_VITEST_RULE_OVERRIDES, ...(rulesOverride ?? {}) },
  });
}

/**
 * Format a single axe violation into a one-line human-readable string
 * with the rule id, impact, the failing nodes, and the help URL.
 *
 * Used in the assertion error message so the failing test report
 * points the developer straight at the offending DOM + the docs.
 */
function formatViolation(v: Result): string {
  const nodes = v.nodes
    .slice(0, 3)
    .map((n) => `      ${n.target.join(' ')} -> ${n.failureSummary?.split('\n')[0] ?? 'no summary'}`)
    .join('\n');
  return `  [${v.impact}] ${v.id}: ${v.description}\n    Help: ${v.helpUrl}\n    Nodes:\n${nodes}`;
}

/**
 * Assert that `element` has zero `serious` / `critical` axe violations.
 *
 * On failure throws an Error whose message lists every offending rule,
 * its impact, the first few failing DOM nodes, and the help URL - so
 * the test report contains everything needed to fix the violation
 * without re-running locally.
 *
 * @param element The rendered container (typically `screen.container`
 *   from @testing-library, or `document.body` for whole-page tests)
 * @param rulesOverride Per-test rule override, merged onto the
 *   default vitest overrides. Use to silence a single rule for one
 *   test without polluting the global set.
 */
export async function assertNoA11yViolations(
  element: Element,
  rulesOverride?: RunOptions['rules'],
): Promise<void> {
  const results = await runAxe(element, rulesOverride);
  const failing = results.violations.filter(
    (v) => v.impact && FAIL_IMPACTS.includes(v.impact as AxeImpact),
  );
  if (failing.length === 0) return;

  const detail = failing.map(formatViolation).join('\n\n');
  throw new Error(
    `axe-core reported ${failing.length} ${failing.length === 1 ? 'violation' : 'violations'} (serious/critical):\n\n${detail}`,
  );
}
