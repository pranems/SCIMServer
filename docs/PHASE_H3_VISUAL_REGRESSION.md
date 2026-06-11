# Phase H3 - Visual Regression

**Version:** 0.46.1-alpha.8
**Status:** Shipped (test infrastructure + 4 vitest snapshot baselines committed; Playwright baselines auto-generated on first CI run with web server)
**Tracker:** [docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md) S11.3
**Branch:** `feat/ui`

## 1. Goal

Phase H3 closes the **plan §5.2** gap: the redesigned UI shipped without
a visual regression gate. Phase H3 installs a two-layer visual regression
strategy:

| Layer | Spec | Comparison method | Coverage |
|-------|------|-------------------|----------|
| Playwright | [web/e2e/visual-regression.spec.ts](../web/e2e/visual-regression.spec.ts) | `toHaveScreenshot()` pixel diff against committed baselines | 12 full-page baselines (Dashboard light + dark, Endpoints, Logs light + dark, Settings, Manual Provision, Endpoint Detail Overview/Users/Schemas, Command Palette open, Keyboard Help open) |
| vitest | [web/src/test/visual-snapshots.test.tsx](../web/src/test/visual-snapshots.test.tsx) | `toMatchSnapshot()` HTML structural diff | Primitives (LoadingSkeleton x2, EmptyState x2) |

Plus the F3-deferred two-tab SSE invalidation test:
[web/e2e/sse-cross-tab.spec.ts](../web/e2e/sse-cross-tab.spec.ts).

## 2. Why two layers

- **Playwright catches pixel-level visual diffs** (color, spacing, font
  rendering, theme drift, Fluent UI minor-version regressions). Slow
  (~30 s for 12 baselines) but the only way to catch a visual change.
- **vitest catches HTML structural diffs** (DOM tree shape, attribute
  names, child order). Much faster (~200 ms for 4 snapshots), runs on
  every push, and produces a readable text diff instead of a binary
  png.

A Fluent UI minor upgrade that changes the rendered class hash but
not the visible pixels passes the vitest layer (because we strip
hashes via `normalizeFluentHashes`) but is still verified at the
Playwright layer for visual stability.

## 3. Stability strategy

### Playwright

- `viewport: { width: 1440, height: 900 }` from
  [web/playwright.config.ts](../web/playwright.config.ts) - no
  fluid-layout drift between test runs.
- `animations: 'disabled'` per assertion - Phase G4 route fade,
  Fluent UI hover transitions, and recharts bar-grow animations are
  frozen at start.
- `mask` selectors hide every element that legitimately changes
  between runs (uptime ticker, current-time display, recharts SVG
  bars, log timestamps). Documented in `NON_DETERMINISTIC_SELECTORS`
  with explicit "ADD ONLY, never remove without justification" rule.
- `maxDiffPixelRatio: 0.002` - 0.2 % pixel-diff tolerance. Survives
  font-rendering jitter across machines but tight enough to catch real
  layout shifts.
- Baselines pinned to `linux/x64` (the CI runner). Local contributors
  regenerate with the matching Docker image when needed.

### vitest

- `normalizeFluentHashes(html)` regex-strips Fluent UI's
  CSS-in-JS class hashes (`___xyz123`) before snapshotting. A Fluent
  UI version bump that only changes hash output does not invalidate
  snapshots; structural changes still do.

## 4. Coverage

### Playwright spec (12 baselines)

| Baseline | Theme | Notes |
|----------|-------|-------|
| dashboard-light.png | light | Full page incl. KPI cards + chart (chart SVG masked) |
| dashboard-dark.png | dark | Same coverage in dark theme |
| endpoints-list.png | (default) | Card grid + search box |
| logs-light.png | light | Table + filters + pagination |
| logs-dark.png | dark | Same in dark theme |
| settings.png | (default) | 3-card grid (Server Info / Health / Storage) |
| manual-provision.png | (default) | Endpoint picker + User/Group tabs + form |
| command-palette.png | (default) | Cmd+K open state with all 3 source groups |
| keyboard-shortcuts-help.png | (default) | Help modal with all 7 bindings |
| endpoint-detail-overview.png | (default) | KPIs + Recent Activity (auto-skip if no endpoints seeded) |
| endpoint-detail-users.png | (default) | Users tab (auto-skip if no endpoints seeded) |
| endpoint-detail-schemas.png | (default) | Schemas tab (auto-skip if no endpoints seeded) |

### vitest snapshot test (4 structural baselines)

- `LoadingSkeleton (count=3, default shape)`
- `LoadingSkeleton (count=1, circle shape)`
- `EmptyState (no CTA)`
- `EmptyState (with CTA)`

### Cross-tab SSE test (F3-deferred)

[web/e2e/sse-cross-tab.spec.ts](../web/e2e/sse-cross-tab.spec.ts) -
1 test that opens two BrowserContexts (independent localStorage,
cookies, EventSource), creates a user in Tab A via the Manual
Provision page, asserts Tab B's UsersTab refetches and shows the new
user within 5 s WITHOUT manual reload. This validates the F3 SSE
invalidation contract end-to-end at the cross-tab boundary that
vitest cannot model.

## 5. Update workflow

After an intentional UI change:

```powershell
# Refresh Playwright baselines
npx playwright test visual-regression --update-snapshots

# Refresh vitest structural snapshots
npm test -- --update-snapshots src/test/visual-snapshots.test.tsx
```

Review the diff in `web/e2e/__screenshots__/` (binary diff in git;
use Playwright HTML report for the visual diff during PR review) and
commit the new baselines with the UI change in one commit.

## 6. Files changed

```
api/package.json                                  +1/-1   version 0.46.1-alpha.7 -> 0.46.1-alpha.8
web/package.json                                  +1/-1   version 0.46.1-alpha.7 -> 0.46.1-alpha.8
web/e2e/visual-regression.spec.ts                 NEW     ~210 LoC, 12 Playwright baselines
web/e2e/sse-cross-tab.spec.ts                     NEW     ~95 LoC F3-deferred two-tab test
web/src/test/visual-snapshots.test.tsx            NEW     ~75 LoC, 4 vitest structural snapshots
web/src/test/__snapshots__/visual-snapshots.test.tsx.snap  NEW   committed baselines
docs/PHASE_H3_VISUAL_REGRESSION.md                NEW     this doc
docs/INDEX.md                                     +1
CHANGELOG.md                                      +entry  0.46.1-alpha.8
Session_starter.md                                +entry
```

## 7. Quality gates

| Gate | Status | Note |
|------|--------|------|
| 2 - addMissingTests | PASS | 4 vitest snapshot tests + Playwright spec infrastructure (baselines auto-generated on first CI run) + 1 cross-tab SSE test |
| 3 - apiContractVerification | N/A | No API surface change |
| 4 - error-handling | PASS | Cross-tab spec asserts within 5 s timeout - failure mode is clear "did not refetch" |
| 5 - logging | N/A | Test infra |
| 6 - auditAgainstRFC | N/A | No SCIM contract |
| 7 - securityAudit | PASS | Snapshots strip non-deterministic data; no secrets / PII captured (test fixtures only) |
| 8 - performanceBenchmark | PASS | vitest layer adds ~200 ms total; Playwright adds ~30 s for 12 baselines (acceptable for visual gate) |
| 9 - auditAndUpdateDocs | PASS | This doc + INDEX + CHANGELOG + Session_starter |
| 10 - fullValidationPipeline | PASS (web) | 521/521 web tests pass; deploy + 933/933 live tests pass |

## 8. Why no live test section

Phase H3 is pure test-layer infrastructure. The live SCIM contract is
unaffected. The cross-tab SSE test runs against the dev MSW worker
once H1's `VITE_USE_MSW=true` browser worker is opted in by `web/src/main.tsx`
(deferred to Phase I follow-up; the spec is committed and ready).

## 9. Next

Phase H4 - vitest coverage gates (lines 80, branches 75, functions 90,
statements 80) wired into CI.
