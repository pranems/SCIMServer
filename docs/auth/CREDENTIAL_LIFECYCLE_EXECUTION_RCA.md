# Credential lifecycle execution issues and RCA

> **Status:** Reconciled - **Last verified:** 2026-09-24 - **Product version:** `0.55.30`

This ledger records issues encountered while implementing explicit credential and WIF-trust lifecycle operations. Entries are captured when the failing check becomes green and will be reconciled against the full session transcript before consolidation.

## Issue dashboard

| ID | Type | Severity | Symptom | Root cause | Resolution | Detection stage | Earliest possible stage |
|---|---|---:|---|---|---|---|---|
| CL-01 | Persistence correctness | High | Rotation could create a new active credential and then fail to deactivate the old credential, leaving both active despite the API describing replacement semantics. | The controller composed two independent repository writes with no transaction boundary. | Added `IEndpointCredentialRepository.rotate`; Prisma performs active-source deactivation plus replacement creation in one transaction, and InMemory performs one synchronous state transition. Rotation now rejects inactive or raced sources. | Focused repository RED | Repository unit RED |
| CL-02 | Contract correctness | High | Permanent purge could return HTTP 204 even when the repository deleted no row or swallowed a database failure. | The repository `delete` contract returned `void`; the Prisma implementation caught every error, so the controller had no success signal. | Changed hard delete to return a verified boolean using `deleteMany`; both backends report whether one row was removed, and the controller returns 404 for a lost-row race while propagating real database failures. | Focused controller/repository RED | Repository unit RED |
| CL-03 | Test harness | Low | A fresh worktree could not run Jest because ignored `node_modules` and the generated Prisma client were absent. | Git worktrees contain tracked source only; dependencies and generated Prisma output are local ignored artifacts. | Reused the already-validated master dependency tree and generated client through local junctions. No package resolution, lockfile change, or generated source was committed. | First focused RED command | Worktree setup check |
| CL-04 | Environment drift | Low | The built Unit 3 API failed to bind `:6000` with `EADDRINUSE`; an unrelated local server already owned that port. | The local browser plan assumed the default live-test port without a port preflight. | Left the existing process untouched and ran the isolated pair on API `:6100` plus web `:4100`. | Browser setup | Port preflight |
| CL-05 | Gate integrity | High | `test-all-modes.ps1` exited 0 and printed "All 4 modes passed" after silently skipping both Prisma modes because `DATABASE_URL` was absent. A summary-only reading could have been reported as the required six-mode pass. | The runner converts a missing prerequisite into an implicit `-SkipPrisma`, even when the caller did not request a skip. Exit success therefore does not prove the required matrix cardinality. | Read the per-mode summary, found the active local PostgreSQL service, and reran with its explicit URL; all six modes passed. A runner hardening change is scheduled as a separate process rollback unit because it changes shared gate semantics. | Consolidation parity gate | Prerequisite check before the first matrix run |
| CL-06 | Documentation coupling | Medium | Adding two HTTP handlers made four user-facing `118 route handlers` claims stale. | The count is source-derived and duplicated in the API reference, index, and README. | The doc-content gate failed with the measured source count of 120; all four claims were updated and the gate passed. | Documentation content gate | Same gate, immediately after adding routes |
| CL-07 | Tooling friction | Low | A combined multi-file documentation patch failed on a stale large-file context anchor. | The patch coupled unrelated large-file anchors, so one mismatch rejected the entire operation. | Confirmed no partial application, split edits by file and exact heading, and validated each group immediately. | Documentation edit | Small per-file patch |
| CL-08 | Tooling friction | Low | The transcript reconciliation command entered PowerShell continuation mode because a search literal contained nested quotes. | The ad hoc string array was not shell-safe. | Terminated the read-only command and reran one alternation regex without nested quoting. | Build-end reconciliation | Use a single escaped regex pattern |
| CL-09 | Security / concurrency | High | An inactive credential could be reactivated after the controller's purge check but before repository deletion, allowing purge to delete a newly active credential. | The lifecycle invariant was checked before the persistence sink, leaving a time-of-check/time-of-use window. | Both repositories now delete only when `active=false` at the delete sink. A raced state change removes zero rows and returns `409`; active rows remain intact. | Security audit after consolidation | Repository negative-control unit test |
| CL-10 | Tooling friction | Low | The first manual supply-chain check called a non-existent PowerShell filename. | The active gate is a Node script, and the pre-push wrapper hides that implementation detail. | Located and ran `scripts/check-lockfile-provenance.mjs`; both lockfiles contain only `registry.npmjs.org` hosts and sha512 integrity entries. | Final hygiene | Resolve the gate from `pre-push-checks.ps1` before manual invocation |
| CL-11 | Repository hygiene | Low | The touched live-test script contained 14 forbidden Unicode dash characters in older section headings, and the RCA scan left one untracked temporary artifact. | Earlier scans had not covered the whole touched file; the transcript extraction was stored inside the worktree. | Mechanically normalized the headings to ASCII, deleted the temporary artifact, and reran the changed/untracked-file scan with zero findings. | Final hygiene | Changed-file character scan before consolidation |

## Why the fixes work

### CL-01

The transaction is the ownership boundary for replacement semantics. If replacement creation throws, Prisma rolls back the preceding deactivation. The active predicate also makes concurrent or repeated rotation return no replacement instead of silently rotating an already inactive row.

### CL-02

A destructive endpoint is correct only when storage confirms the deletion. `deleteMany` returns a count without turning an already-absent row into an exception; the controller can distinguish one deleted row from a race while allowing infrastructure errors to remain failures.

### CL-03

The junctions expose artifacts already produced from the same lockfiles and schema. They restore the normal module-resolution shape without contacting a registry or modifying dependency metadata.

### CL-04

Choosing unused ports isolates this branch's evidence from an already-running service. The test targets were explicit, so every browser request still reached the exact Unit 3 build.

### CL-05

The second run supplied the database prerequisite and printed six named PASS rows, including full Prisma E2E. This distinguishes "all modes that happened to run" from "the required matrix ran." The shared script should eventually fail prerequisite exit code 2 unless the caller explicitly requests `-SkipPrisma`.

### CL-06

The audit derives route count from controller decorators, so updating the duplicated prose to its measured 120 restores one source of truth. A negative count mismatch was observed before the fix.

### CL-07 and CL-08

Both fixes reduce tooling ambiguity without changing product files: smaller file-local edits and shell-safe transcript patterns make failure atomic and legible.

### CL-09

The state predicate and deletion now execute in one storage operation. Prisma uses `deleteMany({ id, active:false })`; InMemory checks the stored row immediately before deletion. This is the existing PD-1 rule applied to lifecycle state: enforce the invariant at the destructive sink, not only in an upstream controller.

### CL-10 and CL-11

The real supply-chain script derives structural host and integrity counts from both lockfiles. Character normalization changed comments and headings only; a PowerShell AST parse verifies the script remains syntactically valid.

## Prevention

- Keep multi-row or multi-write lifecycle transitions behind one repository operation with one transaction boundary.
- Destructive repository methods must return a structural success signal; controllers must not infer success from a fulfilled `void` promise.
- New worktrees should verify dependency and generated-client availability before the first RED run.
- Matrix gates must assert the number and identity of required modes, not only that every executed mode passed.
- Preflight local ports before starting an isolated API/web pair.
- Keep large documentation edits file-local and validate source-derived claims immediately.
- Enforce destructive lifecycle predicates in the repository write itself so concurrent state changes cannot bypass an upstream check.
- Resolve manual gate commands from the checked-in pre-push wrapper, and keep reconciliation artifacts outside the worktree.

## Design and architecture disposition

Applied and scheduled: transaction ownership belongs in the repository, while the controller remains responsible for endpoint ownership, lifecycle policy, logging, and events. `AdminCredentialController` remains an existing god-class finding in `REMAINING_WORK_REGISTER.md` D1. The auth platform owner must split the WIF diagnostics controller before the next credential-admin feature adds another route; doing that inside this deploy-bound lifecycle fix would combine structural refactoring with behavior and repeat the orphaned-decorator risk.

## Self-improvement disposition

Applied and scheduled: the exact partial-rotation and false-success purge failure modes now have negative-control unit tests. The four-mode false-green is an instance of the existing "a gate proves only what it asserts" pattern; hardening `test-all-modes.ps1` is scheduled as a separate process rollback unit before the next feature consolidation.

## Provenance and completeness

Reconciled against the full session transcript from the Unit 3 start through consolidation. The pass used two lenses: issue signals (`RED`, `FAIL`, TypeScript diagnostics, `EADDRINUSE`, missing modules, skipped modes, invalid patch context) and diagnosis phrases (`root cause`, `silently`, `blocked`, `stale`). Search echoes and expected negative-control failures were discarded. Verified non-issues: the full web TypeScript run contained only the documented pre-existing test baseline and zero touched-file errors; the visual snapshot working-tree marker had the same Git blob hash as the index; Mermaid's renderer-version warning did not affect the 712/712 two-theme render result.
