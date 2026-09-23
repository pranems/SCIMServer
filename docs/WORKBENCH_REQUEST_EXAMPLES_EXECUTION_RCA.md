# Workbench Request Examples Execution Issues and RCA

> **Status:** In consolidation - **Last verified:** 2026-09-23 - **Product version:** `0.55.27`

## Dashboard

| ID | Type | Severity | Symptom | Detection | Resolution |
|---|---|---:|---|---|---|
| WB-1 | Test correctness | Low | A correct JSON body failed an assertion using an unsupported asymmetric `toHaveValue` matcher. | Focused Workbench integration test | Parse the textarea value and assert the exact property. |
| WB-2 | API contract | High | Header rows were editable and exportable but never sent by Workbench. | Change-scoped executor audit | Forward enabled rows; apply stored Authorization last; retain `ifMatch` override. |
| WB-3 | Test correctness | Low | Playwright looked for input values in container text content. | Browser outcome assertion plus screenshot | Assert the specific header key/value inputs. |
| WB-4 | Replay contract | High | Export, history, and live-test output omitted authentication/header state required by ready-to-run requests. | Final code review | Use a non-secret auth placeholder and preserve enabled headers across history/snippets. |
| WB-5 | Concurrency | High | Fixture read by name, whose response has no ETag, then normally wrote profile arrays unconditionally. | Final code review | Re-read by id, require ETag, and fail closed. |
| WB-6 | Schema correctness | Medium | PATCH generator could append `-updated` to canonical/dateTime values and create invalid payloads. | Final code review | Type-aware replacement strategy and canonical/dateTime tests. |
| WB-7 | Test data | Medium | Static unique create values could change as discovery queries resolved or collide across runs. | Final code review | Per-panel stable suffix and uniqueness-aware values. |
| WB-8 | Fixture safety | Medium | Post-write fixture checks did not prove unrelated profile data survived whole-array replacement. | Final code review | Pre/post canonical hashes for every non-owned section and definition. |
| WB-9 | Test harness | Medium | Disposable fixture proof failed before write when an optional profile section was null. | Local idempotency proof | Canonicalize null as literal JSON `null` before hashing. |
| WB-10 | PowerShell serialization | Medium | Singleton extension bindings serialized as objects, and profile validation rejected the non-array shape. | Local idempotency proof plus server causal stack | Force User/Group `schemaExtensions` assignments through array subexpressions. |
| WB-11 | Environment drift | Medium | Fresh worktree API build lacked the ignored generated Prisma client. | Local API build | Reuse the generated client artifact from merged master; no dependency resolution. |
| WB-12 | Environment drift | Low | Reused port 3000 had unknown OAuth credentials and port 6000 was occupied. | Live bootstrap/startup | Run exact v0.55.27 on free port 6001 with explicit test secrets. |
| WB-13 | Security | High | Shared `fetchWithAuth` let caller headers override or accompany the stored bearer, including lowercase and padded duplicates. | Final security review | Trim names, remove Authorization case-insensitively, and apply stored bearer last. |
| WB-14 | Fixture safety | Medium | Device merge keyed by id while verification keyed by name, so a same-name/different-id definition could be mutated before the ambiguity failed. | Final fixture review | Reject conflicting identity before PATCH and merge/verify the owned Device consistently by id. |
| WB-15 | API robustness | Medium | A whitespace-only caller header became an empty header name and could make browser `fetch` reject before Workbench produced an outcome. | Corrected-tip review | Trim first and discard empty names in the shared sanitizer. |
| WB-16 | Test correctness | Medium | Named dev apply published and preserved everything but exact owned-schema verification failed because equivalent objects had different property order. | Named dev fixture gate | Canonicalize object keys before hashing while preserving array order. |

## Issue Details

### WB-1 - Body Matcher Did Not Match DOM Semantics

- **Symptom:** The applied admin endpoint example visibly contained `profilePreset`, but `toHaveValue(expect.stringContaining(...))` failed.
- **Root cause:** The DOM matcher expects a concrete value rather than an asymmetric matcher.
- **Fix:** Parse the textarea JSON and assert `profilePreset === "rfc-standard"`.
- **Why it works:** The assertion now proves payload semantics instead of coupling to formatting.
- **Prevention:** JSON editor tests should parse valid JSON before checking fields.
- **Escape analysis:** Detected in the first focused GREEN attempt. Earliest gate was the same test. Escape delta: 0.

### WB-2 - Header Editor Was Cosmetic

- **Symptom:** A generated Device PATCH displayed `If-Match`, while `handleSend()` passed only method, path, and body to `useScimRequest`; the network request omitted every editable header.
- **Root cause:** Workbench export used the header model, but execution had a separate narrower request contract.
- **Fix:** Add `headers` to `ScimRequestArgs`, collect enabled non-empty rows in Workbench, remove every case variant of Authorization, and merge the remainder before the authenticated bearer and compatibility `ifMatch` override.
- **Why it works:** The same request draft is now exported and executed. Applying Authorization last prevents an editable row from replacing the authenticated admin session.
- **Prevention:** Mutation coverage asserts `If-Match` and `Prefer` reach fetch while stored Authorization wins. Integration and Playwright prove the generated ETag PATCH executes successfully.
- **Escape analysis:** Existing Workbench tests covered body transmission but no arbitrary header. The change-scoped executor audit found it before browser validation. Earliest capable gate was mutation unit. Escape delta: audit to unit.

### WB-3 - Input Values Are Not Container Text

- **Symptom:** Playwright timed out waiting for the headers grid to contain `If-Match`, while the screenshot showed the populated key and ETag inputs.
- **Root cause:** Input values live in the `value` property and are not text nodes.
- **Fix:** Assert `workbench-header-key-2` and `workbench-header-value-2` with `toHaveValue`.
- **Why it works:** The browser assertion reads the same state a user sees in each control.
- **Prevention:** Form-field browser tests assert values on controls, not ancestor text.
- **Escape analysis:** Detected in the first real-browser run. Earliest gate was Playwright because the failure was test/DOM semantics. Escape delta: 0.

### WB-4 - Executed, Exported, and Replayed Requests Diverged

- **Symptom:** Send injected the admin bearer but exports had no Authorization; history and generated live-test snippets dropped `If-Match` and every custom header.
- **Root cause:** Three consumers serialized different subsets of the editable draft.
- **Fix:** Exports include `Bearer <admin-token>` rather than a live secret; history stores/restores enabled headers; live-test snippets clone `$headers` and apply request-specific rows.
- **Why it works:** Every destination now carries the same non-secret request contract and ETag requirement.
- **Prevention:** Unit tests cover export placeholder, history round-trip, replay, and snippet `If-Match`; Playwright executes the real header path.
- **Escape analysis:** Found by final code review before PR. Earliest capable gate was serializer/history unit coverage. Escape delta: review to unit/browser.

### WB-5 - Fixture Concurrency Guard Was Normally Absent

- **Symptom:** The script advertised an ETag-protected PATCH but read by name; that route does not emit ETag.
- **Root cause:** Identity resolution and concurrency-token acquisition were assumed to be one operation although only the ID route sets the header.
- **Fix:** Resolve by name, verify canonical id, re-read by id, require a non-empty ETag, and always send `If-Match`.
- **Why it works:** The script cannot replace profile arrays from a stale or unversioned read.
- **Prevention:** Fixture parser plus source review; deployment execution must pass the script's fail-closed guard.
- **Escape analysis:** Found in final code review before any estate mutation. Earliest capable gate was source review because no live fixture write had occurred. Escape delta: 0.

### WB-6 - Generated PATCH Value Could Violate the Published Schema

- **Symptom:** Canonical string `Windows` would become `Windows-updated`; dateTime would lose RFC 3339 validity.
- **Root cause:** A generic string suffix ignored field type and canonical values.
- **Fix:** Cycle canonical values, toggle booleans, increment numeric values, advance valid dateTime, preserve valid binary/reference shapes, and omit PATCH when no safe replacement exists.
- **Why it works:** Every generated operation remains inside the selected field's declared value domain.
- **Prevention:** Pure tests lock canonical and dateTime replacements.
- **Escape analysis:** Found in final code review; earliest capable gate was pure builder unit. Escape delta: review to unit.

### WB-7 - Example Identity Was Unstable or Duplicate-Prone

- **Symptom:** Endpoint and unique schema examples used fixed identifiers, while rebuilding the template catalog during discovery could also change generated values unexpectedly.
- **Root cause:** No distinction existed between readable examples and values constrained by server/global uniqueness.
- **Fix:** Generate one suffix per mounted panel; apply it only to endpoint names and fields whose schema publishes uniqueness.
- **Why it works:** Values stay stable during one editing session and remain collision-resistant across sessions.
- **Prevention:** Pure tests inject a deterministic suffix and assert exact unique values.
- **Escape analysis:** Found in readiness review before shared-estate execution. Escape delta: 0.

### WB-8 - Fixture Preservation Check Covered Only New Data

- **Symptom:** The script verified Device and extension presence but not the profile data at risk from whole-array replacement.
- **Root cause:** Positive checks proved additions, not preservation.
- **Fix:** Hash settings, authentication, ServiceProviderConfig, every non-owned schema/type, User/Group definitions, and pre-existing extension bindings before and after the write.
- **Why it works:** Any unrelated drift fails the deployment-time operation explicitly.
- **Prevention:** Preservation hashes are mandatory post-write assertions in the fixture script.
- **Escape analysis:** Found in final code review before estate mutation. Escape delta: 0.

### WB-9 - Null Profile Section Broke Preservation Hashing

- **Symptom:** The first disposable fixture proof stopped before PATCH with `GetBytes` rejecting a null string; endpoint cleanup still passed.
- **Root cause:** PowerShell emitted no pipeline value for `$null | ConvertTo-Json`, leaving the hash input unset.
- **Fix:** Canonicalize a null value as the literal JSON text `null` before UTF-8 hashing.
- **Why it works:** Optional absent sections now have a stable comparable representation.
- **Prevention:** The fixture is executed twice against a disposable local endpoint before dev use, with all preservation checks and cleanup required.
- **Escape analysis:** Detected in local pre-deployment fixture proof before any shared-estate mutation. Escape delta: 0.

### WB-10 - Singleton Binding Lost Array Cardinality

- **Symptom:** The ETag-protected profile PATCH returned 500; the server causal stack showed `rt.schemaExtensions is not iterable`.
- **Root cause:** PowerShell automatically unwrapped a function's single output object during property assignment, so JSON contained an object instead of a one-element array.
- **Fix:** Wrap both merge calls in array subexpressions before assigning `schemaExtensions`.
- **Why it works:** JSON cardinality now matches the profile contract for zero, one, or several bindings.
- **Prevention:** The disposable script proof applies and verifies the fixture twice, so first-run and idempotent one-binding shapes are both exercised.
- **Escape analysis:** Found locally before shared-estate use; the server stack identified the first causal frame. Escape delta: 0.

### WB-11 - Generated Prisma Client Missing in Fresh Worktree

- **Symptom:** API TypeScript build reported every Prisma delegate missing from `PrismaService`.
- **Root cause:** The generated client is ignored and therefore absent from a new linked worktree even when `node_modules` is shared.
- **Fix:** Link the existing generated client from merged master and rebuild; no npm install or lockfile generation occurred.
- **Why it works:** The worktree compiles against the same generated schema artifact as its exact base commit.
- **Prevention:** Fresh-worktree API setup verifies both dependencies and `api/src/generated`.
- **Escape analysis:** Detected at local API build before runtime. Escape delta: 0.

### WB-12 - Existing Local Processes Were Not Deterministic

- **Symptom:** Port 3000 rejected the documented OAuth secret, and the first attempted exact process could not bind port 6000.
- **Root cause:** Both ports belonged to pre-existing local processes with independent environment state.
- **Fix:** Leave unrelated processes untouched; start the exact v0.55.27 branch on free port 6001 with explicit SCIM and OAuth secrets.
- **Why it works:** Served version and credentials are controlled by the validation command.
- **Prevention:** Inspect listeners and command lines before startup; select a free port rather than terminating unrelated processes.
- **Escape analysis:** Detected during live bootstrap, before assertions against the exact branch. Escape delta: 0.

### WB-13 - Shared Authenticated Fetch Allowed Bearer Override

- **Symptom:** Exact, lowercase, and whitespace-padded Authorization caller headers could replace or coexist with the stored admin bearer.
- **Root cause:** `fetchWithAuth` and `useScimRequest` had separate header filters; both initially treated caller names as object keys, and Workbench's filter did not trim names.
- **Fix:** Route both authenticated request paths through one sanitizer that trims and normalizes names, removes every Authorization variant, canonicalizes Content-Type, and applies the stored bearer last.
- **Why it works:** Fetch receives one authenticated Authorization value owned by the session.
- **Prevention:** Base-fetch and Workbench mutation coverage attempt exact, lowercase, and padded override forms and assert exactly one normalized Authorization header reaches fetch.
- **Escape analysis:** Found by final security review before PR. Earliest capable gate was the base fetch unit suite. Escape delta: review to unit.

### WB-14 - Fixture Device Identity Was Inconsistent

- **Symptom:** Merge replaced ResourceTypes by id, while preservation and convergence checks identified Device by name.
- **Root cause:** The owned ResourceType had no explicit preflight identity invariant. A pre-existing `name: Device` with another id would survive the merge, gain a second Device entry, and fail only after PATCH.
- **Fix:** Reject same-name/different-id and same-id/different-name conflicts before mutation, then verify the owned type and public discovery by its canonical id.
- **Why it works:** Ambiguous ownership cannot reach the whole-array replacement, while a canonical rerun still replaces one Device definition and preserves unrelated types.
- **Prevention:** `-SelfTest` proves canonical replacement, unrelated preservation, exact convergence, and both name-to-id and id-to-name conflict rejection without requiring a live estate.
- **Escape analysis:** Found in final fixture review before dev execution. Earliest capable gate was a pure fixture merge self-test, now added. Escape delta: review to self-test.

### WB-15 - Blank Header Names Escaped the Shared Boundary

- **Symptom:** A direct caller could pass a whitespace-only header name that normalized to `""` and reached `fetch`.
- **Root cause:** The shared sanitizer trimmed names only while filtering Authorization and canonicalizing Content-Type; it never rejected an empty normalized name.
- **Fix:** Normalize each entry first, discard zero-length names, then apply protected-header filtering and canonicalization.
- **Why it works:** Both authenticated request paths now pass only valid non-empty names to browser `fetch` while preserving valid custom headers.
- **Prevention:** Base-fetch and Workbench mutation tests inject whitespace-only plus valid custom headers, proving the blank entry is removed without dropping the valid one.
- **Escape analysis:** Found by corrected-tip review after the first PR push. Earliest capable gate was the shared sanitizer unit suite. Escape delta: review to unit.

### WB-16 - Semantic Equality Depended on JSON Property Order

- **Symptom:** The named dev apply published Device plus both extensions and passed every non-owned preservation assertion, then failed `owned schemas converged`.
- **Root cause:** Expected definitions were ordered hashtables while the admin GET returned PSCustomObjects in server property order. `Get-ValueHash` hashed raw serialized order, so equivalent JSON objects produced different digests.
- **Fix:** Parse the JSON and recursively write canonical object keys before SHA-256 hashing; preserve array order and scalar representation.
- **Why it works:** Object member order is not semantically significant, while schema and attribute array order remains part of the compared contract.
- **Prevention:** Fixture `-SelfTest` constructs nested equivalent objects in opposite property order. The named dev apply and immediate rerun both pass 17/17 assertions after the fix.
- **Escape analysis:** The first shared-estate execution caught the false negative after mutation. The earliest capable gate was the pure hash self-test, now added. Escape delta: named dev to self-test.

## Self-Improvement Dispositions

- **Test/gate:** Applied. Workbench mutation coverage proves arbitrary header transmission, browser coverage proves a generated ETag PATCH persists a real value, and fixture `-SelfTest` proves identity-safe idempotent merge behavior.
- **Design/architecture:** Accepted. One pure template module plus one discovery panel keeps request algebra separate from the existing executor. A registry abstraction beyond the current four categories would be speculative.
- **Security:** Applied. Editable Authorization cannot override the stored authenticated bearer.
- **Performance:** Accepted. Discovery uses existing five-minute caches and fetches only one existing resource for PATCH generation.
- **Final test/gate disposition:** Applied. The live property-order false negative produced WB-16 plus a pure canonical-hash regression test; full post-fixture live and Playwright gates are green.
- **Final design/architecture disposition:** Accepted. Canonical JSON belongs inside the existing fixture verifier; extracting a separate module for one script and one caller would be speculative.

## Provenance and Completeness

Issues were recorded as their fixes were confirmed and reconciled against the full unit-3 interval of the session transcript. The direct scan began at the `feat/workbench-templates-v0.55.27` marker and used error/signal plus diagnosis-phrase passes. Expected missing-module RED failures, matcher-only failures, repeated command output, the known Mermaid built-in `0.0.0` metadata warning, repository TypeScript baseline errors outside changed files, and an unrelated older-auth review response were inspected and dismissed. Every diagnosed unit-3 issue maps to WB-1 through WB-16.
