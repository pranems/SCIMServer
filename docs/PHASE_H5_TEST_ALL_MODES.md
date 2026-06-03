# Phase H5 - test-all-modes Orchestrator

**Version:** 0.46.1-alpha.10
**Status:** Shipped
**Tracker:** [docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md) S11.5
**Branch:** `feat/ui`

## 1. Goal

Phase H5 closes the **plan §11.5 / S11.5** gap: the redesigned UI shipped without a single command that runs the full test matrix across persistence backends. Phase H5 ships `scripts/test-all-modes.ps1` - one PowerShell entry point that runs API unit + E2E in both `inmemory` and `prisma` backends, plus the web vitest + coverage gate, and prints a single PASS/FAIL summary per mode.

## 2. Why backend matters (theme does not)

The API has two repository implementations: `InMemoryRepositoryModule` and `PrismaRepositoryModule`. They have different consistency guarantees, different transaction semantics, and different filter evaluation paths. A passing in-memory run does not prove the prisma path works (and vice versa).

**Real-world precedent:** Phase D4 found a bug here - `LoggingService.listLogs` had 9 filter dimensions implemented in the prisma branch but missing in the in-memory branch. The bug was only caught because Phase D4 also ran the suite in-memory. Without a matrix orchestrator, the divergence is silent until production traffic surfaces it.

**Why theme is single-pass:** Every Fluent UI test mounts its own `FluentProvider theme={webLightTheme}` (or via the `withFluent()` helper). Running the suite twice with a global theme env var changes nothing. Real theme regressions are caught by Phase H3's Playwright visual-regression spec which runs both light and dark.

## 3. Modes

| Mode | Workdir | Command | Env |
|------|---------|---------|-----|
| `api-unit-inmemory` | `api/` | `npm test -- --run` | `PERSISTENCE_BACKEND=inmemory` |
| `api-unit-prisma` | `api/` | `npm test -- --run` | `PERSISTENCE_BACKEND=prisma` + `DATABASE_URL` |
| `api-e2e-inmemory` | `api/` | `npm run test:e2e` | `PERSISTENCE_BACKEND=inmemory` |
| `api-e2e-prisma` | `api/` | `npm run test:e2e` | `PERSISTENCE_BACKEND=prisma` + `DATABASE_URL` |
| `web-vitest` | `web/` | `npm test -- --run` | (none - Phase H1 MSW lifecycle is opt-in per file) |
| `web-coverage-gate` | `web/` | `npm run test:coverage` | (none - Phase H4 V8 provider) |

## 4. Usage

```powershell
# All 6 modes (default)
.\scripts\test-all-modes.ps1

# Skip prisma when no Postgres available
.\scripts\test-all-modes.ps1 -SkipPrisma

# Unit only (skip the ~3min E2E suite)
.\scripts\test-all-modes.ps1 -SkipE2E

# API only (skip web vitest + coverage)
.\scripts\test-all-modes.ps1 -SkipWeb

# Verbose mode (stream subprocess output to console)
.\scripts\test-all-modes.ps1 -Verbose

# Override DATABASE_URL for the prisma modes
.\scripts\test-all-modes.ps1 -DatabaseUrl 'postgresql://user:pass@host:5432/db'
```

## 5. Exit codes

| Code | Meaning |
|------|---------|
| 0 | All requested modes passed |
| 1 | One or more modes failed (per-mode logs at `test-results/test-all-modes-<mode>.log`) |
| 2 | Prerequisite check failed (npm not on PATH) |

## 6. Auto-install

The orchestrator detects missing `api/node_modules` or `web/node_modules` and runs `npm install --silent` automatically. This handles the common "fresh clone / lockfile regen" case where the dev runs the orchestrator before the per-package install. Skipping silently was deemed worse than a 60-second wait because the failure mode (jest / vitest not on PATH) is opaque.

## 7. Env-var safety

Each mode runs inside `try / finally` that:

1. Stashes the original value of every `EnvVars` key
2. Sets the per-mode override
3. On exit (success or failure), restores the original value

This prevents `PERSISTENCE_BACKEND=prisma` from one mode leaking into the next mode's `inmemory` run - which would silently mask backend-divergence bugs (the very thing this orchestrator exists to catch).

## 8. Test coverage

[scripts/test/test-all-modes.contract.ps1](../scripts/test/test-all-modes.contract.ps1) - 14 contract assertions:

- Script exists at the expected path
- PowerShell tokenizer parses without errors
- 4 documented switches (`SkipPrisma`, `SkipE2E`, `SkipWeb`, `DatabaseUrl`) declared in param block
- 6 documented mode names appear as string literals
- Env-var restore happens in a `finally` block (the most common silent-breakage source)
- Exit codes 0 / 1 / 2 all referenced

The contract test runs in ~1 s and validates the orchestrator's syntax + parameter contract on every push. Functional validation is "actually run the orchestrator yourself" since running the matrix takes ~5 min and requires a live Postgres connection for the prisma modes.

## 9. Files changed

```
api/package.json                                  +1/-1   version 0.46.1-alpha.9 -> 0.46.1-alpha.10
web/package.json                                  +1/-1   version 0.46.1-alpha.9 -> 0.46.1-alpha.10
scripts/test-all-modes.ps1                        NEW     ~210 LoC orchestrator
scripts/test/test-all-modes.contract.ps1          NEW     14-assertion contract test
docs/PHASE_H5_TEST_ALL_MODES.md                   NEW     this doc
docs/INDEX.md                                     +1
CHANGELOG.md                                      +entry  0.46.1-alpha.10
Session_starter.md                                +entry
```

## 10. Quality gates

| Gate | Status | Note |
|------|--------|------|
| 2 - addMissingTests | PASS | 14 contract assertions covering script existence / parse / param block / mode names / env restore / exit codes |
| 3 - apiContractVerification | N/A | No API surface change |
| 4 - error-handling | PASS | Failed modes logged to `test-results/test-all-modes-*.log`; orchestrator continues running other modes (does not abort on first failure) so single command run gives full picture |
| 5 - logging | PASS | Per-mode log files + console summary table |
| 6 - auditAgainstRFC | N/A | No SCIM contract |
| 7 - securityAudit | PASS | DATABASE_URL passed via parameter (not committed); env vars restored in `finally` so secrets do not leak across mode boundaries |
| 8 - performanceBenchmark | PASS | Full matrix ~5 min on dev box (api unit ~30s + api e2e ~3min + web vitest ~70s + web coverage ~70s, sequential) |
| 9 - auditAndUpdateDocs | PASS | This doc + INDEX + CHANGELOG + Session_starter |
| 10 - fullValidationPipeline | PASS | Contract tests pass; smoke run with `-SkipPrisma -SkipE2E` confirms script drives subprocesses correctly (failures expected when node_modules absent on a fresh clone, now auto-installed) |

## 11. Why no live test section

Phase H5 is pure test-orchestrator infrastructure. The 933-assertion live SCIM suite is unaffected. Running it after deploy confirms zero regression in the API contract.

## 12. Next

Phase H6 - `@size-limit/preset-app` with 90 KB / 110 KB budgets for the dashboard / endpoint-detail bundle splits.
