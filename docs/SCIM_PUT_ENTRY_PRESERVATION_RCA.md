# PUT entry preservation: execution issues

**Last verified:** 2026-09-29

Source: committed combined snapshot `5581e6b73d8ba9fd206ddf92fa303c96c90ba610`.
Scope excludes common-attribute PATCH, admission/query and P3b.

| Issue | Type / severity | Symptom and root cause | Fix and why it works | Earliest / actual detection; prevention |
| --- | --- | --- | --- | --- |
| Duplicate state copied twice | Correctness / high | PUT used `find(value)` per candidate; both reordered duplicate values inherited work-owned state. Immutable comparison used a last-value-wins map and skipped anonymous/nested entries. | Neutral domain matcher consumes each stored entry once. PUT preparation, immutable comparison and PATCH share it; immutable comparison recurses into matched children. First focused GREEN: 86 tests. | Unit / P7 integration report; permanent duplicate, anonymous and nested outcome tests. |
| Omitted type stole a later exact match | Correctness / high | P2's greedy occurrence fallback consumed an entry that a later explicit type identified. | Reserve exact typed occurrences before assigning remaining occurrences. Both flows use the same matcher; no persistence/repository changes. | Unit / new cross-flow matrix; omitted/unknown-type-before-exact negative controls. |
| Initial PATCH expectations ignored normalization | Test correctness / low | Four RED assertions expected original key casing or expected null to remain a discriminator after PATCH unassignment. | Assert canonical keys. When removing null loses distinguishing information and conflicts with immutable state, assert rejection and unchanged executor state, not invented identity. These four are fixture/policy corrections, not product fixes. | Fixture review / focused GREEN iteration; distinguish 48 product REDs from four expectation errors in the initial 52 failures. |
| Isolated tools unavailable | Environment / low | VS Code runTests/problems bridge failed; npm test could not find Jest. | Only after the observed missing-dependency failure, create an owned API node_modules junction to existing installed tools. No installation or lockfile edit. | Tool launch / same; remove the owned link after final evidence. |
| Review: restored discriminator changed pairing | Correctness / high | Optional immutable `type` restored during PUT turned omitted/exact duplicates into equal typed entries. Recomparison changed `[B,A]` to `[A,B]` and falsely rejected a valid PUT. | Exact reservations now reserve type capacity, not identity inside indistinguishable typed occurrences. Redistributing selected equal-typed entries in candidate occurrence order is stable after restoration. Sixteen new REDs became GREEN; focused total 104, all six expanded HTTP cases pass. | Unit / independent review; permanent readOnly/immutable discriminator restoration and partial duplicate controls. |
| Review: restored null type gained priority | Correctness / high | Stored null/absent/null immutable types and a first assignment to work were valid, but restoring null gave the last entry exact-match priority and swapped the first two fixed values. | Treat null and absent **types** consistently as unassigned without changing their payload representation or merging null/missing **value** buckets. Two REDs become GREEN; final focused total 107 includes exhaustive valid restoration through length three. A standalone length-four check passes 187,018 valid immutable/readOnly combinations. | Unit / bounded review closure; null/absent first-assignment HTTP scenario and the combinatorial unit gate. |
| Overbroad restoration property | Test correctness / low | Initial exhaustive check also demanded pairing stability for inputs that explicitly changed an already assigned immutable type. | Restrict the stability property to semantically valid immutable assignments; readOnly restoration remains unrestricted. Required/immutable rejection tests continue to assert full atomicity. | Property test / same; distinguish valid-preservation and invalid-write obligations. |
| Generated client absent | Environment / low | HTTP harness could not compile PrismaService model access. | Run existing Prisma generate into this worktree's ignored generated directory with an inert URL; no database was accessed. | Compile / same; separate generation from dependency reuse. |
| Cross-realm object comparison | Harness / low | Node assert reported no visible difference between Jest HTTP objects and corpus-created expected objects. | Compare JSON round-trips in the wire corpus. This removes realm-specific prototypes, not response fields or values. | HTTP / first smoke; use the actual serialized contract as the comparison boundary. |
| Existing strict readOnly expectations disagree with P7 | Baseline / medium | Eight assertions in extension-flags-validation expected POST/PUT rejection rather than P7's ignore behavior. | Exact committed-base transformer reproduces all eight failures (68 controls pass). They are not changed or claimed fixed by this package. | Regression / same; retain baseline proof and expose the consolidation blocker. |
| Container config bridge unavailable | Tooling / low | containerToolsConfig failed. | Reuse the checked-in guarded Docker CLI runner, adding only this worktree/branch/base dispatch. Existing historical source guards remain intact. | Tool launch / same; real container identity, loopback URL and ownership row remain mandatory. |
| Isolated documentation tools absent | Environment / low | Renderer first skipped for missing Playwright, then for missing Mermaid; installed editor metadata reports Mermaid 0.0.0. | After each missing-tool observation, use an owned web/root dependency junction. Pinned 11.15.0 renders all 17 touched-document diagrams in both strict themes. Do not install or repin a fictitious 0.0.0. | Renderer / same; skipped probes are not counted as render evidence. |

## Self-improvement and architecture

Applied: test identity assignment as a complete permutation, not merely
attribute presence. Include mixed omitted/exact types and unchanged-state
assertions after rejection. Accepted: one small dependency-free domain helper
serves two real flows; no policy DSL or repository abstraction is warranted.
PATCH append intent remains in PATCH, never in PUT.

## Provenance

Written at the first confirmed 86-test GREEN and updated at each confirmed
review correction. Every task-owned full execution log was checked for failed
assertions, compile/runtime errors, missing tools and discarded controls, then
reconciled against this ledger. `VSCODE_TARGET_SESSION_LOG` is unset; a full
conversation transcript is not available inside the permitted worktree.
This is log-and-current-conversation reconciliation, not a false claim of
full-transcript reconciliation. Expected rejection logs and unchanged
baseline test failures are classified separately from harness failures.
Final source/backend/build/cleanup proof is in the
[sanitized receipt](evidence/scim-put-preservation-20260929/validation.json).
Read-only reviews found the two discriminator-restoration cases above;
both have permanent unit and HTTP controls. No independent approval of
unrelated C0 acceptance work is implied.
Final cleanup independently verified all three run containers absent, all six
recorded runtime PIDs absent, no database marker, and all three owned dependency
junctions removed with the original installed-tooling targets intact.
