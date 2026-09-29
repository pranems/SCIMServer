# P7a execution issues

**Last verified:** 2026-09-28

Scope: declaration validation, scalar/cardinality checks and POST/PUT.
Ordered PATCH and cross-package integration remain separate.

| Issue | Type / severity | Symptom and cause | Confirmed resolution and prevention | Detection |
| --- | --- | --- | --- | --- |
| Unknown declarations became valid profiles | Correctness / high | Expansion accepted truthy strings, unknown keywords and non-array containers. The value validator skipped unknown types. | Existing profile pipeline now checks raw and expanded declarations; permanent unit cases went RED then GREEN. Defaults remain omissions, not forced values. | Unit; earliest unit |
| Scalar checks only checked strings or formatting | Correctness / medium | Calendar-invalid dates, invalid URI/base64 strings and non-finite decimals passed. Children bypassed cardinality validation. | SchemaValidator delegates scalar format checks to pure predicates and children to its existing attribute validator. 60 focused tests pass after 45 actual baseline failures. | Unit; earliest unit |
| Test fixture cast failed compilation | Test correctness / low | Synthetic deliberately malformed profile was asserted directly as a typed profile with missing RT description. | Cast through unknown at the test boundary; actual assertion RED recorded afterwards, not counted as a product failure. | TypeScript; earliest TypeScript |
| Isolated worktree lacks tools/generated client | Environment / low | Jest was missing; then missing worktree Prisma output made PrismaService appear to lack model members. | An owned api node_modules junction restores read-only tool access; Prisma generate writes only local api/src/generated/prisma. No install or shared-target modification. | Tool launch / compilation; earliest same |
| VS Code tool bridge unavailable | Tooling / low | runTests, problems and containerToolsConfig returned execution failures. | Existing CLI runners are used with local logs; no new tooling dependencies. Container command source is the existing guarded harness. | Tool launch; earliest same |
| Optional DTO properties looked like input | Framework / medium | Strict User/Group profiles omitting active/members failed on fields class-transformer materialized as undefined, although JSON did not contain them. | Skip undefined keys only; retain validation of supplied unknown values. One dedicated RED then GREEN unit test and strict U/G HTTP controls. | HTTP; earliest unit (now added) |
| Omitted immutable fields vanished on PUT | Correctness / high | Partial immutable comparison allowed omission, then persistence replaced the payload. | Prepare the actual PUT candidate from stored state before existing checks; only omitted non-required immutable and readOnly state is retained. HTTP verifies exact retained core/extension values and unchanged version on rejection. | HTTP; earliest unit (added during consolidation) |
| Required extension binding was never evaluated | Correctness / high | Payload schema lookup knew only URNs supplied by the client. A required ResourceType binding was invisible. | Relevant schema definitions and caches now carry binding requiredness. Both strict modes enforce it before persistence. | HTTP; earliest domain integration |
| returned:request treated writes like GET | Correctness / medium | POST/PUT discarded a supplied request-only attribute. The projection also flattened extension characteristic names onto core names. | Controllers snapshot supplied input; one namespace-aware projection walker respects implicit write requests and exact parent context. Two regression tests went RED before correction. | HTTP and controller; earliest controller |
| Existing tests codified defects | Test correctness / high | Sixteen assertions required ignored readOnly input to fail, invalid scalar data to pass, canonical suggestions to be closed enums, or an extension to inherit unrelated core projection rules. | Updated only affected expectations to normative outcomes; valid controls retained. A green baseline cannot substitute for the RFC contract. | Focused regression; earliest standards review |
| Explicit parent clearing bypassed immutable children | Correctness / high | The comparator visited children only when both old and incoming parents were objects; null escaped. | Added replace mode to the existing comparator, leaving PATCH default unchanged. Six HTTP tests went RED then GREEN across resources/strict modes. | HTTP; earliest unit |
| DateTime and URI valid/invalid boundary | Correctness / medium | Regex-only dates rejected valid timezone-less xsd:dateTime; WHATWG URL accepted unescaped path brackets and malformed relative first segments. | Calendar grammar permits optional timezone; RFC URI component checks run before URL authority validation. Three RED scalar controls captured, valid controls retained. | Unit; earliest unit |
| Review: undefined DTO fields broke preservation and projection | Correctness / medium | An existing key with undefined was treated as explicit input. Omitted immutable Group member fields failed PUT; absent request-only attributes appeared in responses. | Presence now means a defined value, not merely a key. Two permanent unit REDs then GREEN; false, zero and empty string remain explicitly supplied. | Independent review; earliest DTO-aware unit |
| Review: normalizers rewrote retained readOnly state | Correctness / medium | PUT restored server-owned values before primary normalization. A profile tightening could mutate or reject unrelated stored readOnly data. | Normalize client-writable input first, then restore readOnly/omitted immutable state. Six HTTP REDs then GREEN, with normalize and reject policies tested. | Independent review; earliest policy-combination HTTP |
| Renderer tooling and version discovery | Environment / low | Isolated docs run skipped for missing web tools; restored renderer reports built-in version 0.0.0 while pinned Mermaid is 11.15.0. | Owned root/web dependency junctions restored existing tools; real Chromium renders the new diagram in both strict themes. No package repin to invalid 0.0.0. Version discovery warning is retained as an environment limitation. | Renderer; earliest renderer |
| Lint warning ratchet | Static analysis / low | Initial focused lint had 65 warnings against a measured 62-warning base: three unnecessary type assertions. | Removed only those assertions; final lint is 0 errors/62 warnings and rebuilt JavaScript hashes match the backend-validated runtime byte-for-byte. | Focused lint; earliest focused lint |

## Design disposition

### Recursive readOnly follow-up to 8e42f15f

| Issue | Type / severity | Confirmed mechanism and fix | Prevention / detection |
| --- | --- | --- | --- |
| Nested readOnly values survived POST/PUT | Correctness / high | The cache already stored deep parent paths but stripping looked up the whole dotted path as one payload key; the fallback collector stopped after one child level. The collector now recurses, and one segment-aware walker resolves real objects/arrays before stripping. | Ten unit REDs and six HTTP REDs; 1,517 focused unit tests and 12 focused HTTP tests GREEN. Matrix covers cached/fallback, objects/arrays, cores/extensions, case-insensitive names and literal dotted keys. |
| HTTP tests initially registered inside an existing test callback | Test harness / low | The first filtered invocation discovered only 55 old tests and skipped them all. Moved the new tests into the describe block before trusting the gate. | No skipped run counted as RED/GREEN. Discovery now finds 67 tests, including all 12 new cases. |
| Shared fixture objects hid warning-path assertions | Test correctness / medium | In the object/object matrix cell the core and extension referenced the same object, unlike JSON input. Stripping the core mutated the extension fixture before its turn. | Clone every fixture branch, including expected unrelated namespace data; assert exact preserved values and warning counts independently. |
| Fallback collector recursed under an already readOnly parent | Regression / low | The first refactor collected redundant child metadata, changing an existing collector contract. | Stop fallback collection below wholly stripped readOnly parents, retaining the old contract without losing deep writable-parent coverage. Existing regression suite stays unchanged and GREEN. |

The follow-up's guarded run passed 67 HTTP tests and 228 live assertions per
backend on PostgreSQL 17.8 (22 migrations) and InMemory. The exact container
was removed and both runtime PIDs stopped. The two changed production files
were self-reviewed against cached/fallback metadata contracts and the new
object/array/literal-key cases; no open finding remains.

Follow-up reconciliation used all visible turns and retained RED/GREEN,
compile, lint, safety, and backend artifacts. The skipped first HTTP selector
is expressly excluded as evidence. Full parent-transcript reconciliation
remains with the integration session because its transcript path is not
available here. The existing Mermaid 0.0.0 discovery warning recurred and was
not “fixed” by an invalid dependency repin.

Applied: declaration structure checks stay inside the existing profile pipeline;
scalar formats stay pure and shared by SchemaValidator. No second payload
validation engine, repository abstraction, or new profile policy is introduced.

## Completeness

Updated at confirmed fixes and reconciled against all visible turns and
retained command artifacts for this delegated worktree: baseline RED,
compile/tool failures, HTTP assertion failures, focused regression deltas,
independent review, and both guarded backend/live runs. The final run passed
55 HTTP tests and 156 live assertions per backend with 22 migrations replayed.
The exact owned container was removed and both runtime processes stopped.

No `VSCODE_TARGET_SESSION_LOG` path is available in this subprocess. A
full parent-transcript reconciliation is therefore still a parent integration
item; this ledger does not claim an unavailable full-transcript scan.
Expected baseline REDs, deliberately invalid safety-control inputs, and
intentional canonical/readOnly expectation changes are not infrastructure
failures. One failed patch-context match changed no files and was corrected
with exact, separate table-row hunks.

Final independent review disposition: all three reported bugs reproduced
with permanent tests and fixed before the final owned backend/live run.
No review finding remains open. The separate P7b scope is listed in the
[implementation record](SCIM_P7A_PROFILE_VALIDATION.md), not hidden as a pass.
