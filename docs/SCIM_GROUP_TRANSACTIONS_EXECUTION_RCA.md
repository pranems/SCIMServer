# Group aggregate transactions: execution issues and RCA

**Last verified:** 2026-09-28

This ledger covers P4 only. The base is P3 commits `0aae3077` and `41c5b8c5`.
Historical evidence is not rewritten. All resources are synthetic and all
databases are owned disposable containers.

## Confirmed issues

| Issue | Type / severity | Symptom and root cause | Fix and why it works | Detection / earliest possible |
|---|---|---|---|---|
| G1 | Persistence / High | Group POST inserted the Group before resolving or saving initial members. A later failure left an apparently created empty Group. | Resolve first, then pass initial members to the repository create operation. PostgreSQL uses one transaction; InMemory stages both maps before publication. | Independent HTTP finding, reconfirmed by P4 RED / repository and service unit |
| G2 | Backend parity / High | InMemory accepted duplicate member values, and `addMembers` wrote a prefix before a later failure. The database already enforces the member key. | One synchronous member-staging function checks the complete candidate set, including existing members for append, before any write. | P4 unit RED / repository unit |
| G3 | Concurrency / High | A read returned version 1 and the old name with version 2's members. `findWithMembers` awaited the scalar lookup before reading the member map. | Read both maps without an await, through a small synchronous lookup. A deterministic read/update test fails on the old implementation. | P4 unit RED / repository unit |
| G4 | Test correctness / Medium | Three existing tests varied internal user ids but reused the same SCIM member value. They started failing when the missing member constraint was enforced. | Give each intended distinct member a distinct value; preserve the original timestamp, generated-id and cascade assertions. Dedicated negative tests still reject duplicates. | First GREEN consolidation / fixture review |
| G5 | Environment / Low | The fresh worktree had no Jest binary. | After the failed existing command, link only the approved root/API dependencies; generate the Prisma client into this worktree from its own schema with an inert URL. No install, lock regeneration or shared generated files. | First test command / same |
| G6 | Tooling / Low | Container configuration and editor Problems tools returned execution errors. Three patch attempts missed exact fixture/document context; two had already applied earlier files. | Use the existing Docker harness and TypeScript/Jest checks; inspect each failed hunk and retry only that file. Do not infer editor success or undo successful hunks. | Tool invocation / same |
| G7 | Adjacent error contract / Medium | PostgreSQL's existing repository error mapping exposes the injected failure message in SCIM `detail`. Two initial assertions caught this rather than aggregate rollback. | Keep envelope, key allowlist and native-code/stack checks, but separate the raw-detail assertion from P4. Rerun RED without production changes: PostgreSQL 60 pass / 5 fail; InMemory 59 pass / 6 fail. Error-detail sanitization belongs to P5/consolidation, not a hidden edit to shared error helpers here. | First P4 HTTP RED / existing error-contract unit |
| G8 | Test typing / Low | The local-member positive control initially failed to compile because `randomUUID()` inferred a UUID template type narrower than an HTTP string id. The other 99 HTTP tests passed; P4 was not green. | Explicitly type member values as strings at the fixture boundary. Rerun: 110 InMemory tests and 111 PostgreSQL tests pass; the native FK control is explicitly skipped, not counted as a success, on InMemory. | HTTP compilation / focused TypeScript lint |
| G9 | Environment / Low | The real Mermaid gate reported missing Playwright in the fresh worktree. Exit zero meant SKIP, not a render. | Restore this worktree's existing web dependencies with `npm ci --ignore-scripts` only after the missing-tool result. No package versions or lockfiles changed. | Diagram gate / same |
| G10 | Test typing / Low | Jest accepted a spy callback whose inferred parameters ESLint treated as unsafe `any`. A combined shell command ended with the successful build's status although the lint summary contained four errors. | Type both callback parameters explicitly; run the lint ratchet independently and verify its zero result. Final lint is zero errors and 52 unchanged warnings across nine files. Preserve each gate result rather than treating a command chain's last exit as proof of all gates. | Focused lint / same |
| G11 | Renderer provenance / Low | The built-in Mermaid discovery reports version `0.0.0`, although the pinned gate is 11.15.0. | Render all seven diagrams in actual Chromium under both strict themes, but do not claim viewer-version equality or install `0.0.0`. This is unchanged P3 environment metadata, not a diagram failure. | Diagram gate / same |
| G12 | Process / Low | Separate `git commit -m` arguments put a blank line between the two required trailer strings. Both strings are present, but `git interpret-trailers --parse` recognizes only the last paragraph. | Preserve the already-created ordinary commit; do not amend. Pass the handoff's two trailers in one newline-separated message argument and verify both with the Git parser. | Post-commit verification / message construction |

G1-G4 fixes were confirmed by **205 passing tests in four targeted unit
suites**. G1's real PostgreSQL and HTTP evidence passed in run
`postgres-fc525ad2f8ee304d`: 110 InMemory and 111 PostgreSQL tests, including
the existing 55 P3 controls and 44 Group lifecycle/parity controls. The sole
InMemory skip is the native PostgreSQL foreign-key control. The
[implementation guide](SCIM_GROUP_TRANSACTIONS_IMPLEMENTATION.md) records
the final evidence and exact source identity.

## Self-improvement and architecture disposition

**Applied:** rollback tests now check the full stored aggregate, not just
the status: payload, scalar fields, version, timestamps and member row ids.
A deterministic torn-read regression also guards the read side.
The lesson is promoted to PA-10 in the
[central pattern ledger](strategy/ENGINEERING_LESSONS_AND_PATTERNS.md)
and the aggregate integrity rule in `.github/copilot-instructions.md`.

**Accepted:** extend the existing Group repository create port with optional
initial members; do not introduce a universal transaction manager, a new
controller strategy or a repository dependency on the User repository.
The service shrinks. Two small backend-local helpers remove mapping duplication
and keep staging explicit. Group name/schema uniqueness remains P3b.

## Provenance and completeness

Captured at confirmed fixes. The scope-corrected dual-backend RED artifact is
`test-results/group-transactions/postgres-1278ff12d32dc28e/run.json`.
The first diagnostic RED artifact is `postgres-b47ad76248ac92ba`.
The final exact-source run is `postgres-5a349052c937bd39`, with 111 PostgreSQL
and 110 InMemory HTTP passes, 69 new live assertions per backend and no failed
test or setup suites. All six database runs, including RED/setup-failure
runs, verified removal of their exact owned container. No persistent volumes
or shared database targets were created.

Reconciled against the **entire available session `events.jsonl`**, not a
compaction summary: streamed 22,138 lines at the checkpoint and selected this
P4 subagent's `parentToolCallId`, yielding 630 scoped events, 117 tool starts,
116 completed outputs and 55 assistant messages. Ran an output-signal pass
(TypeScript errors, missing commands, failed tools/patches, expected-value
failures, constraints, skips, renderer drift and unsafe assignment) and a
narration-phrase pass (failure, partial, root cause, separate, torn, GREEN).
Every diagnosed issue maps to G1-G11 above. Hook/input echoes and repeated
printed logs were excluded from recurrence counts; zero-valued
`setupFailedSuites` fields and the deliberate InMemory FK skip were verified
and dismissed as non-failures. Three real patch-context failures and the
renderer warning are retained rather than lost to summary compression.
The subsequent post-commit check added G12; it found no new implementation issue.
Cleanup also removed the owned root/API tool junctions (without traversing
their shared targets), the owned web dependency restore, generated Prisma
client, API build and scratch lint driver. Sanitized ignored logs and evidence
remain available to the parent; the committed evidence summary carries the
portable counts and hashes.
