<!--
SCIMServer Pull Request Template

Closes OPS-4 (DELIVERY_PLAN.md Week 1 Day 5). The Feature/Bug-Fix Commit
Checklist below is the canonical source for what every change must include.
A regression test (api/src/security/required-governance-files.spec.ts) keeps
this file structurally honest.
-->

## Summary

<!-- One-line description of WHAT this PR changes. -->

## Linked Defect / Plan Reference

- DELIVERY_PLAN.md defect ID:  <!-- e.g. S-2, R-1, DTO-1, OPS-4, UI-B3 -->
- Audit doc reference:         <!-- e.g. docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md S-4 -->
- ADR (if applicable):         <!-- e.g. docs/adr/ADR-004-enable-implicit-conversion.md -->

## TDD Process

- [ ] RED test written first; observed it fail for the expected reason
- [ ] GREEN: minimal implementation that turns the test green
- [ ] Refactor (if any) keeps the test green
- [ ] Permanent regression guard added (where applicable - see existing patterns in `api/src/security/`)

## Feature / Bug-Fix Commit Checklist (standing rule)

Every behavioral change must include all that apply. Tick or strike through with N/A + reason.

- [ ] **Unit Tests** - service-level and controller-level coverage of the new behavior
- [ ] **E2E Tests** - end-to-end spec under `api/test/e2e/` exercising the feature through HTTP
- [ ] **Live Integration Tests** - new section in `scripts/live-test.ps1` runnable against local + Docker + Azure
- [ ] **Feature Documentation** - dedicated doc in `docs/` with architecture, RFC references, Mermaid diagrams, test coverage
- [ ] **INDEX.md Update** - add the new doc reference to `docs/INDEX.md`
- [ ] **CHANGELOG.md Update** - `[Unreleased]` entry with full test counts and feature summary
- [ ] **Session & Context Updates** - `Session_starter.md` and `docs/CONTEXT_INSTRUCTIONS.md`
- [ ] **Version Management** - bump `api/package.json` (and any other version refs) when behavior changed
- [ ] **Response Contract Tests** - API responses contain ONLY documented fields (key allowlist assertion at unit + E2E + live)

## Validation Output

```
Unit:        / 3,476 pass (88 suites)
E2E:         / 1,104 pass (52 suites, inmemory)
Lint:        0 errors
Bundle:      KB gz (size-limit when applicable)
Em-dash:     clean
```

## Standing Rules Acknowledgment

- [ ] **No em-dash** (Unicode `U+2014`) anywhere in the diff. Verified via `Select-String -Pattern ([char]0x2014)`.
- [ ] **No `git commit --amend`** on history that has been pushed.
- [ ] **No new credentials, tokens, or secrets** committed to source. Forbidden patterns regression spec at `api/src/security/forbidden-source-patterns.spec.ts` will catch known anti-patterns.
- [ ] **Migrations are additive-only** (expand-contract for column changes). Migration linter at `api/src/scripts/lint-migrations.ts` enforces this.

## Destructive Migration Override (skip if not applicable)

- [ ] This PR contains a NEW destructive Prisma migration (DROP TABLE/COLUMN, ALTER COLUMN ... TYPE, RENAME, INSERT ... SELECT FROM)
- [ ] I have set `ALLOW_DESTRUCTIVE_MIGRATION=1` in the CI environment for this PR
- [ ] Justification (required if box above is ticked):
  ```
  <!-- Why this destructive change is necessary, what the rollback path is, and which release window it ships in -->
  ```

## Reviewer Hint

Diff areas worth special attention from the reviewer:

<!-- Bullet specific files / functions that benefit from a careful read -->
