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

**Test/gate disposition:** historical failure evidence is retained; permanent
regression tests are required before production edits.

**Design disposition:** retain narrow work packages and resource repository
boundaries. No new infrastructure dependency is justified by this ledger.
