# Atomic uniqueness execution issues

**Last verified:** 2026-09-28

## Issue dashboard

| Issue | Type / severity | Detection / earliest possible | Resolution |
|---|---|---|---|
| U1 | Tooling / low | First unit command / first unit command | Jest absent in isolated worktree. Authorized read-only-use tooling and generated-client junctions restore exact existing tools; no install, regeneration or shared-source mutation. |
| U2 | Test typing / low | HTTP compile / static compile | Default `randomUUID()` inferred a template-literal type. Explicit `string` parameter permits human test names. Setup failure was not counted as behavioral RED. |
| U3 | Correctness / high | Competing HTTP writes / competing HTTP writes | Both backends returned two successes for different resources owning one declared unique value. Same-resource If-Match tests cannot expose this. Repository commit now checks typed ownership, synchronized by storage namespace. |
| U4 | Implementation / low | Build / build | A method insertion matched an inner closing brace. Build caught the syntax error; method moved to class scope. Nullable Prisma identity explicitly narrowed before use. |
| U5 | Boundary typing / medium | Real PostgreSQL HTTP / repository unit | Passing the generic create input as a structural scope also passed extra runtime keys to Prisma `where`. Select only endpointId/resourceType when building the predicate; TypeScript structural typing does not remove runtime fields. |
| U6 | Test contract / low | Targeted unit / targeted unit | Seventeen forwarding expectations lacked the new policy argument. Preserve existing argument checks and assert the promoted-name policy is actually passed. |
| U7 | Shape policy / medium | Focused unit / focused unit | Five added negative controls proved computed/promoted declarations and malformed parent objects could be ignored. Runtime policy compilation now refuses impossible declarations and evaluation refuses a scalar where a complex ancestor is required. P7 owns registration-time rejection. |
| U8 | Test harness / low | HTTP execution / test registration | Ambiguous patch context inserted new tests inside an assertion helper. All resulting failures were one registration cascade, not 52 product defects. Move the helper closing brace and rerun; use complete function boundaries for patches. |
| U9 | Representation / high | Independent review / pure policy unit | Case-aliased keys selected the first match; JSONB could reorder them and change ownership interpretation. Reject duplicate case-insensitive keys on every constrained path before writing. Both input orders have permanent unit/HTTP controls. |
| U10 | Namespace / high | Independent review / pure policy unit | A `:core:` substring classified a legal extension as core. Use explicit identity or the standard RFC core prefix only; HTTP fixture now intentionally uses `:core:` in its extension URN. |
| U11 | Repository boundary / medium | Independent review / repository unit | Retained `addMembers` did not take a policy. Its required policy argument now drives the same aggregate check and database lock; direct append failure leaves members untouched. |
| U12 | Compatibility / low | Neighbor repository units / neighbor repository units | Two sorting fixtures deliberately omit payloads. Eager uniqueness parsing ran even for an empty policy. Empty-policy InMemory calls now skip the new parser/scanner, matching Prisma and preserving unrelated behavior. |

## Why the fix works

U3 is not repaired by a second service precheck. PostgreSQL holds a transaction
advisory lock for the endpoint/resource-type namespace, reads current committed
candidates after acquiring it, checks typed scalar ownership and writes through
the same transaction client. InMemory performs check and staged publication
without an await. Failed Group candidates never publish member rows.

Prevention is the permanent `atomic-uniqueness.e2e-spec.ts` barrier suite:
two different resources enter the real repository method, one receives 409,
and storage contains exactly one owner with unchanged loser version.

U5 illustrates why PostgreSQL evidence is independent of InMemory evidence.
The InMemory green run did not validate Prisma's input shape. No migration or
existing-data rewrite is needed for a transaction-scoped protocol.

## Provenance and disposition

Final source run `postgres-51dc93647bdd3197`: 638 units; PostgreSQL 17.8
142 HTTP passed; InMemory 140 passed plus two justified database-only N/A.
Each backend executes 21 new live assertions plus 33 conditional and 69 Group
aggregate assertions. [Durable receipt](evidence/scim-uniqueness-20260928.json).
The final review finds no significant code issue; its pending unit gate was
subsequently rerun green (638/638).

The issue list was reconciled against the available execution outputs and
review reports for this worktree, separating missing-tool/setup/registration
cascades from product assertion failures. No full-session transcript path was
supplied in this worker environment (`VSCODE_TARGET_SESSION_LOG` is unset),
so this is not falsely labeled a full root-session transcript audit. Parent
consolidation retains that cross-worker reconciliation obligation.

Non-issues/limitations verified: three broken links in the older portion of
Session_starter are present on the unchanged base; changed links resolve.
The diagram runner rendered both diagrams in both themes but reports the
installed VS Code renderer version as `0.0.0`; no dependency was changed to
that unusable suggestion. Generated tooling/client junctions are for read-only
use only and are removed before handoff; no package generation was executed.

Behavioral RED: `postgres-2890528fbe4e0fe6`, 44 failures on each backend.
First GREEN iteration: InMemory 129 passed, one native-FK N/A; PostgreSQL 109
passed and 21 custom-resource failures due to U5. These are intermediate
results, not the final acceptance claim.

U5 confirmation: `postgres-7058463403ddb5c8`, PostgreSQL 130 passed,
InMemory 129 passed plus one native-FK N/A. U7 negative control:
`test-results/uniqueness/policy-red.json`, five failed, 25 passed.
Independent-review RED: `test-results/uniqueness/review-red.json`, four
failed, 29 passed. All three reviewer findings were reproduced before fixes.

Test/gate improvement: applied, different-owner barriers plus stored-state
assertions. Design disposition: applied, a shared typed policy and small
Prisma transaction wrapper replace service-level schema scans. No mutex,
policy language, migration or additional service dependency is introduced.
