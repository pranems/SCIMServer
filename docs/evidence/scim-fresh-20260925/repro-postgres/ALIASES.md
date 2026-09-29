# Reproduce the five alias/discovery cases

> **Last verified:** 2026-09-28
>
> Analysis-only extension of the original 77-case corpus.

Use the same prerequisites and safety rules as [README.md](README.md): pinned
source, existing API dependencies, generated Prisma client, and locally installed
`postgres:17-alpine`. Do not provide a shared database URL.

From PowerShell at the isolated worktree root, the exact new invocation is:

```powershell
node .\docs\evidence\scim-fresh-20260925\repro-postgres\run.cjs --cases 'ALIAS-BULK-SUCCESS,ALIAS-BULK-ATOMICITY,ALIAS-BULK-DISABLED,ALIAS-ME-USER,ALIAS-DISCOVERY-REFLECTION'
```

It creates a new ownership-labeled PostgreSQL container on a random loopback
port, replays all 22 migrations, runs these five cases on both InMemory and
Prisma/PostgreSQL, saves results, and removes that exact container.

Expected pinned-source result per backend:

* **5 cases**, **4 pass**, **1 behavior failure**, **0 setup failures**.
* 54 passing checks and 3 failing checks.
* The failing case is `ALIAS-BULK-DISABLED`: direct PATCH returns 501 but the
  embedded Bulk PATCH returns `"200"` and changes stored state.
* Jest's internal exit code is 1 for this expected behavior failure. The
  orchestrator exits 0 only if collection, migrations, ownership checks, and
  cleanup all complete safely.

The selected case IDs are disjoint from the original 77. The current no-selector
invocation runs **82**, because the five new registrations are additive. The
original [README.md](README.md) and original evidence retain the historical
77-case results. To run exactly those original cases, use the explicit ID-list
command already documented there.

## What the source does

[alias-cases.cjs](alias-cases.cjs) registers five cases using the existing corpus
helpers. The original case bodies and safety orchestrator are unchanged.

The `/Me` scenario uses the existing local E2E app and OAuth helper. Its token is
used only in memory for HTTP authorization. The auth helper's trace output is
redacted before it writes the synthetic token/secret. No live account, private
profile, token, or client credential is an input.

The discovery case changes only its own synthetic endpoint. It adds one simple
attribute, one custom schema/ResourceType, changes the advertised PATCH setting,
and hides/restores endpoint discovery. PostgreSQL's actual endpoint-profile
column is read to confirm persistence.

Bulk error atomicity checks an embedded PATCH with a successful first operation
and a later noTarget error. That resource must remain unchanged. A second
independent Bulk operation is expected to commit. This does not assume
whole-envelope atomicity.

## Publish without overwriting original evidence

Use the new output directory printed by the runner. The exact publication
command for this run was:

```powershell
node .\docs\evidence\scim-fresh-20260925\repro-postgres\build-alias-evidence.cjs 'test-results\fresh-analysis\postgres-20260928-e1a910bb0ce3cc16'
```

[build-alias-evidence.cjs](build-alias-evidence.cjs) checks completed cleanup,
five exact IDs, zero setup failures, and no overlap with the 77 original IDs.
It writes **new** `postgres-20260928-aliases.*` observations and
`postgres-20260928-expanded.*` combined summaries, not the original files.
It also rejects credential/JWT-shaped values in durable output.

The [plain-language addendum](../postgres-20260928-aliases.md) records the
outcomes and remaining permutation limits.
