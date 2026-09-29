# SCIM correctness implementation: issues and lessons

> **Last verified:** 2026-09-28
>
> **Status:** Implementation ledger, updated when an issue is confirmed
>
> **Design and progress:** [SCIM correctness design](SCIM_CORRECTNESS_DESIGN_AND_IMPLEMENTATION.md)

## Purpose

This ledger records problems encountered while delivering the fixes, not only
the product defects being fixed. Each entry states what failed, why, how it was
resolved, and what will prevent the same mistake. Full execution logs remain
in ignored test-results directories.

The [independent analysis](SCIM_FRESH_MASTER_ANALYSIS_2026-09-25.md) and its
database evidence retain the earlier investigation history. They are not
rewritten as implementation success.

## Entries

P1 confirmed implementation issues and their detection-stage analysis are in
[SCIM_P1_EXECUTION_RCA.md](SCIM_P1_EXECUTION_RCA.md). The original entries below
remain the design-preparation record.

| ID | Type / severity | Symptom | Root cause | Resolution and why it works | Earliest possible / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| I01 | Tooling / Low | Knowledge-graph overlay cannot be produced | This worktree has no `.understand-anything/knowledge-graph.json` | Use actual Git/source/tests as evidence; do not invent graph nodes | Intake / intake | Optional graph generation remains separate; not a product blocker |
| I02 | Reproducibility / Medium | Historical reproducers would reject HEAD after a documentation commit | Their source guard intentionally requires the exact original baseline | Document a detached baseline replay worktree and copy only the committed analysis harness into it | Before commit / before commit | Do not weaken database or source guards to get a green run; permanent implementation tests must record their own tip |
| P3-I01 | Persistence / High | Same-version HTTP PUT/PATCH both returned 200 and stored v3; concurrent DELETE returned 404 to the loser | Services checked a snapshot, then repositories wrote by internal id without a version predicate | Optional expected version now participates in the actual Prisma mutation or synchronous InMemory map mutation; Group checks inside its aggregate transaction. New current-source harness: `scripts/scim-conditional-writes/run.cjs`; first GREEN `test-results/conditional-writes/postgres-72183a7df22c1b3c`, 24/24 per backend | Repository unit / deterministic HTTP plus real database | Permanent barriers call original repositories; verify one winner, v2 and winner fields, not just success status |
| P3-I02 | Backend parity / High | InMemory stored two case-insensitive duplicate User names and accepted conflicting renames | Only an awaited service uniqueness precheck existed; PostgreSQL already had CITEXT uniqueness | Check name collision synchronously before create/update map mutation, excluding only the current internal id; test endpoint isolation and versions 1/2 after conflicting renames. Same first GREEN as P3-I01 | Repository unit / dual-backend HTTP | No redundant migration. Group/schema-driven uniqueness is explicitly P3b, not claimed fixed |
| P3-I03 | Capability / Medium | Custom resource PATCH rejected stale If-Match even when ETags were disabled | Generic service did not supply its resolved endpoint profile to the existing helper | All three Generic write methods now use the same profile-aware helper as User/Group; ETag-disabled test passes on both backends | Service unit / dual-backend HTTP | Cover on/off capability and wildcard separately from version-specific comparisons |
| P3-I04 | Test correctness / Low | First new error-envelope check rejected the legitimate Diagnostics extension | Test used an invented ErrorDetail URN instead of the existing response contract | Corrected allowlist to the published Diagnostics URN before production edits; corrected RED is 13 InMemory and 10 PostgreSQL failures, not the earlier 22/22 fixture-contaminated totals | Fixture review / first HTTP RED | Separate harness/fixture errors from product RED; retain both run records |
| P3-I05 | Environment/tooling / Low | New worktree lacked Jest; an early PowerShell brace-list read failed | Worktree dependencies are not copied, and PowerShell does not support shell brace expansion | First validation attempt confirmed missing dependency; owned junction reuses frozen installed API dependencies read-only, and Prisma generation targets this worktree's `api/src/generated` only. Read files with explicit paths | Intake / intake | No install or lockfile rewrite, no shared generated-client writes; container config tool was unavailable, so the checked-in Docker CLI runner was used |
| P3-I06 | Test maintenance / Low | 40 neighboring unit assertions failed after the optional write argument and atomic uniqueness were introduced | Strict mocks counted `undefined` as an extra argument; old uniqueness-unrelated fixtures reused `Alice`; old missing-row assertions depended on adapter-specific text | Updated exact expected arguments, made fixture names distinct, and asserted typed NOT_FOUND codes. Targeted suite is 689/689 GREEN at this checkpoint | Unit / unit | Keep wire behavior assertions separate from adapter diagnostic text; do not weaken duplicate tests to preserve invalid fixtures |
| P3-I07 | Harness/typing / Low | Expanded suite failed compilation while unchanged ETag suite passed; initial listener smoke failed because the server was already listening | Union spy rest arguments were not tuples; Nest `getHttpServer` has no method generic; shared helper already binds an ephemeral server | Use explicit typed spy parameters, type the HTTP boundary, and rebind the existing owned server to loopback. Failures remain setup failures, not protocol RED. InMemory expanded tests then reached 27 passing behavioral cases | Test compile / matrix setup | Runner records runtime-error suites and checks exit status, not only failed-test count; smoke new harness code before repeating both database lanes |
| P3-I08 | Framework surprise / Medium | Live PowerShell POST returned 201 but subsequent PATCH targeted a missing id and returned 404 | `Invoke-WebRequest` returned `application/scim+json` content as `byte[]`; piping to ConvertFrom-Json parsed individual byte numbers rather than one resource | Decode byte content as UTF-8 before JSON parsing, assert created id exists, then rerun smoke: 33 assertions passed across User/Group/Device | Live author smoke / live author smoke | New live runner normalizes string/byte content at its transport boundary; status-only checks are insufficient |
| P3-I09 | Documentation environment / Low | Renderer initially skipped; relative-link sweep found three missing historical Session links; renderer discovery reports built-in version 0.0.0 | Worktree had no web/root dependencies; historical Session links refer to removed specs/local editor settings; built-in version metadata is not usable | After the missing-dependency attempt, owned read-only junctions reuse installed tooling. Five diagrams render in both strict themes. Three broken links are verified unchanged from HEAD and accepted outside this narrow package | Doc check / doc check | Do not describe SKIP as render proof or reinstall a fictitious Mermaid 0.0.0; parent consolidation may repair old Session links separately |
| P3-I10 | Handoff tooling / Low | First post-commit handoff generator had a JavaScript syntax error; later shell cleanup still ran | A stray quote in a regex broke the inline generator, and PowerShell semicolon sequencing did not propagate that native exit status | Rebuilt the handoff with a guarded fingerprint command and a PowerShell object. Verified the committed API/scripts fingerprint exactly matches final tested source; handoff lists all 39 files. Three owned dependency junctions were removed and worktree remains clean | Handoff syntax / final artifact verification | Check LASTEXITCODE before dependent shell actions; verify the artifact exists instead of trusting the final command's exit code |

## Entry checklist

For each new issue record:

1. Type and severity.
2. Observed failure, with evidence path.
3. Actual mechanism, not only the error text.
4. Confirmed resolution and commit when available.
5. Why the resolution fixes the cause.
6. Preventative test, check, or rule.
7. Earliest gate that could detect it versus the gate that did.

## Completeness and design disposition

This initial ledger covers design/commit preparation in this continuation.
It does not claim a full-transcript implementation reconciliation before
implementation has occurred. Each implementation context records confirmed
issues as it works; consolidation reconciles the package logs and available
full execution transcripts without importing unrelated analysis conclusions.

P3 evidence reconciliation: reviewed the complete per-run logs and receipts
under `test-results/conditional-writes`, plus the implementation tool results,
including failed setup runs. The RED fixture correction, missing dependencies,
unit fixture updates, test compile errors, listener reuse, binary SCIM response
decoding and renderer/link limitations map to P3-I01 through P3-I09. No external
session transcript was imported into this isolated worktree, so this is not a
claim of full-transcript reconciliation; that remains a parent consolidation
check. False signals dismissed: unchanged 147 lint warnings, setup-only failures
with zero failed test assertions, and three pre-existing Session links.

Final P3 matrix `postgres-69bf7bf777debff5`: 55/55 HTTP tests on each backend,
33 live assertions on each owned runtime, 22 migrations replayed on PostgreSQL
17.8, exact owned container cleanup verified. Final unit count: 692/692.

**Test/gate disposition:** historical failure evidence is retained; permanent
regression tests are required before production edits.

**Design disposition:** retain narrow work packages and resource repository
boundaries. No new infrastructure dependency is justified by this ledger.
