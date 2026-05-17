---
name: lintAndStaticAnalysis
description: Run all Stage-1 local static gates (tsc + lint + build + size) and prioritize fixes by blast radius. Used as the fast-feedback first wall before any test run.
argument-hint: Optional scope - "api" to limit to api/, "web" to limit to web/, or omit for both.
---

Run every fast static gate that does NOT require a test runner. These gates are cheap (seconds to a minute) and catch the highest density of bugs per second of compute spent. Run them BEFORE any unit/E2E/live test run so a typo doesn't waste 10 minutes of test execution.

---

## When to run

- After every `git add` and BEFORE every commit.
- After every dependency bump.
- After every merge or rebase, as a smoke check.
- On a fresh clone, as the first sanity gate.

---

## Step 1 - API static gates

```powershell
cd api

# 1.1 TypeScript build (tsc -p tsconfig.build.json)
npm run build
# Expected: exit 0, no output beyond the npm script header.

# 1.2 ESLint
npm run lint
# Expected: 0 errors. Warnings allowed but should not increase commit-over-commit.
# Today's baseline (v0.52.0-alpha.1): 0 errors / 465 warnings.

# 1.3 Verify no .ts files were forgotten in /dist or /node_modules linting
$lintLog = npm run lint 2>&1
$errCount = ($lintLog | Select-String 'error').Count
$warnCount = ($lintLog | Select-String 'warning').Count
"API lint: $errCount errors, $warnCount warnings"
```

**Failure handling:**
- Any tsc error -> fix immediately. tsc is the floor; broken tsc means broken contract.
- Any new lint error -> fix immediately.
- New lint warnings -> ratchet only. Never accept a commit that INCREASES warning count without a CHANGELOG note.

---

## Step 2 - Web static gates

```powershell
cd web

# 2.1 TypeScript check (no emit, just validation)
npx tsc --noEmit
# Expected baseline today: 96 errors (87 in test files, 9 in prod files).
# These are PRE-EXISTING - not a regression bar. But any NEW prod-file
# error you introduce must be fixed before commit.

# 2.2 ESLint - SKIP if web/eslint.config.{mjs,cjs,js} does not exist.
# When the config lands, use:
#   npx eslint src
# Expected: 0 errors.

# 2.3 Production build (vite)
npm run build
# Expected: exit 0, ~14s, ~32 lazy chunks emitted, no "Some chunks are larger
# than 500 kB" warnings beyond the documented `index-*` (~504 KB raw / ~153 KB gz)
# and `primitives-*` (~419 KB raw / ~127 KB gz) entries. Those are the documented
# bundle floor; further growth requires a CHANGELOG justification.

# 2.4 Size-limit budgets (Phase H6 ratchet)
npm run size
# Expected: 24+ budget entries, 0 failures. Every per-route lazy chunk
# has a 110 KB ceiling; main entry has its own budget; shared primitives
# has its own budget.
```

**Per-route budget reminder:** When you add a new lazy route file under `web/src/routes/`, you MUST add a corresponding entry to the `"size-limit"` block in [web/package.json](web/package.json) with the chunk name pattern `dist/assets/<PageName>-*.js`. See `bundleBudgetAudit` prompt for the workflow.

---

## Step 3 - Cross-cutting static checks

```powershell
# 3.1 No accidental em-dashes (RFC 7643 server-side; rule is repo-wide)
$emDashHits = git diff --cached -U0 | Select-String -Pattern '\u2014'
if ($emDashHits) { Write-Host "BLOCKED: em-dash detected in staged diff"; $emDashHits | Select-Object -First 5 }

# 3.2 No secrets in staged diff
$secretHits = git diff --cached -U0 | Select-String -Pattern '(?:password|secret|token|api[_-]?key)\s*[:=]\s*["\x27][^"\x27]{8,}'
if ($secretHits) { Write-Host "BLOCKED: possible secret in staged diff"; $secretHits | Select-Object -First 5 }

# 3.3 No console.log in production source (allowed in test files)
$consoleLog = git diff --cached -U0 --diff-filter=AM -- 'api/src/**/*.ts' 'web/src/**/*.ts' ':(exclude)*.spec.ts' ':(exclude)*.test.*' | Select-String -Pattern '^\+\s*console\.log'
if ($consoleLog) { Write-Host "REVIEW: console.log added to prod source"; $consoleLog | Select-Object -First 5 }
```

---

## Step 4 - Aggregate result

Produce a structured report:

```
=== Stage 1 Static Gates ===
API tsc:        PASS | exit 0
API eslint:     PASS | 0 errors / N warnings (delta: +0 / +0)
Web tsc:        BASELINE | 96 errors (87 test / 9 prod) - no regression
Web eslint:     N/A   | no config present (TODO: Option-4 work)
Web build:      PASS | 14.0s, 32 chunks
Web size:       PASS | 24/24 budgets within ceiling
Em-dash check:  PASS
Secret check:   PASS
console.log:    PASS (or REVIEW: N hits)
```

If ANY gate fails, fix it before proceeding. Do not move to Stage 2 with a red Stage 1.

---

## Strategy notes

- Stage 1 is the **shortest feedback loop** in the gate chain. Treat it as the first responder.
- The Web tsc baseline (96 errors) is a CEILING - it ratchets down, never up. When Option-4 work fixes a prod-file error, update this prompt's baseline number.
- The em-dash rule is a repo standing rule from [.github/copilot-instructions.md](.github/copilot-instructions.md). The check here is the enforcement.
