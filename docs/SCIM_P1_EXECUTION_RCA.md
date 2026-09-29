# P1 execution issues and root causes

**Last verified:** 2026-09-28

Companion: [P1 implementation](SCIM_P1_IMPLEMENTATION.md).
Historical analysis and reproduction receipts remain unchanged.

| Issue | Type / severity | Symptom and mechanism | Fix and why it works | Detection / earliest gate | Prevention |
| --- | --- | --- | --- | --- | --- |
| Native Boolean path becomes data | Protocol / High | The quoted-string regex rejected a valid selector. Extension dispatch then treated its text as an attribute. Strict mode rejected it twice; lenient mode stored it. | A shared typed path parser uses the existing filter AST and rejects invalid syntax before dispatch. The first focused run changed from 53 failing domain tests to 57 passing tests. | Baseline synthetic unit and HTTP RED / unit | Permanent incident and invalid-path tests assert actual values and the absence of bracket keys. |
| Extension mutation aliases input | Atomicity / High | Extension helpers modified nested objects shared with the input snapshot before the request completed. | Resolved-key immutable writes replace extension objects rather than modifying the caller's objects. | Domain snapshot assertion / unit | Every engine incident case asserts the original input is unchanged. |
| Missing worktree dependencies | Environment / Low | The first chosen Jest command failed because this isolated worktree had no dependencies. | A task-owned API dependency junction reuses installed frozen tooling; Prisma output is generated only into this worktree's `api/src/generated/prisma`. No lockfile regenerated. | First runner invocation / first runner invocation | Record and verify the junction target; unlink only the owned junction at completion. |
| Group response allowlist omitted members | Test correctness / Low | Two HTTP cases passed every update assertion but failed the new top-level allowlist because Groups correctly return `members`. | Add the documented field to the Group allowlist, without weakening extension key/value checks. | First GREEN HTTP / test authoring | Enumerate resource-family-specific response fields. |
| Legacy dotted namespace regression | Compatibility / Medium | The first existing-suite run rejected `urn:example:ext:device:2.0.firmware`. Without registered URNs, a version dot was mistaken for an attribute delimiter. | Keep the legacy numeric-version namespace form inside the shared parser. The three existing generic-engine cases now pass. | Existing unit regression / focused unit | Existing legacy tests remain unchanged. |
| Baseline tests endorsed parser defects | Test correctness / High | Six utility assertions expected null/literal fallback, stringified numbers or equality in place of starts-with. | Replace those expectations with typed comparisons and explicit syntax errors. Baseline RED already proved the actual incident before implementation. | Regression suite / protocol-derived tests | Do not retain a known defect as an expected compatibility contract. |
| Group selected member null | Compatibility / Medium | Newly supported core selection accepted null for `members[...].value`; an existing HTTP regression expected rejection. | Preserve the required member value guard at the selected-member boundary. The existing null suite is green. | HTTP regression / domain selection test | Retain the null HTTP regression; do not use P1 to change required-member policies. |
| Multi-segment selector suffix | Grammar / High | `contacts[primary eq true].value.deep` was accepted as a literal sub-attribute key. | A dedicated RED run failed three engine assertions. Reject more than the single sub-attribute allowed by RFC valuePath grammar; all 60 engine cases are green. | Focused adversarial unit / parser unit | Explicit unsupported-tail test in every engine. |
| New fixture missing required type fields | Test harness / Low | TypeScript rejected the added schema fixture before its assertions ran. | Declare `required` and `multiValued` in the fixture. This is a harness failure, not product RED evidence. | ts-jest compilation / test authoring | Keep new test files fully type-checked. |
| Removed matcher left unused argument | Tooling / Low | Focused ESLint found one unused `caseExactPaths` parameter after removal of the Group regex. | Remove the parameter and its obsolete call arguments. Final focused lint is unchanged at 0 errors / 55 warnings. | Lint / lint | Always re-run focused lint after structural removal. |
| Optional editor tools unavailable | Environment / Low | Container CLI configuration and editor Problems tools failed. | Use the already documented Docker CLI; rely on real build, Jest, and lint evidence. No editor-diagnostics success is claimed. | Tool invocation / tool invocation | State unavailable tooling rather than inventing results. |
| Mermaid metadata warning | Environment / Low | Root/web dependencies were absent; after owned tooling junctions, rendering passed but built-in version discovery reported `0.0.0`. | Six diagrams render in both themes with pinned 11.15.0. Exact editor-version parity remains unverified; do not install the suggested invalid version. | Render gate / render gate | Record the warning for integration; no dependency or renderer-source changes in P1. |
| Extracted receipt whitespace | Tooling / Low | The staged diff check rejected blank final lines in three extracted RED excerpts. | Remove only trailing blank lines; staged diff check then passed with assertion text unchanged. | Pre-commit preparation / artifact generation | Trim extracted receipts before staging, and check the staged diff rather than only tracked working-tree files. |

Design disposition: **applied**. Path grammar and predicate matching now have
small shared domain seams; repositories, query DTOs, and controllers retain
their existing responsibilities. Broader operation-policy work remains P2.

## Provenance and completeness

This ledger was reconciled against the complete retained P1 runner logs and
the task's tool results: initial missing-runner output, domain/HTTP RED,
first regression failures, fixture compilation failure, focused lint,
successive backend receipts, and documentation gates. Baseline assertion
failures are retained separately from harness failures. Expected primary
normalization warnings and ephemeral test OAuth-key messages were reviewed
and are not product failures.

`VSCODE_TARGET_SESSION_LOG` is not configured in this subagent environment.
Therefore a host-level full-transcript reconciliation is **not claimed**;
the parent integration owner retains that final provenance check. The
package's focused executable acceptance evidence is green.
