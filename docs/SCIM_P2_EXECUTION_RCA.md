# P2 execution issues and RCA

**Last verified:** 2026-09-28

| Issue | Type / severity | Symptom and cause | Resolution and why it works | Detection / earliest |
| --- | --- | --- | --- | --- |
| P2-1 | Protocol / High | Baseline lost appended values, changed only the first selection, rejected selected objects, and allowed invalid intermediate required/immutable states. Independent implementations conflated replacement with addition and checked only the final state. | Shared operation-atomic executor, schema-aware leaf merge, all-match selection and current-state transitions. Initial permanent RED: 46 failed / 3 passed. GREEN: 49/49, within 537/537 focused domain tests. | Permanent unit / permanent unit |
| P2-2 | Tooling / Low | Worktree had no Jest dependency link; VS Code test tool also unavailable. | After the observed missing-module failure, linked only API tooling from the original worktree. Generated the missing Prisma client into this worktree with an unreachable placeholder URL. No database connection or shared generated-code write. | Tool invocation / tool invocation |
| P2-3 | Test fixture / Low | First RED attempt compiled zero tests because attribute fixtures omitted required TypeScript fields. | Fixture builder supplies explicit RFC default cardinality and requiredness; rerun produced actual semantic assertion failures. Compiler failures are not counted as RED. | Jest compilation / Jest compilation |
| P2-4 | Compatibility / Medium | Initial refactor introduced a raw User displayName and lost extension empty-value/default-URN behavior. | Preserved column/raw-payload separation, existing default URNs and null-as-unset semantics. Existing compatibility suite now passes. Group scalar add expectation deliberately corrected because supporting ordinary Group attributes is a P2 outcome. | Existing unit / existing unit |
| P2-5 | Shell / Low | PowerShell interpreted unquoted brace syntax as an expression rather than expanding filenames. | Narrow glob passed to ripgrep, not shell brace expansion. | Command parse / command parse |
| P2-6 | Transition policy / High | Strict-off allowed required remove/repair and immutable first/second assignment. Six new HTTP controls returned 200 rather than 400. The existing immutable policy is explicitly unconditional, but the first executor draft accidentally gated it on strict schema mode. | Make required/immutable transitions unconditional when a target has an effective definition. Strict still controls type/unknown value validation and readOnly compatibility stripping. GREEN: all six controls, 75 HTTP total and 1,478 targeted unit tests. | HTTP / domain options test |
| P2-7 | Harness / Medium | Two P1 service mocks declared extension URNs but not their schema definitions; the executor correctly refused unresolved selection targets. | Register the synthetic schemas in the service mock, matching the permanent HTTP fixture. Do not relax selector validation to accommodate incomplete mocks. | Service unit / service fixture setup |
| P2-8 | Independent review / High | Reviewer reproduced six gaps: array immutable descendants, expanded no-path and namespace readOnly writes, scalar selectors intercepted by Group hooks, synthesized-primary handoff, single-element add cardinality, and property-order-sensitive immutable equality. Fifteen permanent unit checks failed. | Resolve targets before hooks; share readOnly policy and structural value equality; compare retained array entries at each transition; normalize add shape against the selected definition; hand off synthesized primary. All 116 ordered domain checks pass. HTTP regressions added for each case. | Independent review / domain unit |
| P2-9 | Test isolation / Medium | Six namespace-clearing HTTP checks failed only in the complete suite, while all nine passed in isolation. The profile fixture shared extension schema objects; earlier cases appended required definitions into later profiles. | Deep-clone the profile before customization. Each synthetic endpoint receives its own schema objects, not a mutated module singleton. | Combined HTTP / fixture isolation |
| P2-10 | Independent recheck / High | Nine new unit controls failed: retained list entries lost readOnly descendants, whole-entry synthesis skipped readOnly checks, appended complex children retained scalar cardinality, and manager shorthand misinterpreted a remove value. | Preserve readOnly state on retained identities, route synthesized entries through the ordinary value policy, construct new entries recursively, and restrict manager shorthand to add/replace normalization. All nine controls pass within 125 ordered tests; HTTP regressions cover each family and compatibility case. | Independent review / unit |
| P2-11 | Compatibility / Medium | Additional controls caught a strict-off quoted-Boolean primary handoff failure and a Group selected-member singleton-array validation regression. The former normalized only after execution; the latter validated the container rather than Group's compatibility-normalized selected element. | Move existing flag-controlled Boolean coercion before execution in both strict modes; validate Group's singleton wrapper against its selected element. No new product flag. | Focused HTTP and unit / focused unit |
| P2-12 | Retained identity / High | A third independent review showed that repeated `before.find` matched every duplicate or anonymous list entry to the first old record and copied its server value. Seven regression controls failed. | Shared one-to-one retained-entry matching consumes identities once, uses type to disambiguate duplicate values, and uses occurrence order for anonymous entries. Both immutable and readOnly paths use the same matcher. | Independent review / unit identity matrix |
| P2-13 | Operation-context loss / High | An outer-target append shortcut bypassed readOnly protection for add-null; a complex-parent add also copied old server values into newly appended nested children. Two controls failed. | ReadOnly policy now receives the operation through every recursive call, processes null before append, and distinguishes new from retained entries at each multi-valued boundary. | Independent review / operation-by-target matrix |
| P2-14 | Mutation-intent loss / High | Ignoring readOnly during nested add-null returned preserved fields as a bare array; the merge interpreted it as append input, duplicating server data. Two ignore-mode controls failed. | A private symbol-tagged unassignment result preserves replacement intent until the shared recursive merge consumes it. The tag never enters persisted or response JSON. All direct and enclosing-parent HTTP assertions check exact stored values. | Independent review / operation-by-target-by-policy matrix |
| P2-15 | Adapter normalization / Medium | Moving manager shorthand out of mutation exposed one expanded no-path form still bypassing normalization. One permanent control failed. | A resolved-value normalization hook handles direct and expanded paths alike, and only add/replace. Remove continues to ignore a stray manager value. | Focused unit / path-form matrix |
| P2-16 | Renderer/tooling / Low | VS Code diagnostic/test integration was unavailable. Mermaid first skipped because this worktree lacked web tooling; after a tooling-only junction it rendered nine diagrams in both themes. Renderer discovery reports built-in metadata `0.0.0` against the pinned gate's `11.15.0`. | Used the repository's actual build/Jest gates and headless render gate. Do not install a fictitious Mermaid `0.0.0`, change locks, or claim local VS Code preview version parity. The browser render proof remains valid for pinned `11.15.0`. | Tool invocation / environment discovery |
| P2-17 | Preservation-intent loss / High | Adding a writable sibling injected an omitted server-owned collection into append input, doubling it on each operation. Four permanent controls failed, including a standard simple multi-valued readOnly child. | Generalize the private replacement-state intent to every preserved readOnly projection, not only explicit null. Recursive merge consumes it without appending, including inside replacement-array entries. This closes the recurring sanitizer-value versus mutation-intent boundary. | Independent review / operation-by-target-by-policy matrix |
| P2-18 | Persistence adapter / Medium | Removing custom externalId correctly removed it from GET but retained the old promoted column. The HTTP column check failed for custom resources while User/Group passed. | Derive nullable generic query columns from the completed payload with case-insensitive reads; absent means null. No query algorithm or repository interface changed. Final HTTP matrix verifies column and payload together on both backends. | HTTP repository readback / service adapter unit |

Final evidence: 1,522 targeted unit tests, 201 HTTP tests per backend, and
170 built-live assertions per backend passed. All 22 migrations replayed on
owned PostgreSQL 17.8. All owned containers and runtime processes were
cleaned up. Six independent finding rounds produced 15 addressed findings;
the final bounded preservation-intent closure confirmed the last
reproduction and previous null/add controls. This does not certify C0.

## P9 flag-contract follow-up (2026-09-29)

| Issue | Type / severity | Confirmed symptom and cause | Fix and prevention | Detection / earliest |
| --- | --- | --- | --- | --- |
| P2-19 | Compatibility flag / High | P9 I03 found explicit User `name.familyName` with `VerbosePatchSupported=false` returned 200 and stored a literal key. P2 initially retained that legacy behavior, which the operator then explicitly authorized correcting. | Reject explicit non-selector core dotted User paths with 400 `invalidPath` when the capability is off. Keep no-path object, registered-extension and selector forms supported. No new flag or default change. Ordinary-running I03 tests assert payload/version rollback and no literal key. | P9 corpus / flag-by-path-form unit |
| P2-20 | Compatibility flag / High | The promoted active adapter unconditionally converted quoted booleans, even when `AllowAndCoerceBooleanStrings=false` and strict validation was off. Service prevalidation had hidden the bypass in strict mode. | Pass the effective flag into the User adapter. OFF rejects quoted active in direct, qualified, no-path and legacy-wrapper forms; ON retains recognized-string compatibility. Native booleans and string-typed extension homonyms are unchanged. Permanent tests cross strict/coercion/path-form axes. | P9 source review / adapter option matrix |
| P2-21 | Path-form distinction / Medium | The first shared executor applied User's literal-dotted mode to expanded no-path keys too, regressing P9 E17's previously working shape. | Remove literal-dotted mutation entirely; enforce the capability on explicit operation paths in the User normalization hook only. Expanded no-path keys continue through typed nested mutation. This follows the existing compatibility boundary rather than treating all dotted text as the same request shape. | Follow-up RED HTTP / path-form compatibility matrix |
| P2-22 | Namespace target policy / Medium | Independent review found the new User capability gate parsed an exact registered extension namespace ending in `1.0` as an attribute path and rejected add/replace/remove with verbose OFF. Three permanent domain controls failed. | Share `parsePatchTarget` between capability checking and execution. Exact case-insensitive registered namespaces resolve identically before the unchanged P1 grammar fallback. Three ordinary HTTP controls preserve previously working lenient namespace operations; broader strict namespace prevalidation stays with P7b. | Independent review / extension-target flag matrix |

Before production edits, follow-up tests produced **9 failed / 9 passed
domain checks** and **12 failed / 18 passed HTTP checks**. After corrections,
all initial 18 domain and 30 HTTP cases passed, within **1,540 targeted unit tests**.
The first unit attempt failed TypeScript compilation because the future flag
was passed as an excess literal property; it is excluded from the RED counts.
Three old tests expecting literal-key storage were changed intentionally to
assert indexed rejection and no write. I02, I03 and E17 coverage is ordinary
default-running HTTP/live coverage, not an environment-gated TODO.

Design disposition: **applied**. Capability and Boolean compatibility policy
stay in the existing User adapter/service seam; the shared executor no longer
contains a literal-dotted write branch. Repository interfaces and all generic
typed/MV attribute behavior are unchanged. P9's sibling corpus toggle must
also be removed by the integrating owner once the merged run passes.

Final follow-up evidence: **1,543 unit tests across 22 suites**, **234 HTTP
tests across 7 suites per backend**, and **246 built-live assertions per
backend** (P1 58, P2 188) passed on InMemory and actual PostgreSQL 17.8.
All 22 migrations replayed. Final independent closure found no directly
caused high-confidence issue in the bounded follow-up. Focused lint stayed
at 0 errors / 58 warnings; build passed. All owned runtimes and the exact
labeled container were removed.

## Prevention and architecture disposition

Applied: one domain mutation executor with schema-aware target tests shared
across all three resource adapters. Required/immutable failures are tested
before a later operation can repair them. Tests verify values and original
snapshots, not merely a success status.

Accepted: resource-specific adapters retain promoted User fields and Group
member policy. They are concrete existing responsibilities, not speculative
new abstractions. Repository interfaces and database transaction ownership
are unchanged.

## Provenance

This ledger is maintained at confirmed fix boundaries. Raw run artifacts are
under `test-results/p2/`. The available validation logs and tool results were
reconciled by failure class, distinguishing compiler/harness failures from
actual assertion RED. `VSCODE_TARGET_SESSION_LOG` is not available in this
session, and source scope is restricted to this worktree. A full external
transcript reconciliation therefore cannot be claimed. No database failures
or migration escapes occurred in any owned backend run.
