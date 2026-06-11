---
name: playwrightSpecHygieneAudit
description: Audit web/e2e/*.spec.ts files vs the currently-shipped UI surface. Delete stale specs targeting removed components (Phase I legacy cleanup, etc.) instead of letting them inflate the failure count and hide real regressions.
argument-hint: Optional - name a specific spec to audit (e.g. "raw-logs.spec.ts") or omit to sweep all.
---

Playwright specs in `web/e2e/` test against `E2E_BASE_URL` (usually dev). When the UI evolves and a tested page/tab/component is deleted, the spec doesn't auto-delete - it keeps running and keeps failing. Over time the failure count climbs into the hundreds and operators learn to ignore the signal.

That happened in this repo: Finding-C (2026-05-16) - 121/161 Playwright tests failed against dev, but **the dev deployment was healthy** (984/984 live tests pass). Almost every failure was a stale spec asserting on UI deleted in Phase I (v0.48.0, 2026-05-09).

This prompt is the hygiene loop. Run it after every major UI rework (route deletions, component removal, redesigns).

---

## Step 1 - Enumerate Playwright specs and their target surfaces

```powershell
cd web
Get-ChildItem e2e -Filter '*.spec.ts' | ForEach-Object {
    $name = $_.Name
    $size = [math]::Round($_.Length / 1KB, 1)
    $lastMod = $_.LastWriteTime.ToString('yyyy-MM-dd')
    $describes = Select-String -Path $_.FullName -Pattern '^\s*describe\(' | ForEach-Object { ($_.Line -replace '^\s*describe\(\s*[''"]([^''"]+)[''"].*', '$1').Trim() }
    "{0,-40} {1,5} KB  {2}  describes: {3}" -f $name, $size, $lastMod, ($describes -join ' | ')
}
```

---

## Step 2 - Map each spec to a currently-rendered surface

For each spec, ask:
1. **Does the URL it navigates to still exist?** Check `web/src/router.ts` route tree.
2. **Does the test-id / role / text it asserts on still appear in the source?** Grep `web/src/` for the selector.
3. **Was the spec written for a UI surface that has since been deleted?** Cross-reference against `CHANGELOG.md` deletions, especially Phase I (v0.48.0) "Legacy Cleanup + UI Cutover".

| Spec | Target URL | Asserts on | Surface status | Action |
|---|---|---|---|---|
| `raw-logs.spec.ts` | `/?tab=raw-logs` | tab id `raw-logs` | DELETED Phase I | DELETE spec |
| `manual-provision.spec.ts` | `/?tab=manual-provision` | tab id `manual-provision` | DELETED Phase I (UI moved to `/manual-provision` route) | REWRITE or DELETE |
| `database-browser.spec.ts` | `/?tab=database` | sub-tabs "Statistics/Users/Groups" | DELETED Phase I | DELETE spec |
| `app-shell.spec.ts` | `/` | header/footer/tab nav of legacy shell | DELETED Phase I | DELETE spec |
| `activity-feed.spec.ts` | `/?tab=activity-feed` | summary cards, severity filter | DELETED Phase I (Activity moved to per-endpoint tab) | REWRITE or DELETE |
| `new-ui.spec.ts` | `/` (new UI) | dashboard / sidebar / route nav | STILL LIVE but baseline stale | UPDATE selectors |
| `live-data-verification.spec.ts` | various | activity summary, db stats | PARTIALLY LIVE | UPDATE then keep |
| `legacy-ui.spec.ts` | `/?ui=legacy` | legacy escape hatch | DELETED Phase I (escape hatch removed) | DELETE spec |
| `accessibility.spec.ts` | new UI | ARIA landmarks, contrast | LIVE | KEEP |
| `router-behavior.spec.ts` | `/`, `/endpoints` | TanStack pushState, search params | LIVE (Phase A) | KEEP |
| `smoke-test.spec.ts` | full flows | dashboard / endpoints / etc | MOSTLY LIVE | UPDATE per-step assertions where stale |
| `sse-cross-tab.spec.ts` | two BrowserContexts | F3 SSE invalidation | LIVE | KEEP |
| `visual-regression.spec.ts` | many pages | pixel-diff baselines | BASELINES STALE | REGEN BASELINES |
| `visual-snapshots.spec.ts` | many pages | HTML-structural snapshots | MOSTLY STALE | REGEN SNAPSHOTS |

---

## Step 3 - Decide the action for each spec

Three actions are valid:

### Action A: DELETE
The target UI no longer exists, the spec serves no purpose. Delete the file entirely. Remove its baselines under `web/e2e/<spec>.spec.ts-snapshots/` if any.

### Action B: REWRITE
The behavior the spec tested is still required, but it now lives at a different URL / component. Rewrite the spec against the new surface. Common for Phase-I-style cutovers where a tab became a route.

### Action C: REGENERATE BASELINES
The spec is correct but its visual / snapshot baselines are stale due to UI evolution (theme tweaks, Fluent UI version bump, layout shift). Regenerate baselines and COMMIT them in the same change as the UI change that caused the drift.

```powershell
cd web
$env:E2E_BASE_URL='https://scimserver-dev....'
npx playwright test --update-snapshots <spec>
git add web/e2e/<spec>-snapshots/
```

**Never regenerate baselines silently.** Always pair with a CHANGELOG note: "Regenerated Playwright visual baselines for <spec> due to <UI change>."

---

## Step 4 - Re-run Playwright and verify the pass ratio

```powershell
cd web
$env:E2E_BASE_URL='https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io'
npx playwright test --reporter=line 2>&1 | Tee-Object -FilePath ../test-results/playwright-postaudit.log | Select-Object -Last 5
```

Acceptance: failure count is either 0 OR explainable in CHANGELOG. The signal must be trustworthy again.

---

## Step 5 - Update the Stage-5 baseline in copilot-instructions.md

If your audit deleted N specs, update [.github/copilot-instructions.md](.github/copilot-instructions.md) Stage 5.2 with the new total spec count and the new expected pass count.

---

## Outputs

When this prompt completes, produce:
1. The Step 2 spec -> surface mapping table.
2. List of specs deleted (with file paths).
3. List of specs rewritten (with before/after coverage notes).
4. List of baselines regenerated (with CHANGELOG note).
5. New Playwright pass/fail/skip counts vs the pre-audit baseline.
