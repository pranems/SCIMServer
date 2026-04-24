---
name: runPhaseWorkflowMvp
description: Execute one MVP phase with minimal scope, tests, and concise documentation.
argument-hint: Phase goal, constraints, commands, and required evidence outputs.
---
You are executing the **next MVP phase** in a phased migration roadmap.

## Inputs
- Phase: **{{phase_name}}**
- Completed baseline: **{{completed_baseline}}**
- Goal for this phase only: **{{phase_goal}}**
- Parallel backend requirement: **{{backend_mode_1}}** + **{{backend_mode_2}}**
- Constraints (minimal/MVP): **{{constraints}}**
- Commands:
  - Unit tests: **{{unit_test_command}}**
  - E2E (as-is): **{{e2e_test_command}}**
  - Live (as-is): **{{live_test_command}}**
  - Local run: **{{local_run_command}}**
  - Fresh container build/run: **{{container_build_command}}**, **{{container_run_command}}**

## MVP Rules (Strict)
1. Implement **only** what is required for this phase goal.
2. Do not add extra features, refactors, or speculative architecture.
3. Keep code changes surgical and reversible.
4. Preserve behavior parity across both backend modes.

## Delivery Steps
1. Identify the exact gap for this phase and implement the minimal fix.
2. Add only necessary tests for changed behavior:
   - Unit tests for logic paths and edge cases introduced by this phase
   - E2E tests only where externally observable behavior changed
   - Live-test additions only if current suite misses the new behavior
3. Validate in order:
   - Unit tests pass
   - Existing E2E suite passes
   - Local instance + existing live tests pass
   - Fresh latest container + existing live tests pass
4. If any failure occurs, fix root cause minimally and re-run impacted validation.
5. **Keep the final Docker container running** after all validations pass. Do not stop or remove it - leave it available for the user to inspect and interact with.

## Required Artifacts (Lean)
Produce two concise docs/sections:

### A) Phase Delta Note
- What changed (before/after for this phase only)
- Files changed (source + tests + docs)
- API/data-flow impact (if any)
- Evidence summary of test runs

### B) Issues Encountered Note
For each issue in this phase:
- Symptom
- Root cause
- Detection/diagnosis
- Chosen fix (and why)
- Tests added to prevent regression

## Commit Prep
1. Summarize all staged + unstaged changes grouped by implementation/tests/docs.
2. Draft one brief commit message for this MVP phase.

## Exit Checks
- Confirm whether this phase keeps the roadmap on track.
- List any unresolved risks or next-phase carry-overs.

## Self-Improvement & Documentation Update
After MVP validation is complete:
1. **Update project documentation** to reflect this phase's outcomes:
   - `Session_starter.md` - progress log, version, test counts
   - `CHANGELOG.md` - version bump with feature summary
   - `docs/CONTEXT_INSTRUCTIONS.md` - new gotchas or constraints discovered
   - `docs/INDEX.md` - add references to any new phase docs
   - `docs/PROJECT_HEALTH_AND_STATS.md` - update test counts and phase status
   - `package.json` - bump version number
2. **Review this prompt template** for improvements:
   - Were any steps missing or unnecessary?
   - Apply identified improvements to this prompt and its variants.
3. **Verify consistency** across updated docs (versions, test counts, feature lists).

## Output Format
Return:
- MVP implementation summary
- Tests added/updated
- Validation results (unit/e2e/live-local/live-container)
- Lean docs produced
- Issues fixed
- On-track verdict
- Brief commit message
- Project docs updated (list)
- Docker container status (image tag, container name/ID, port - confirm running)
