---
name: uiTestAndValidation
description: "Run all web UI tests, audit coverage gaps, add missing tests, and validate the build. Fully automated — no user input required."
mode: "agent"
argument-hint: Optional scope like "Header" or "ActivityFeed" to narrow the audit to a single component.
---

Run the web UI test suite, audit test coverage gaps, add missing tests, validate the build, and self-improve this prompt. **Execute all steps without stopping for user input.** All permissions are pre-granted.

### Execution Rules

- **Never stop to ask the user.** Make reasonable decisions and proceed.
- **Parallelize reads** — read multiple source files at once with parallel tool calls.
- **Batch terminal commands** — chain commands with `;` instead of running them one at a time.
- **Redirect output to files** — use `*> c:\temp\vitest-*.txt` to avoid terminal scrollback issues, then `Select-String` the results.
- **Fix failures inline** — if a test fails, read the source, fix the test, rerun. Don't ask if you should fix it.
- **One vitest run per step** — don't re-run to "confirm". Trust the first green result.
- **Skip unchanged syncs** — only sync `api/public/` if source (non-test) files were changed.

---

## System Context

**Stack:** React 19 + Vite 7 + TypeScript 5.9, tested with Vitest + @testing-library/react + @testing-library/user-event + jsdom.

**Source layout:**
- `web/src/utils/` — Pure utility functions (keepalive detection, etc.)
- `web/src/auth/` — Token storage (localStorage, events)
- `web/src/hooks/` — React context hooks (useAuth, useTheme)
- `web/src/api/client.ts` — API client (fetchLogs, fetchLocalVersion, etc.)
- `web/src/components/` — UI components (Header, LogList, LogDetail, LogFilters)
- `web/src/components/activity/` — ActivityFeed component
- `web/src/components/database/` — DatabaseBrowser, StatisticsTab, UsersTab, GroupsTab
- `web/src/components/manual/` — ManualProvision component
- `web/src/App.tsx` — Root app (tab navigation, token modal, upgrade banner, semver logic)

**Test config:** `web/vite.config.ts` → `test` block with jsdom environment, setup in `web/src/test/setup.ts`.

**Run commands:**
```powershell
cd web
npm test           # vitest run (single pass)
npm run test:watch # vitest (interactive watch mode)
```

---

## Step 1 — Run Existing Tests

```powershell
cd web; npx vitest run *> c:\temp\vitest-step1.txt; type c:\temp\vitest-step1.txt | Select-String "Test Files|Tests |Duration|FAIL"
```

Record: total files, total tests, pass count, fail count, duration.

**Current baseline:** 17 test files, 164 tests, 0 failures.

If any tests fail, immediately read the failing test + source component, fix whichever is wrong, and rerun. Do not ask the user.

---

## Step 2 — Inventory Test Coverage

Build a coverage matrix of all source files vs test files:

| Source File | Test File | Tests | Status |
|-------------|-----------|-------|--------|
| `utils/keepalive.ts` | `utils/keepalive.test.ts` | 15 | ✅ |
| `utils/semver` (inline in App.tsx) | `utils/semver.test.ts` | 12 | ✅ |
| `auth/token.ts` | `auth/token.test.ts` | 6 | ✅ |
| `hooks/useTheme.tsx` | `hooks/useTheme.test.tsx` | 6 | ✅ |
| `hooks/useAuth.tsx` | `hooks/useAuth.test.tsx` | 5 | ✅ |
| `components/Header.tsx` | `components/Header.test.tsx` | 10 | ✅ |
| `components/LogList.tsx` | `components/LogList.test.tsx` | 8 | ✅ |
| `components/LogDetail.tsx` | `components/LogDetail.test.tsx` | 6 | ✅ |
| `components/LogFilters.tsx` | `components/LogFilters.test.tsx` | 9 | ✅ |
| `components/database/StatisticsTab.tsx` | `components/database/StatisticsTab.test.tsx` | 10 | ✅ |
| `components/database/UsersTab.tsx` | `components/database/UsersTab.test.tsx` | 10 | ✅ |
| `components/database/GroupsTab.tsx` | `components/database/GroupsTab.test.tsx` | 7 | ✅ |
| `components/manual/ManualProvision.tsx` | `components/manual/ManualProvision.test.tsx` | 12 | ✅ |
| `api/client.ts` | `api/client.test.ts` | 13 | ✅ |
| `components/activity/ActivityFeed.tsx` | `components/activity/ActivityFeed.test.tsx` | 13 | ✅ |
| `components/database/DatabaseBrowser.tsx` | `components/database/DatabaseBrowser.test.tsx` | 10 | ✅ |
| `App.tsx` (footer, tabs, modals) | `App.test.tsx` | 12 | ✅ |

For each ❌ GAP, read the source file and determine what is testable with Vitest + jsdom (component rendering, user interactions, state changes). API calls should be mocked with `vi.mock()`.

---

## Step 3 — Add Missing Tests

For each gap identified in Step 2, create a test file following these conventions:

### Naming
- Test file: `<component>.test.tsx` (or `.test.ts` for pure utils)
- Place test next to the source file (co-located)

### Test Structure
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// ... import component and any providers needed

describe('ComponentName', () => {
  it('renders expected elements', () => { ... });
  it('handles user interaction', async () => { ... });
  it('displays correct state', () => { ... });
});
```

### What To Test Per Component Type

**Pure utilities:** All branches, edge cases, null/undefined inputs.

**Hooks (useAuth, useTheme):** Wrap in provider, test state changes via consumer component.

**Simple components (Header, LogList):** Render with props, verify DOM output, test click handlers, test conditional rendering.

**Complex components (ActivityFeed, DatabaseBrowser, App):** Mock API calls with `vi.mock('../api/client')`, verify lifecycle (loading → data → rendered), test tab switching, test filter interactions.

**API client functions:** Mock `fetch` globally, verify URL construction, header injection, error handling, response parsing.

### Priority Order for Gap Closure

1. **`api/client.ts`** — Mock fetch, test URL building, auth header injection, error status handling (401 → token cleared)
2. **`App.tsx`** — Test footer content (no "Made by", version from API), tab navigation, token modal display
3. **`ActivityFeed.tsx`** — Test summary cards render, activity list renders, filter dropdowns work, auto-refresh toggle
4. **`DatabaseBrowser.tsx`** — Test sub-tab switching (Statistics/Users/Groups), modal open/close, delete confirmation

### Patterns Discovered

**Presentational components (StatisticsTab, UsersTab, GroupsTab):** Pass props directly, spy on callbacks with `vi.fn()`. No providers needed. These are the easiest to test.

**Components with `vi.mock`:** ManualProvision uses `createManualUser`/`createManualGroup` from `api/client.ts` — mock the module with `vi.mock('../../api/client', () => ({ ... }))` and pre-set a token via `setStoredToken('test-token')` before each test.

**Emoji in headings:** Component headings like `👥 Users` need regex matchers (`/Users/`) or `getAllByRole('heading')` — exact text match will fail due to emoji prefix.

**API client (`api/client.ts`):** Mock global `fetch` with `vi.stubGlobal('fetch', mockFetch)`, set a token via `setStoredToken('test-token')` in `beforeEach`. Use `await import('./client')` after mocks are in place. Test URL construction, auth header injection, 401 → token cleared, error detail extraction from SCIM error responses.

---

## Step 4 — Validate Build

```powershell
cd web; npm run build *> c:\temp\vitest-build.txt; type c:\temp\vitest-build.txt | Select-String "built|error"
```

Confirm: "built in" message present, no "error" lines.

---

## Step 5 — Sync Public Assets

Only if **source** (non-test) files were modified:

```powershell
cd $repoRoot; Remove-Item -Recurse -Force api/public/*; Copy-Item -Recurse web/dist/* api/public/; Write-Host "Synced"
```

If only test files were added, skip this step.

---

## Step 6 — Report

Print a summary table:

```
┌────────────────────────────────────────────────┐
│           Web UI Test Report                   │
├────────────────────┬───────────────────────────┤
│ Test Files         │ XX passed / XX total      │
│ Tests              │ XX passed / XX total      │
│ Duration           │ X.XXs                     │
│ Gaps Found         │ X                         │
│ Gaps Closed        │ X                         │
│ Build              │ ✅ / ❌                   │
│ Asset Sync         │ ✅ / skipped              │
└────────────────────┴───────────────────────────┘
```

---

## Self-Improvement Rules

After each run of this prompt, update THIS FILE with:

1. **Baseline update:** Adjust the test file/test count baselines in Step 1 and Step 2 to match the new totals.
2. **Coverage matrix update:** Move any ❌ GAP entries to ✅ with the new test count.
3. **New patterns discovered:** If you find a testing pattern that works well (e.g., mocking a specific API, wrapping in providers), add it to the "What To Test" section as an example.
4. **New components added:** If the source inventory grows (new components, hooks, or utils), add them to the coverage matrix in Step 2.
5. **Timestamp:** Add a `Last run: YYYY-MM-DD` line below.

---

## Run History

| Date | Tests | Files | Gaps Closed | Notes |
|------|-------|-------|-------------|-------|
| 2026-04-17 | 164 | 17 | 1 | Closed App.tsx (12 tests: token modal show/hide/pre-existing, 4 tab navigation, 3 footer content, version display). All source files now have co-located tests. 0 remaining gaps. |
| 2026-04-14 | 152 | 16 | 2 | Closed ActivityFeed (13 tests), DatabaseBrowser (10 tests). Live data verified: version, summary, stats, users, groups, backup 404 — all correct. 1 remaining gap: App.tsx. |
| 2026-04-14 | 129 | 14 | 5 | Closed api/client.ts (13 tests). Live data verification: all endpoints correct after Fix #1–3. |
| 2026-04-14 | 116 | 13 | 4 | Closed StatisticsTab (10), UsersTab (10), GroupsTab (7), ManualProvision (12). |
| 2026-04-13 | 75 | 9 | — | Initial creation. All 75 pass. |
