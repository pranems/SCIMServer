---
name: runPhaseWorkflow
description: Execute one delivery phase with implementation, validation, documentation, and commit summary.
argument-hint: Phase scope, goals, backend modes, test commands, and documentation targets.
---
You are executing the next project phase in a phased migration roadmap.

## Inputs
- Phase to execute: **{{phase_name}}**
- Current completed phase baseline: **{{completed_baseline}}**
- Target architecture/end-state: **{{target_state}}**
- Mandatory backend modes to keep in parallel: **{{backend_mode_1}}** and **{{backend_mode_2}}**
- Project goals and requirements: **{{goals_and_requirements}}**
- Test entrypoints:
  - Unit: **{{unit_test_command}}**
  - E2E (as-is): **{{e2e_test_command}}**
  - Live (as-is): **{{live_test_command}}**
- Local runtime command: **{{local_run_command}}**
- Fresh container build/run commands: **{{container_build_command}}**, **{{container_run_command}}**
- Phase documentation targets: **{{phase_docs_paths}}**

## Execution Requirements
1. **Implement only this phase** (no future-phase scope creep), while preserving compatibility with both backend modes.
2. **Analyze current code and gaps** for this phase, then implement source-code changes needed to meet phase goals.
3. **Add missing tests** relevant to this phase changes and any newly detected issues:
   - Unit tests for logic and edge cases
   - E2E tests for user-visible/API behavior
   - Live-test additions if runtime behavior coverage is missing
4. Run verification in this order:
   - Unit tests must pass
   - Current as-is E2E tests must pass
   - Start a fresh local instance and run as-is live tests
   - Build a fresh latest local container, run it, and run as-is live tests against it
5. If failures appear, diagnose root cause, implement minimal robust fixes, and re-run impacted tests until green.
6. **Keep the final Docker container running** after all validations pass. Do not stop or remove it — leave it available for the user to inspect and interact with.

## Documentation Deliverables
Create/update two detailed phase documents:

### A) Phase Change Document (Before vs After)
Must include:
- Scope and objectives for this phase
- Before/after architecture and behavior
- Source code changes (not only docs), grouped by module/file type
- Data model/API/flow changes
- Diagrams (architecture, sequence, data flow)
- Example payloads and JSON samples
- Endpoint/method/header expectations where relevant
- Test coverage added/updated and execution results
- Validation evidence for local instance and fresh container runs

### B) Issue Diagnosis & Resolution Document
Must include for each issue faced during this phase:
- Symptom and impact
- Detection method
- Detailed diagnosis path
- Root cause
- Alternative solutions considered
- Chosen solution and rationale
- Fix summary
- Regression tests added
- Prevention notes for future phases
- Diagrams/flows/examples/JSON/headers/URLs/sample data where useful

## Change Analysis & Commit Prep
1. Analyze **all staged and unstaged file changes** for this phase (source + tests + docs).
2. Produce a concise grouped summary of overall phase changes.
3. Draft a **brief commit message** that accurately reflects the phase scope and outcomes.

## Goal Alignment & Quality Gate
1. Explicitly evaluate whether the project remains on track with primary goals/requirements.
2. Identify any remaining missing tests across all levels.
3. Add those tests and re-run the necessary validation set.
4. Update phase docs with final fixes, diagnostics, and validated outcomes.

## Self-Improvement & Documentation Update
After phase implementation is validated and complete:
1. **Update all project documentation** to reflect this phase's outcomes:
   - `Session_starter.md` — progress log, version, test counts, assistant memory
   - `CHANGELOG.md` — version bump entry with feature summary and test counts
   - `docs/CONTEXT_INSTRUCTIONS.md` — new gotchas, constraints, or architectural decisions
   - `docs/INDEX.md` — add references to any new phase docs created
   - `docs/CURRENT_STATE_AND_MIGRATION_PLAN.md` — mark phase complete, update heat map and counts
   - `docs/PROJECT_HEALTH_REPORT.md` — update tech debt, test counts, and phase status
   - `docs/SCIM_COMPLIANCE_MATRIX.md` — update compliance status for affected RFC sections
   - `package.json` — bump version number
2. **Review this prompt template** for lessons learned:
   - Did any step prove unnecessary or missing?
   - Were there recurring issues that a new checklist item could prevent?
   - If improvements are identified, apply them to this prompt file and its variants.
3. **Verify consistency** across all updated docs (version numbers, test counts, feature lists match).

## Output Format
Return a concise final report with:
- What changed (implementation)
- What changed (tests)
- Validation results (unit/e2e/live-local/live-container)
- Docs produced/updated
- Project docs updated (list)
- Issues found and fixed
- On-track assessment
- Final commit message suggestion
- Any residual risks or follow-ups
- Docker container status (image tag, container name/ID, port mapping — confirm running)
