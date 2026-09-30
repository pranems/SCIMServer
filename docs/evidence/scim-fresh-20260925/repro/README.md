# Reproduce the independent SCIM analysis

> **Status:** Analysis-only harness; intentionally failing conformance probes
>
> **Last verified:** 2026-09-25
>
> **Pinned source:** `ccde1d5d6b5129dd943c6e848989c668a0d00d7a`

Use this directory in the isolated `SCIMServer-scim-fresh-analysis` worktree on
`analysis/scim-fresh-master-20260925`. No prior analysis, private profile, Azure
credential, or another worktree's source is an input.

After these documents are committed, HEAD is no longer the historical
baseline. To replay the original evidence, create a separate detached worktree
at `ccde1d5d6b5129dd943c6e848989c668a0d00d7a` and copy only this committed
`docs/evidence/scim-fresh-20260925` directory into its matching location.
Run the commands there. Do not weaken the baseline guard or use changed
production code while claiming to reproduce the original evidence.

## Safety and prerequisites

Open PowerShell in that worktree's root. Node.js 24+, npm, Git, and PowerShell
are required. [run.ps1](run.ps1) derives the root from its own location.
[runtime.cjs](runtime.cjs) refuses a different HEAD or changed production/test
source under the API, web, and scripts directories.

The runner sets and then restores these process environment values:

| Variable | Value / purpose |
|---|---|
| `PERSISTENCE_BACKEND` | `inmemory`; never select Prisma for these runs |
| `DATABASE_URL` | `postgresql://127.0.0.1:1/scim_fresh_analysis_never_connect`; inert, credential-free placeholder for loading Prisma configuration |
| `NODE_ENV` | `test` |
| `LOG_FILE` | Empty; no shared main file transport |

HTTP probes use the pinned existing E2E app helper and its synthetic test
credentials through `getLegacyToken()`. They bind an ephemeral local test
server and close it afterward. They never call a live estate. No migration,
shared database, cloud resource, or production configuration is changed.

Try the desired lane first. If it reports missing Jest/ts-node/dependencies,
restore only the existing API lockfile. On this corporate device, the approved
registry override is:

```powershell
Set-Location .\api
npm ci --registry=https://packagefeedproxy.microsoft.io/npm/
Set-Location ..
```

Do not regenerate the lockfile or change package versions. Outside the corporate
environment, the normal approved registry and `npm ci` are sufficient. Only API
dependencies are needed; the registry-to-UI test reads web source, not a web
build. No dependency junction path is embedded in this harness.

If the generated Prisma client is missing, generate it from the pinned schema:

```powershell
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane Generate
```

This runs the existing `npm run prisma:generate`, not migration or DB setup.
The original E2E global setup/teardown is reused by the opt-in HTTP config and
selects its no-database branch under the enforced InMemory environment.

## Exact invocation and expected result

Run the lanes individually from the worktree root. Output stays in ignored
`test-results\fresh-analysis\repro`; no command overwrites retained evidence
under this documentation directory.

```powershell
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane Check
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane UnitPatch
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane UnitContracts
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane BaselineHttp
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane Observations
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane HttpRed
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane History
```

Do not chain `HttpRed` with success-only shell operators: exit **1** is expected.
Check the failures, not merely the exit code. A setup/import failure is **not**
the expected RED.

| Lane | Exact selected files / implementation | Expected result on pinned master |
|---|---|---|
| `Check` | `node --check` for every `.cjs` in this directory; source guard | Exit 0; syntax only, not conformance |
| `UnitPatch` | Five `--runTestsByPath` files explicitly listed in [run.ps1](run.ps1) under this lane; `npm test -- --runInBand` | GREEN, 5 suites / 424 tests |
| `UnitContracts` | Seven settings, conformance, UI-coverage, projection, subattribute, egress, and filter files explicitly listed in [run.ps1](run.ps1) | GREEN, 7 suites / 550 tests |
| `BaselineHttp` | Nine HTTP files explicitly listed in [run.ps1](run.ps1); existing `npm run test:e2e -- --runInBand` | GREEN, 9 suites / 179 tests; InMemory only |
| `Observations` | [observations.cjs](observations.cjs), production imports and real InMemory services/repositories | Exit 0 on collector completion, 50 records P01-P50, including 16 valid P47 shape representatives; **not a green conformance suite** |
| `HttpRed` | [http-probes.spec.cjs](http-probes.spec.cjs), explicitly selected by [jest.red.config.cjs](jest.red.config.cjs) | RED, exactly 3 tests; expected 200 but observed H1=400, H2=400, H3=500 |
| `History` | [history.cjs](history.cjs); six explicitly listed pinned-master ancestors | Exit 0; same six parser snapshots as [history-parser.json](../history-parser.json) |

The lane source preserves the exact prior unit/E2E selectors and runner flags.
Only the cache directory moves from `test-results\fresh-analysis\jest-cache` to
`test-results\fresh-analysis\repro\jest-cache`. Unchanged baseline suites need
not be rerun just because this documentation moved.

For concise retained logs, use PowerShell redirection and record the exit code:

```powershell
New-Item -ItemType Directory -Force .\test-results\fresh-analysis\repro | Out-Null
pwsh -NoProfile -File .\docs\evidence\scim-fresh-20260925\repro\run.ps1 -Lane HttpRed *> .\test-results\fresh-analysis\repro\http-red.log
$LASTEXITCODE
```

### Output files and comparison rules

| Output under `test-results\fresh-analysis\repro` | Retained reference |
|---|---|
| `observations.json` | [Original 50 observations](../characterization.json) |
| `settings-source.json` | [Settings inventory](../settings-inventory.json) |
| `http-observations.json` | [Original three HTTP requests/responses](../http-characterization.json) |
| `history-parser.json` | [Original historical differential](../history-parser.json) |

Generated IDs, request IDs, dates, and resource locations vary. Compare statuses,
paths, values, selected records, and metadata versions rather than byte-comparing
runtime responses. Historical parser output is deterministic and was compared
structurally with its retained artifact.

P44 needs an explicit distinction: the original observation used the current
live schema with synthetic resource data. Its retained output remains unchanged.
The durable harness instead uses [incident-fixture.cjs](incident-fixture.cjs):
a deliberately minimal **synthetic** profile containing the same four supplied
paths, cardinalities, and relevant value types. It contains no private profile
or live resource values. Its validation checks the same strict rejection,
unchanged pre-write values, three updated Google targets, unchanged real
Contoso contact, and additional literal bracket-key object under lenient mode.
This is a reproducible semantic counterexample, not an at-time profile snapshot.

### Deliberate RED isolation

The `.cjs` HTTP spec lives only here under documentation. It is not copied into
the API test tree and does not match either normal `.spec.ts`/`.e2e-spec.ts`
discovery pattern. The custom config transpiles only the pinned existing E2E
configuration module without installing a second global TypeScript hook or
changing Jest's working directory, then overrides only the
root/search scope, `.cjs` resolution, cache, and reporter.
Before execution, the RED lane checks `--listTests --json` and requires exactly
the expected analysis-only file; it also passes that file via `--runTestsByPath`.

Normal discovery was checked without running those suites:

```powershell
Set-Location .\api
node .\node_modules\jest\bin\jest.js --config .\jest.config.ts --listTests --json
node .\node_modules\jest\bin\jest.js --config .\test\e2e\jest-e2e.config.ts --listTests --json
Set-Location ..
```

It listed 174 unit files and 97 E2E files, with **zero** analysis-only probes.
The opt-in RED lane is the only intended way to discover the three new tests.

## Scope and evidence

The inventory's lexical reference classifier has a dependency-free self-check:

```powershell
node .\docs\evidence\scim-fresh-20260925\repro\reference-kind.cjs
```

Expected: **20/20 passed**. This covers `*.spec.ts(x)`, `*.test.ts(x)`,
`test/` and `e2e/` directories, and non-test lookalikes. It does not execute
the referenced tests or prove runtime coverage. The corrected JSON/CSV
partition has 176 production and 432 test references with no lost references.

The retained H2 response was also checked against the SCIM error-message
contract: its `detail` array is an additional open finding F17, separate from
the request rejection. See [responseContractReview](../http-characterization.json).
This is a review of existing evidence, not a fourth HTTP probe; the 50
observations and three RED HTTP tests are unchanged.

The historical differential compiles only the historical parser utility, using
the existing TypeScript compiler. Its constants import resolves in the pinned
worktree and it explicitly selects the enterprise URN common to all six
snapshots. It does not replay historical full servers or inspect other branches.

Existing GREEN test results are reused from the initial run. Relocated executable
harnesses and the changed P44 synthetic fixture were checked again; the follow-up
receipt is [repro-validation.json](../repro-validation.json).

The live reconstruction is separately linked from the
[main report](../../../SCIM_FRESH_MASTER_ANALYSIS_2026-09-25.md) and
[earlier admin-error evidence](../earlier-admin-error.json). Reproducing the local
probes does not retrieve those logs, load credentials, or call Azure.
