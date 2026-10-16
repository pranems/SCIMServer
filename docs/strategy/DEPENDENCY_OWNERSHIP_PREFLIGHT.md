# Physical dependency ownership before validation

**Last verified:** 2026-10-16

## Executive summary

Validation must not regenerate a Prisma client, rebuild packages or restore
dependencies through another checkout's `node_modules` junction. The shared
[ownership guard](../../scripts/assert-dependency-ownership.ps1) now runs
before work in all five canonical validation entry points. It diagnoses
unsafe paths and stops; it never removes a link, modifies its target or
installs packages.

This is tooling-only. Product version remains 0.55.51, and neither runtime
behavior nor the deployed image changes. Operator UI acceptance and Mermaid
version alignment remain separate outcomes.

## Policy and flow

The checkout root, `api`, `web` and their three top-level `node_modules`
directories must be physical directories when present. Junctions, symbolic
links and other reparse points are refused, including dangling links.
The rule deliberately rejects even an apparently internal directory link:
its destination is not proof of exclusive dependency/generated-file ownership.
Normal package-internal links, such as npm executable links, are not scanned.

```mermaid
flowchart TD
    R["Existing physical checkout root"] --> P{"Project or dependency path linked or not a directory?"}
    P -->|"yes"| F["Explicit ownership error; stop before external commands"]
    P -->|"no"| M{"Dependency directory absent?"}
    M -->|"yes"| A["Report ABSENT; existing runner prerequisites remain responsible"]
    M -->|"no"| O["Report PHYSICAL"]
    A --> V["Continue existing validation behavior"]
    O --> V
```

An absent dependency directory is not reported as physically verified.
This check is not a package-availability or integrity substitute. A missing
repository root is an error, not a successful set of absent dependencies.

| Entry point | Enforcement |
|---|---|
| [Protected push](../../scripts/pre-push-checks.ps1) | Before build/lint/test gates; new negative-control contract is the first gate |
| [Backend matrix](../../scripts/test-all-modes.ps1) | Before mode work or dependency restore; prerequisite failure exits 2 |
| [Dev deployment](../../scripts/dev-deployment-pipeline.ps1) | Before report creation, estate resolution and external commands; true `-DryRun` remains nonexecuting |
| [Local/Docker validation](../../scripts/full-validation-pipeline.ps1) | Before build, environment setup or container operations |
| [Quality-gate walker](../../scripts/run-all-gates.ps1) | Before report/prerequisite execution; true `-DryRun` remains nonexecuting |

Direct one-off npm commands are outside these entry points. Run the guard
first when doing equivalent manual mutation-capable validation:

```powershell
pwsh -NoProfile -File scripts\assert-dependency-ownership.ps1 `
  -RepositoryRoot (Get-Location).Path
pwsh -NoProfile -File scripts\test\dependency-ownership.contract.ps1
```

## RED/GREEN and coverage

Initial RED: 14 explicit ownership/early-wiring assertions failed before the
guard existed. An added adversarial missing-root case then reproduced one
real invalid-input acceptance failure before its correction.

GREEN: **31/31 ownership assertions** pass. They exercise real junctions on
Windows and symbolic links on other platforms, linked root/API/web dependency
directories, linked project parents, dangling links, files instead of
directories, missing roots, physical copies and explicitly absent dependencies.
Foreign fixture content remains unchanged.

For each actual runner, a copied sandbox invokes its real prelude against
linked dependencies. npm, npx, Node, Docker, Azure CLI and Git are replaced
with command sentinels. Every runner exits nonzero with the ownership
diagnostic before any sentinel starts. AST ordering is supplementary evidence,
not a substitute for these subprocess outcomes.

Related backend-matrix, dev-pipeline and quality-walker contracts pass.
The matrix contract copies the real default guard into its sandbox so it
continues testing the intended missing-database and explicit opt-out behavior.
No full product matrix or deployment is needed to prove this preflight.
The normal protected push owns its applicable existing product checks.

## Execution issues and root causes

| ID | Type / severity | Symptom and root cause | Fix and why it works | Detection / earliest detection |
|---|---|---|---|---|
| DO-I01 | Test tooling / Low | All five wiring assertions initially failed because the AST counted both the invocation and its nested `Join-Path` command. | Select the ampersand invocation node, then additionally exercise real runner subprocess refusals with command sentinels. This distinguishes an actual guard call from a nested path expression. | First GREEN attempt / same focused contract |
| DO-I02 | Invalid-input handling / Medium | A nonexistent repository root was accepted as six absent paths. Missing dependencies and a missing checkout were conflated. | Require the root to exist; only dependency/project absence retains the runner's existing availability checks. The adversarial root case changes RED to GREEN. | Added adversarial test / same focused contract |
| DO-I03 | Documentation / Low | A draft handoff introduced an unsupported independent-claim count and a duplicated empty heading. | Replace the count with the verified normal-push fact and remove the empty heading before committing. Evidence counts must come from receipts, not an incidental prose edit. | Focused pre-commit review / same documentation edit |
| DO-I04 | Test oracle / Medium | Parent-link non-mutation checks initially inspected a marker in the shared dependency directory rather than each linked project's actual target. That could miss a changed parent target. | Assert a marker in each exact target; both parent fixtures first fail RED, then initialize their own markers and pass. Unrelated surviving content is no longer accepted as target-preservation proof. | Focused assertion review / target-specific negative control before first GREEN |

The original shared-dependency incident is DT-I17 in the
[UI date/time ledger](../UI_DATE_TIME_IDENTITY_CONSISTENCY.md#validation-ownership-correction-dt-i17).
This guard makes its prevention executable rather than repeating a warning.
Source/payload integrity and corporate package quarantine remain independent
requirements; no dependency, manifest or lockfile changed here.

### Provenance and completeness

The full available continuation log was reconciled through event 10,866,
retaining earlier reconciliations. Separate failure-signal and causal-narration
passes yielded 68 cumulative candidates, 19 after the prior checkpoint.
The initial 14 expected RED assertions are not a production incident;
the unexpected AST false failures and adversarial invalid-root failure map
to DO-I01/02. DO-I03 was corrected in the draft. Historical failures,
successful patch text, status updates and scanner echoes were verified and
dismissed as new incidents. This does not claim access to the deleted
original conversation.

Self-improvement disposition: **applied**, through actual link fixtures,
runner subprocess refusal and mutation sentinels.
Design disposition: **accepted**, one cohesive shared preflight reused by
five callers, no generic path framework or production abstraction.
