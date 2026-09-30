# Reproduce PostgreSQL versus InMemory safely

> **Last verified:** 2026-09-28
>
> Analysis-only opt-in harness. No file here belongs in normal product test discovery.

## Requirements

Use the isolated source worktree at commit
`ccde1d5d6b5129dd943c6e848989c668a0d00d7a`, with the API/web/scripts/manifests
unchanged. Start PowerShell in that worktree root.

After the analysis is committed, use a separate detached worktree at the
baseline SHA and copy only this committed
`docs/evidence/scim-fresh-20260925` directory into its matching location.
The historical guard intentionally rejects a later HEAD, including a
documentation-only commit. Implementation regression tests must record the new
source and expectations separately; do not bypass the historical source guard.

You need Node.js 24+, Git, Docker with an available local `postgres:17-alpine`
image, and the pinned API dependencies. The current run verified Docker 29.6.2
and actual PostgreSQL 17.8. No new test runner is installed.

The harness generates its own random password in memory. **Do not set
DATABASE_URL to an existing database.** It does not accept an external database
argument; it creates and verifies its own. Do not use `prisma migrate reset`,
the normal E2E global teardown, or any shared database for these probes.

Try the command first. If dependencies are missing, restore only the existing
frozen API lockfile using the approved registry:

```powershell
Set-Location .\api
npm ci --registry=https://packagefeedproxy.microsoft.io/npm/
Set-Location ..
```

Do not regenerate lockfiles. On a non-corporate machine, use the normal approved
registry with `npm ci`. No absolute dependency junction path is embedded here.

If generated Prisma types are missing, use the existing generator with an inert
placeholder. Generation does not connect or apply migrations:

```powershell
Set-Location .\api
$env:DATABASE_URL = 'postgresql://127.0.0.1:1/scim_fresh_never_connect'
npm run prisma:generate
Remove-Item Env:\DATABASE_URL
Set-Location ..
```

Use a dedicated shell for the commands above if you need to preserve an existing
environment setting. Never substitute a real database URL for generation.

## Execute

```powershell
node .\docs\evidence\scim-fresh-20260925\repro-postgres\check-safety.cjs
node .\docs\evidence\scim-fresh-20260925\repro-postgres\run.cjs
```

The first command checks three fail-closed cases without accessing a database.
The second runs all **77 cases** on both backends. It:

1. verifies pinned source and refuses a pre-existing E2E DB marker;
2. starts a uniquely named, ownership-labeled PostgreSQL container detached,
   with a random **127.0.0.1-only** host port and tmpfs storage;
3. verifies Docker and PostgreSQL identity before initialization;
4. creates a task ownership marker and uuid-ossp; replays all **22** migrations;
5. checks server extensions and the migration ledger;
6. runs the same opt-in Jest corpus on InMemory, then real Prisma/PostgreSQL;
7. validates the selected output IDs/counts and rejects setup failures;
8. saves sanitized outcomes and removes only its verified container by exact ID.

No bind mounts, persistent volumes, or custom networks are created. The default
Docker bridge is used; only its loopback host port is exposed. The password is
passed to Docker by inherited environment key, not a command-line value.

Results go to a new ignored directory:
`test-results\fresh-analysis\postgres-20260928-<random-run-id>`.
The final stdout names the exact directory. No prior evidence is overwritten.

### Exit codes

The orchestrator exits **0** when evidence collection, identity checks, migrations,
and cleanup succeed. Individual Jest lanes currently exit **1** because known
behavior expectations fail. Those failures are retained as `behavior-failed`.

`setup-failure` means infrastructure, fixture setup, or harness execution failed.
It is never counted as a protocol finding. A missing result file, incomplete
case list, setup failure, migration failure, or cleanup failure makes the
orchestrator exit **1**.

In the recorded run: InMemory 23 passed / 53 behavior-failed / 1 not-applicable;
PostgreSQL 24 passed / 53 behavior-failed. Ordinary wire races may produce a
different pass/fail count on a rerun. Compare the deterministic barrier cases
and stored outcomes, not only the totals.

### Select a focused group

```powershell
node .\docs\evidence\scim-fresh-20260925\repro-postgres\run.cjs --cases 'INC-STRICT,INC-LENIENT,CAS-Users-BARRIER,UNIQUE-BARRIER,GROUP-NATIVE-ROLLBACK'
```

This still creates a fresh verified database and runs the selected cases on
both backends. Unknown IDs fail the harness, not silently skip.

The exact second invocation used in this evidence was:

```powershell
node .\docs\evidence\scim-fresh-20260925\repro-postgres\run.cjs --cases 'CUSTOM-PATCH-DISABLED,TYPED-READ-CONTROL,CORE-MV-ADD,CORE-BOOLEAN-PATH,MULTIMATCH-REMOVE,NO-PATH-Users,ETAG-CONTROL-Users,CARDINALITY-NEGATIVE-Users,NO-PATH-Groups,ETAG-CONTROL-Groups,CARDINALITY-NEGATIVE-Groups,NO-PATH-Devices,ETAG-CONTROL-Devices,CARDINALITY-NEGATIVE-Devices,GROUP-POST-FAULT'
```

The first invocation used `run.cjs` before those 15 cases were appended and ran
the original 62. To reproduce its exact current-source case selection, take the
IDs from the first run in the retained evidence:

```powershell
$data = Get-Content .\docs\evidence\scim-fresh-20260925\postgres-20260928.prisma.json -Raw | ConvertFrom-Json
$ids = ($data.results | Where-Object run -eq 'd603fa1ad9198156' | ForEach-Object id) -join ','
node .\docs\evidence\scim-fresh-20260925\repro-postgres\run.cjs --cases $ids
```

That command reads synthetic evidence IDs only, not live profiles or secrets.
The 62 original cases were not rerun when the 15 non-overlapping controls were
added.

## Files and safe boundaries

| File | Purpose |
|---|---|
| [run.cjs](run.cjs) | Container lifecycle, readiness, credentials in memory, migration replay, sequential backend runs, exact-ID cleanup |
| [safety.cjs](safety.cjs) | Source, container, database identity and ownership assertions |
| [global-setup.cjs](global-setup.cjs) | Verifies target before the Jest test process bootstraps |
| [jest.config.cjs](jest.config.cjs) | Reuses pinned E2E transforms; replaces global setup and removes destructive teardown |
| [dual-backend.spec.cjs](dual-backend.spec.cjs) | Complete synthetic cases and observations; HTTP plus real repository/storage |
| [check-safety.cjs](check-safety.cjs) | Three negative controls that fail before DB access |
| [build-evidence.cjs](build-evidence.cjs) | Validates and combines completed disjoint run directories into sanitized new evidence |

The existing app helper is reused unchanged. It sets synthetic test auth values
and binds an ephemeral test HTTP server. The corpus checks `/scim/health` and
closes the app. PostgreSQL's full identity and task marker are checked before
any Prisma test begins.

The wrapper does **not** run the existing E2E global setup/teardown: setup would
write the database URL to a marker file, and teardown can delete tables. Our
global setup has no destructive action; lifecycle cleanup removes the whole
task-owned container.

### Failure and interruption

Normal exceptions always reach the runner's `finally`, which verifies ownership
again before removing the exact container ID. Do not terminate the orchestrator
mid-flight unless necessary. If the host/process is forcibly killed, automatic
cleanup cannot run. The output directory's initial `run.json` contains the exact
container ID, name, run label, and session-owner label, **not its password**.

For emergency cleanup, inspect that exact container ID, confirm BOTH ownership
labels and exact name against the receipt, then remove that **ID only**. Never
clean by broad names, labels alone, wildcard, or Docker prune.

## Verification and evidence publication

Syntax-check without any database access:

```powershell
Get-ChildItem .\docs\evidence\scim-fresh-20260925\repro-postgres -Filter '*.cjs' -File |
  ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) {
      throw "Syntax failed: $($_.Name)"
    }
  }
```

Publish reviewed run outputs to the new PostgreSQL evidence filenames:

```powershell
node .\docs\evidence\scim-fresh-20260925\repro-postgres\build-evidence.cjs 'test-results\fresh-analysis\postgres-20260928-d603fa1ad9198156' 'test-results\fresh-analysis\postgres-20260928-d14af7fea23f1faf'
```

Those paths describe this run; use the new output directories when reproducing.
The publisher rejects duplicate case IDs, incomplete/failed setup, uncleaned
containers, and credential-bearing data. It writes only the dedicated
`postgres-20260928.*` artifacts, leaving the earlier evidence intact.

The fixture values are synthetic. The Group failure triggers exist only inside
the verified task database and are removed after their case. Scheduling barriers
call the original repository method after release; they never replace storage.
See the [plain-language results](../postgres-20260928.md) for the exact limits.
