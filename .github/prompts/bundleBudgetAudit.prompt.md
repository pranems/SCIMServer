---
name: bundleBudgetAudit
description: Enforce the per-route bundle-budget discipline for the web/ UI - every new lazy route must add a size-limit entry in web/package.json, otherwise the route ships unbounded.
argument-hint: Optional path - new route file added (e.g. "web/src/routes/foobar.tsx") to scope the audit.
---

The web UI uses TanStack Router with `React.lazy()` for code splitting. Every page route emits its own chunk under `dist/assets/<PageName>-<hash>.js` and EACH chunk needs an entry in the `"size-limit"` array in [web/package.json](web/package.json) with a 110 KB gzipped ceiling.

When you add a route file but forget the budget entry, the chunk ships with NO ceiling - so a future regression that adds 200 KB of Fluent UI is undetected. This prompt is the workflow that prevents it.

---

## Step 1 - Enumerate current route files vs current budgets

```powershell
cd web
# All page-route files (TanStack Router children of root)
$routeFiles = Get-ChildItem src/routes -Recurse -File -Filter '*.tsx' | Where-Object { $_.Name -notmatch '^__root|^lazy-routes|^route-suspense' }
$routeFiles | ForEach-Object { $_.Name }

# All page components referenced by route files
$pageComponents = $routeFiles | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match "import\('\.\./pages/(\w+)'") { $matches[1] }
}
$pageComponents | Sort-Object -Unique

# All chunk names already in size-limit config
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.'size-limit' | ForEach-Object { $_.path -replace '^dist/assets/', '' -replace '-\*\.js$', '' }
```

Each output column should match. If a page component appears in routes but NOT in size-limit, that is the gap.

---

## Step 2 - Verify the route-chunk contract spec

The Phase H6 contract spec [web/src/test/size-limit-config.test.ts](web/src/test/size-limit-config.test.ts) iterates a `ROUTE_CHUNK_NAMES` array and asserts each name has a corresponding entry in `package.json`. Update that array whenever you add a route. The spec will FAIL on the missing entry - that is the canary.

When this spec fails, the message looks like:
```
ROUTE_CHUNK_NAMES › NewPageName › has a size-limit entry in package.json
```

If you see that, fix BOTH:
1. Add the missing entry to `web/package.json` `"size-limit"` array
2. The spec passes again

---

## Step 3 - Choosing the budget value

Default for new per-route chunks: **`"limit": "110 kB"`** (gzipped).

Tighten when:
- Route is below 10 KB after several feature additions and is unlikely to grow. Set the limit to a reasonable ratchet ceiling (e.g. measured-size + 30% headroom). Tightening locks in the size win.
- Route is a pure stub today (e.g. `/me` was 2.3 KB at L2 launch). Set the limit to ~3-5x measured size to leave room for the feature surface to grow without re-budgeting every sub-phase.

**Never raise an existing budget** unless the CHANGELOG entry justifies it. The 110 KB ceiling is the project-wide First-Contentful-Paint policy.

---

## Step 4 - Verify the build emits the expected chunk

```powershell
cd web
npm run build 2>&1 | Select-Object -Last 50 | Select-String 'dist/assets'
# Look for a line like: dist/assets/NewPageName-abc123.js  N kB | gzip: M kB
```

If the chunk is NOT emitted (e.g. you forgot to `React.lazy()` the import), the size-limit run will error with "no files matched". That is also a gate signal.

---

## Step 5 - Run the size-limit gate

```powershell
cd web
npm run size
# Expected: every entry passes, no "exceeded" warning.
```

If a route exceeds 110 KB:
- **DO NOT** raise the budget as the fix. Raise it only as a deliberate, documented choice.
- Investigate the cause: which import dragged in heavy code? `npm run size:why` for the bundle composition.
- Common causes: importing a heavy Fluent UI component, including a charting library, accidental named-export of a barrel that pulls in the whole module.

---

## Step 6 - Document the new entry in CHANGELOG

For the commit that adds the new route, the CHANGELOG entry should include:
- The new chunk name
- Its measured size
- Its budget ceiling
- The new total budget count (e.g. "All 25 size budgets pass (was 24)")

Pattern:
> `+1 size-limit budget for FooBarPage (current 8.2 KB gzipped, 110 KB ceiling); 25/25 budgets pass.`

---

## Outputs

When this prompt completes, produce:
1. Current route -> chunk -> budget mapping table.
2. List of routes without a budget entry (= gaps).
3. List of routes whose budget is the default 110 KB but should ratchet down (= optional hardening).
4. List of routes exceeding budget (= must fix before commit).
