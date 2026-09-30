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
| U13 | Standards interpretation / high | P7 sibling feedback after local commit / RFC type-table design review | Initial P3b implemented boolean/dateTime/binary equality despite RFC 7643 sections 2.3.2/5/6 saying these types have no uniqueness, and treated reference as default case-insensitive despite section 2.3.7. Five RED unit controls now require fail-closed inconsistent declarations and intrinsic exact reference equality. Correct in a normal follow-up commit; P7 owns admission rejection. |
| U14 | Representation completeness / medium | P7 adapter inventory / initial adapter inventory | Builtin Group members discard all additional child fields, not only `$ref`; treating other declared leaves as absent silently ignored a promise. Three RED controls exposed extra child skips and an overbroad builtin-URN suffix check. Require the exact represented Group relation leaves and full builtin URN identity; preserve extension/custom-core member paths. |
| U15 | Representation authority / high | P7 response-source correction / initial response-contract inventory | Generic response emits rawPayload, not promoted convenience columns. Initial P3b wrongly imposed builtin displayName/active shapes on custom cores and overlaid their valid values with null/Boolean columns. Three unit and seven HTTP RED controls per backend prove the regression. Generic repositories now explicitly compare rawPayload plus authoritative id; generic immutable reconstruction also matches response. |
| U16 | Compatibility boundary / medium | Parent integration decision / accepted custom-schema inventory | The U15 fix still constrained generic custom externalId by the builtin/common string assumption. Parent confirmed the accepted rawPayload schema contract must be preserved, with query pushdown checked separately by C0/P6. Two unit/seven HTTP RED cases per backend now require numeric/MV externalId preservation and competing ownership; builtin User/Group string constraints remain. |
| U17 | Standards precedence / high | Parent RFC section 3.1 correction / initial common-attribute analysis | U16's parent-approved compatibility decision was wrong: common externalId is a String with caseExact true across all extended types, and common characteristics override older schema declarations. Restore that policy for declared uniqueness, move arbitrary numeric/MV homonym tests to extension namespace, and leave P7 responsible for admission/general runtime gaps. |

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

Initial source run `postgres-51dc93647bdd3197`: 638 units; PostgreSQL 17.8
142 HTTP passed; InMemory 140 passed plus two justified database-only N/A.
Each backend executes 21 new live assertions plus 33 conditional and 69 Group
aggregate assertions. [Durable receipt](evidence/scim-uniqueness-20260928.json).
The final review finds no significant code issue; its pending unit gate was
subsequently rerun green (638/638).

U13 confirmed fix: `postgres-85aea7a5dee16b2d`, 640 units, PostgreSQL 17.8
144 HTTP passed and InMemory 142 plus two N/A. All live assertions and
22 migrations passed again. Policy lint 0 errors/0 warnings; independent
narrow review has no significant finding. [RFC follow-up receipt](evidence/scim-uniqueness-rfc-20260929.json).
The fix removes invalid promises rather than inventing behavior contrary to
the scalar type definitions. Prevention: include type-specific characteristic
applicability in the policy design table before writing equality tests.

U14 confirmed fix: `postgres-2321df0d53ff0f52`, 646 units, PostgreSQL 147
HTTP and InMemory 145 plus two N/A. All live assertions and 22 migrations
pass, build and changed-policy lint pass, narrow independent review reports
no significant issue. [Adapter follow-up receipt](evidence/scim-uniqueness-members-20260929.json).
The fix is path/namespace-specific, not a blanket rejection of readOnly or
same-named extension attributes. Prevention: enumerate the actual adapter's
round-tripped leaf allowlist, not only one known dropped field.

U15 confirmed fix: `postgres-72052466392b3008`, 648 units, PostgreSQL 158
HTTP and InMemory 156 plus two N/A, all live assertions and 22 migrations.
Changed-source lint remains 0 errors / 26 warnings, build passes, narrow
review reports no significant issue. [Custom authority receipt](evidence/scim-uniqueness-custom-20260929.json).
The correction preserves accepted custom numeric/MV displayName and numeric
active/userName rather than treating convenience columns as public schema
limits. A typed options object keeps the shared transaction helper explicit
instead of adding another positional Boolean. Prevention: derive representation
authority from the response and mutation reconstruction, not column names.

U16 confirmed fix: `postgres-806b7a07a49c9a38`, 651 units, PostgreSQL 167
HTTP and InMemory 165 plus two N/A, all live assertions and 22 migrations.
Explicit GETs before and after PUT/PATCH prove public raw values survive
round trips for both custom names. Build, policy lint 0/0 and independent
review pass. [Final compatibility receipt](evidence/scim-uniqueness-externalid-20260929.json).
Query filtering/sorting probes are assigned to C0/P6, not duplicated here.
**U16's top-level externalId interpretation is superseded by U17**, not a
current product capability claim. Its evidence remains historical.

U17 confirmed correction: `postgres-0bd156a6ad977c92`, 654 units, PostgreSQL
170 HTTP and InMemory 168 plus two N/A, all live assertions and 22 migrations.
Three RED controls prove common type/cardinality and caseExact precedence
before implementation. Build, policy lint 0/0 and independent review pass.
[Final common-attribute receipt](evidence/scim-uniqueness-common-20260929.json).
Prevention: distinguish ordinary custom-core attributes from common attributes
whose RFC characteristics take precedence, and never elevate permissive
current admission behavior into proof of standards validity.

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
