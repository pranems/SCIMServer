# Phase H6 - size-limit Bundle Budgets

**Version:** 0.46.1-alpha.11
**Status:** Shipped
**Tracker:** [docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md) S11.6
**Branch:** `feat/ui`

## 1. Goal

Phase H6 closes the **plan §11.6 / S11.6** gap: the redesigned UI shipped without a bundle-size gate so adding a heavy dependency (e.g. moment.js, lodash full-bundle) could silently bloat the initial JS payload. Phase H6 wires `size-limit@12` + `@size-limit/preset-app` into [web/package.json](../web/package.json) with ratchet-floor budgets and a config-contract test.

## 2. Budget rationale

The plan target was per-route splits: dashboard 90 KB / endpoint detail 110 KB. The current build emits a single ~400 KB gzipped bundle (no route-level code splitting yet), so per-route budgets are aspirational.

**Pragmatic floor:** lock the current measured baseline + small headroom so any future bloat fails CI. Per-route budgets become reachable after a separate code-splitting work item that converts the route components to dynamic `import()` (estimated 1-2 days of work, deferred to a follow-up phase).

| Asset | Measured at v0.46.1-alpha.10 | Floor (this gate) | Aspirational target |
|-------|------------------------------|-------------------|---------------------|
| `dist/assets/index-*.js` (gzipped) | 394.45 KB | 420 KB (~6 % headroom) | dashboard 90 KB + endpoint detail 110 KB (per-route splits) |
| `dist/assets/index-*.css` (gzipped) | 9.73 KB | 12 KB (~23 % headroom) | (no per-route target - CSS is small) |

## 3. Why gzipped, not raw

Browsers download the gzip-encoded payload over the wire. A raw-byte budget gives misleading results because Fluent UI compresses extremely well (lots of repeated class hash strings, predictable JSX). The 394 KB gzipped figure represents 1.4 MB of raw JS. Locking the gzipped figure prevents the false-negative case where someone adds a dep that bloats raw but compresses well.

## 4. Files changed

```
api/package.json                                   +1/-1   version 0.46.1-alpha.10 -> 0.46.1-alpha.11
web/package.json                                   +12     2 npm scripts (size + size:why) + 3 devDeps + size-limit budget block
web/src/test/size-limit-config.test.ts             NEW     8 config-contract tests
docs/PHASE_H6_SIZE_LIMIT_BUDGETS.md                NEW     this doc
docs/INDEX.md                                      +1
CHANGELOG.md                                       +entry  0.46.1-alpha.11
Session_starter.md                                 +entry
```

## 5. Test coverage

[web/src/test/size-limit-config.test.ts](../web/src/test/size-limit-config.test.ts) - 8 tests asserting the gate-critical fields are present in `package.json`:

- Declares a `size-limit` array with at least 2 entries
- Both JS bundle and CSS budgets present (regression-lock)
- JS budget enforced gzipped (raw-byte gate is misleading)
- CSS budget enforced gzipped
- JS budget at floor (`<=420 KB`) - lowering is fine, raising requires updating this test (deliberate decision)
- CSS budget at floor (`<=12 KB`)
- Paths target `dist/assets/*` not `src/`
- npm scripts `size` and `size:why` present

**Total new tests: 8** (web suite: 527 -> 535)

## 6. How to run

```powershell
cd web
npm run build         # produce dist/
npm run size          # measure + assert against budgets
npm run size:why      # interactive bundle visualizer (opens browser)
```

In CI: add `npm run size` to the build job. Failure printout includes the offending bundle, current size, budget, and suggested actions.

## 7. Quality gates

| Gate | Status | Note |
|------|--------|------|
| 2 - addMissingTests | PASS | 8 config-contract tests prevent silent gate disablement / budget weakening |
| 3 - apiContractVerification | N/A | No API surface change |
| 4 - error-handling | PASS | size-limit fails CI with detailed "current vs limit" message + suggested actions |
| 5 - logging | N/A | Build-time check |
| 6 - auditAgainstRFC | N/A | No SCIM contract |
| 7 - securityAudit | PASS | No PII / secrets in size measurement; reports built file paths only |
| 8 - performanceBenchmark | PASS | size-limit measures the actual perf impact (gzipped bytes + emulated 3G load time + emulated Snapdragon 410 parse time) |
| 9 - auditAndUpdateDocs | PASS | This doc + INDEX + CHANGELOG + Session_starter |
| 10 - fullValidationPipeline | PASS (web) | 535/535 web tests + size gate met (394.45 KB / 420 KB JS, 9.73 KB / 12 KB CSS) |

## 8. Why no live test section

Phase H6 is build-time gate infrastructure. Live SCIM contract is unaffected.

## 9. Path to per-route splits (deferred follow-up)

The plan's aspirational per-route budgets (dashboard 90 KB / endpoint detail 110 KB) require:

1. Convert each route component in [web/src/routes/](../web/src/routes/) from static `import` to dynamic `import()`:
   ```ts
   const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
   ```
2. Wrap each `Outlet` consumer in `<Suspense fallback={<LoadingSkeleton />}>` (already imported via Phase G).
3. Verify Vite/Rollup emits per-route chunks (`dist/assets/dashboard-XXX.js`, `dist/assets/endpoint-detail-XXX.js`).
4. Add per-chunk budgets to `size-limit` config:
   ```json
   { "name": "Dashboard route", "path": "dist/assets/dashboard-*.js", "limit": "90 KB", "gzip": true },
   { "name": "Endpoint detail route", "path": "dist/assets/endpoint-detail-*.js", "limit": "110 KB", "gzip": true }
   ```

Estimated effort: 1-2 days. Tracked as a Phase J follow-up; not a blocker for the 0.47.0 stable rollup.

## 10. Next

0.47.0 stable rollup (drops the `-alpha.N` suffix after every Phase H sub-phase shipped, deployed, and passed live gate). Then Phase I begins: I1 (strip `?ui=legacy` switch), I2 (delete ~3000 LoC legacy components), I3 (final validation, no auto prod promote).
