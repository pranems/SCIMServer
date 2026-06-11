/**
 * a11y-playwright.ts - Playwright-side accessibility helper.
 *
 * Phase H2: complements the vitest-layer `web/src/test/a11y-helper.ts`.
 * Wraps `@axe-core/playwright` so every Playwright spec gets the same
 * severity threshold and rule override set as the unit tests.
 *
 * Severity threshold: `serious` + `critical` violations fail the gate.
 * `minor` and `moderate` violations are reported but do not fail (the
 * idea is to track them as known issues, not block PRs on them - this
 * matches the WCAG 2.1 AA conformance bar Microsoft uses for first-
 * party Fluent UI testing).
 *
 * Usage in a spec:
 *
 *   import { assertNoA11yViolationsOnPage } from './a11y-playwright';
 *
 *   test('dashboard a11y', async ({ page }) => {
 *     await page.goto('/');
 *     await assertNoA11yViolationsOnPage(page);
 *   });
 *
 * @see web/src/test/a11y-helper.ts (vitest counterpart)
 * @see docs/PHASE_H2_AXE_A11Y_GATE.md
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Severity buckets axe assigns to each rule. */
export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** Severity levels that fail the gate. */
export const FAIL_IMPACTS: ReadonlyArray<AxeImpact> = ['serious', 'critical'];

/**
 * Rules disabled at the Playwright layer with justification.
 *
 * Unlike the vitest helper, Playwright runs against the real Chromium
 * rendering pipeline so we keep `color-contrast` enabled. The only
 * disabled rule is `color-contrast-enhanced` (WCAG AAA - one tier
 * stricter than our WCAG AA conformance bar).
 */
const DEFAULT_PLAYWRIGHT_DISABLED_RULES: ReadonlyArray<string> = [
  // WCAG AAA, not the WCAG AA bar we test against. Most enterprise
  // SaaS, including Microsoft's first-party tools, target AA.
  'color-contrast-enhanced',
];

/**
 * Run axe-core against `page` (or a locator scope) and assert that
 * there are zero `serious` / `critical` violations.
 *
 * Optional `disabledRules` is merged onto the default disabled set for
 * per-test rule overrides without polluting the global config.
 */
export async function assertNoA11yViolationsOnPage(
  page: Page,
  options: {
    /** Restrict the analysis to a CSS-selector subtree. */
    scope?: string;
    /** Per-test rule overrides (merged onto the default disabled set). */
    disabledRules?: string[];
  } = {},
): Promise<void> {
  const disabled = [...DEFAULT_PLAYWRIGHT_DISABLED_RULES, ...(options.disabledRules ?? [])];

  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(disabled);

  if (options.scope) {
    builder = builder.include(options.scope);
  }

  const results = await builder.analyze();

  const failing = results.violations.filter(
    (v) => v.impact && FAIL_IMPACTS.includes(v.impact as AxeImpact),
  );

  if (failing.length > 0) {
    // Build a detailed message so the CI report contains the rule id,
    // impact, help URL, and the first few offending nodes - everything
    // needed to fix the violation without re-running locally.
    const detail = failing
      .map((v) => {
        const nodes = v.nodes
          .slice(0, 3)
          .map((n) => `      ${n.target.join(' ')} -> ${n.failureSummary?.split('\n')[0] ?? 'no summary'}`)
          .join('\n');
        return `  [${v.impact}] ${v.id}: ${v.description}\n    Help: ${v.helpUrl}\n    Nodes:\n${nodes}`;
      })
      .join('\n\n');
    throw new Error(
      `axe-core reported ${failing.length} ${failing.length === 1 ? 'violation' : 'violations'} (serious/critical):\n\n${detail}`,
    );
  }

  // Surface as a satisfied expect() so the spec report shows the gate
  // ran (otherwise a no-op would look like an empty test).
  expect(failing.length).toBe(0);
}
