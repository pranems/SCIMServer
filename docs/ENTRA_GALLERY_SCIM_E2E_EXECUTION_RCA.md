# Entra Gallery to SCIMServer E2E - Execution Issues and RCA

> **Status:** Active execution ledger - **Last verified:** 2026-10-14 - **Product version:** `0.55.48`

## Purpose and scope

This ledger records issues found while building and running the owned Microsoft Entra gallery provisioning gate against the registry-resolved SCIMServer dev estate. Entries are written when the failing check is understood and the corrective check turns green. The measured disposition includes final evidence counts and exact-cleanup outcomes.

**Provenance:** reconciled against the detailed pre-compaction execution
checkpoint supplied to this continuation and every command, failure, diagnosis,
and rerun in the current continuation. `VSCODE_TARGET_SESSION_LOG` was not
available, so the original pre-compaction JSONL transcript could not be
independently rescanned. Verified non-issues include the unchanged production
WIF job, the unchanged pre-existing federated credential after the temporary
hypothesis was removed, and zero retained owned jobs or endpoints after the
final runs.

## Dashboard

| ID | Type | Severity | Symptom | Root cause | Resolution and why it works | Prevention | Detection stage |
|---|---|---|---|---|---|---|---|
| EG-I01 | Harness / Graph metadata | Medium | The gate found zero usable provisioning roles even though the gallery application visibly had enabled roles. | This application stores the role names in `appRole.displayName`; `appRole.value` is empty. The first lookup assumed the value field was authoritative. | Resolve the enabled `msiam_access` and `User` roles by display name and assign both to owned fixtures. This removes entitlement ambiguity and follows the tenant's measured metadata. | The live plan-only gate must resolve at least one enabled assignment role before creating fixtures. | Plan-only intake, earliest possible stage. |
| EG-I02 | Test correctness | High | An unused gallery application was reported as having one pre-existing synchronization job; re-review later found the same nullable-wrapper shape in WIF reference reads. | PowerShell `@($null).Count` is one. Wrapping a nullable response property directly creates a one-item array even when the remote collection is empty. | Every Graph and SCIM collection response now flows through a non-null pipeline before array materialization. Ownership distinguishes zero from one, and missing WIF references cannot pass as one. | The contract forbids direct `@((Invoke-Graph...).value)` and `@((Invoke-ScimAdmin...).endpoints)` patterns. Live plan-only proof exercises the current empty gallery-job case. | Plan-only intake and pre-commit re-review; false blocker and false-green prerequisite, no mutation escaped. |
| EG-I03 | Tooling / authentication | High | Microsoft Graph calls returned 401 even though the same delegated token worked in a direct probe. | Authorization assignments written through the editing channel were sanitized into a literal mask. The generated script therefore sent the mask instead of the token. | Construct bearer headers at runtime with string concatenation in one helper. Source contains no token and no mask. | Static contract plus a literal-mask count of zero; plan-only live Graph read is mandatory before mutations. | Plan-only intake, earliest live authentication check. |
| EG-I04 | Graph validation | Medium | Source User creation returned `Invalid value specified for property 'employeeId'`. | The run ID exceeded the accepted employee ID shape used by this tenant. Historical working fixtures use an eight-character value. | Use the final eight hexadecimal characters of the run ID. This retains per-run correlation within the accepted field shape. | Source-fixture creation remains before any provisioning call and exposes Graph's exact error code. | Source fixture creation, earliest possible stage. |
| EG-I05 | Graph query semantics | Medium | Assignment-convergence polling first rejected a quoted GUID and then rejected the service-principal `appRoleAssignedTo` filter. | `principalId` is `Edm.Guid`, not a string, and that navigation collection does not support the attempted entitlement filter. | Read the created principal's own `appRoleAssignments` collection and match `resourceId` locally. This uses a supported relationship and preserves exact target ownership. | The harness waits for the assignment to become readable before calling `provisionOnDemand`. | Source assignment, before provisioning. |
| EG-I06 | Connector mapping / profile compatibility | High | Entra reached SCIMServer with accepted endpoint-bearer authentication, but User POST returned SCIM 400 because required `emails` was missing. | The `entra-id` endpoint profile requires email. The stock gallery mapping sources work email from Entra `mail`, which is empty for the unlicensed owned test User. | On the owned synchronization job only, map `userPrincipalName` to `emails[type eq \"work\"].value`. This preserves strict target validation and supplies a stable unique email without licensing the fixture. | The gate verifies the exact User and Group rule, applies the owned mapping, and confirms the SCIM User is created. Never weaken `StrictSchemaValidation` to make the test pass. | First connector export. The RequestLog diagnostics identified `attributePaths=[emails]`. |
| EG-I07 | Framework behavior | Medium | `provisionOnDemand` exported User and Group attribute changes but repeatedly skipped membership-only and some assignment-scope changes. | The on-demand API evaluates the object but can return `EntrySynchronizationSkip` for relationship or scope-only deltas. It is not equivalent to a scheduled delta cycle for every connector change type. | Use on-demand export first. When no successful Export step exists, start one owned scheduled cycle, poll the exact SCIM outcome, and pause the job immediately. This preserves token efficiency while covering the real relationship path. | Reports state which path performed each change. Any silent skip is a gate failure. | Membership addition, after direct User and Group CRUD were already green. |
| EG-I08 | Security / diagnostic hygiene | High | A diagnostic connection-info read returned a retained dev OAuth client secret because that endpoint is configured for secret visibility. | The diagnostic queried and printed the full response instead of projecting only the required WIF fields. The API behaved as configured. | Rotate the exposed dev OAuth credential by exact ID. HTTP 201 created a new active credential and deactivated the old one; safe metadata confirmed both states. | Never serialize a full connection-info response in diagnostics. Project field names and explicitly safe WIF identifiers only. The reusable gate never calls connection-info and persists only secret key names. | Manual WIF diagnosis. The credential was rotated immediately in the same execution. |
| EG-I09 | Entra WIF connector behavior | High | The owned gallery job accepted the readable WIF settings but later quarantined with `SystemForCrossDomainIdentityManagementCredentialValidationFailure` because `EntraApplicationIdentifier` was missing. Supplying the reviewed resource application client ID or identifier URI through Microsoft Graph beta returned `RequestParameterInvalid` for `value`. | The public synchronization-secret response omits this required field. The same public Graph configure action accepts the readable reference settings without it but rejects the missing field when added. This is a tenant provisioning-service configuration dependency, not a SCIMServer token-route failure. | Keep WorkloadIdentity as a required `BLOCKED` gate result until the dedicated gallery connector can be configured through a supported Entra administration path. Preserve `wif-e2e-proof.ps1` as a separate real-Entra assertion, RFC 7523 mint, and SCIM CRUD claim; do not count it as gallery-connector coverage. | The owned scheduled cycle, which is the earliest point at which the provisioning service validates the hidden WIF setting. |
| EG-I10 | Cleanup / asynchronous Graph state | High | Deleting an owned synchronization job sometimes returned HTTP 409 after a scheduled fallback or quarantine. | Microsoft Graph can keep the job active or quarantined while deletion is requested. Job state transitions and collection removal are asynchronous. | Pause the exact owned job before deletion, retry only the exact ID, and poll the gallery job collection until that ID disappears before reporting cleanup PASS. | Every mutating run verifies that the post-cleanup job and endpoint ID sets equal their pre-run snapshots. |
| EG-I11 | Investigation / shared configuration | Medium | A temporary federated identity credential for the unused PRTest service principal did not make Graph accept `EntraApplicationIdentifier`. | The existing credential proved that workload identity trust is service-principal-specific, but Graph rejected the connector field before runtime trust evaluation. The credential hypothesis therefore addressed a later layer than the failing configuration layer. | The temporary credential was deleted by exact ID, and the resource application inventory was verified to contain only the unchanged pre-existing credential. The reusable gate does not mutate the shared resource application. | Test hypotheses at the earliest failing boundary and remove cross-application mutation when it does not affect that boundary. |
| EG-I12 | Test correctness / eventual consistency | High | A SecretToken regression reported a successful disable Export, but the SCIM User stayed `active=true` until the 600-second target poll expired. | Graph source writes, synchronization-service reads, and target exports have separate convergence boundaries. A successful Export step proves transport success, not that the newly written source state was the value exported. | Wait until Graph reads the requested `accountEnabled` value, then repeat bounded successful exports until the exact SCIM `active` value is visible. The next run passed disable and re-enable without weakening the assertion. | The contract requires both source-state convergence and semantic target-state retry. Presence of a successful Export alone is not accepted as correctness. |
| EG-I13 | Harness setup | Medium | The first temporary-application WIF proof failed with Entra `AADSTS500011 invalid_resource` before reaching SCIMServer. | `wif-e2e-proof.ps1` requests `api://<appId>/.default`. A newly created application has no matching Application ID URI unless it is explicitly configured as a resource. | The reusable wrapper sets `identifierUris=["api://<appId>"]` and requests v2 access tokens before creating the service principal. The packaged wrapper then completed 50/50 checks and exact cleanup. | The skill invokes the wrapper rather than requiring operators to reconstruct temporary Entra setup in chat. |
| EG-I14 | Review / false-green gates | High | Changed-set review found three paths that could report success without satisfying the gate contract: blocked plan-only WIF intake, deliberate `KeepArtifacts`, and Group deprovision submission without a target-state check. | The final result predicate covered auth-mode blockers but not plan blockers, excluded the diagnostic cleanup marker, and treated Graph submission as equivalent to SCIM outcome for Groups. | Plan blockers and any retained artifact now force exit 1. Group deprovision polls the exact renamed Group until it is absent before PASS. A fresh SecretToken run passed all 14 checks with the semantic assertion active. | Static contracts lock all three predicates, and changed-set review runs before commit. |
| EG-I15 | Security / cleanup review | High | Final review found that the WIF wrapper trusted a child proof whose endpoint cleanup catches were silent, passed a custom admin token on the child command line, and did not compare the active Azure CLI tenant with the registry tenant. | Child exit status alone did not prove cleanup; native process arguments are observable; selecting an Azure config directory does not guarantee its active account still belongs to that tenant. | The wrapper now snapshots dev endpoints, fails and exactly removes any new `wif-proof-*` endpoint left by the child, passes the admin token through a short-lived environment variable, and aborts before mutation on tenant mismatch. The gallery gate has the same tenant assertion. The final wrapper run passed 50/50 and left no owned endpoint or directory object. | Static contracts cover tenant matching, absence of `-AdminToken` on the child command, endpoint snapshot verification, and cleanup failure propagation. |

## Measured authentication disposition

| Mode | Gallery connector outcome | Coverage |
|---|---|---|
| Secret token | PASS | User create, update, disable, re-enable, and deprovision; Group create, update, membership add/remove, and deprovision. |
| OAuth client credentials | PASS | User create, update, disable, re-enable, and deprovision. Group and membership repetition is explicitly unsupported because the same gallery mapping matrix is already covered through secret token. |
| Workload identity | PASS in the complete three-mode matrix | Corrected connectivity configuration, real gallery assertion acquisition, User create, update, disable, re-enable, deprovision, and exact owned cleanup. |
| Custom SCIM extensions | UNSUPPORTED | The stock `isvonboarding` schema covers core User, enterprise User, and Group. Arbitrary custom extension transport requires a reviewed synchronization-schema mapping. |

The independent reusable WIF proof passed 50 checks with zero failures against
dev `v0.55.47`. Its final measured warm-mint median was 37 ms against the 150 ms
budget. The SCIM endpoint, temporary Entra service principal, and temporary
Entra application were each removed by exact ID.

## Self-improvement dispositions

- **Test/gate:** applied. The gate parses the on-demand provisioning steps, rejects false success without an Export step, waits for Graph assignment convergence, and verifies exact cleanup.
- **Design/architecture:** accepted. One script owns Graph, SCIM, reporting, and cleanup because these operations form one transaction-like test harness. Splitting providers before a second caller exists would add cleanup and secret-lifetime risk without reducing coupling.
- **Security:** applied. The accidental dev credential disclosure was invalidated immediately, and future diagnostics are limited to allowlisted projections.
- **WIF investigation:** applied. The earlier external-blocker conclusion was incorrect. The harness used the wrong Graph collection and omitted the service-principal object identifier. Corrected configuration and an owned federated credential now pass the real gallery User lifecycle.
- **Temporary identity setup:** applied. The successful one-off setup was converted into `wif-e2e-temporary-app.ps1`, so the safe identity lifecycle and cleanup are executable and reviewable.

## WIF correction on 2026-10-14

The EG-I09 explanation above is historical and superseded by the measured
correction below. The missing field was not proof of an unsupported service.

| ID | Type | Severity | Symptom and mechanism | Resolution and verification | Prevention and detection stage |
|---|---|---|---|---|---|
| EG-I16 | Harness configuration | High | WIF identifiers were submitted to the secrets collection. The working reference exposes them through connectivity parameters with camel-case enum keys, including its own service-principal object ID. | Read the reference connectivity parameters, write both identifiers with PATCH, and add a uniquely owned federated credential for the test gallery principal. Final focused gallery run: 11 PASS, zero FAIL, all cleanup entries removed. | RED-first contract rejects the old secrets-key form. Real gallery User lifecycle verifies the actual connector, not just the independent protocol. The earliest configuration read could have found this before the previous blocker diagnosis. |
| EG-I17 | Configuration convergence | High | The first corrected run retained an earlier bearer-auth target alongside the new identifiers and timed out with 401. A successful write did not prove the complete persisted configuration. The exact underlying persistence/cache interleaving is not established. | Write the complete WIF connectivity set together and poll read-back equality before fixtures. The subsequent run minted an accepted WIF token and reached SCIM POST. | Fail before provisioning when any saved field differs. This catches the mismatch at configuration rather than after a long export timeout. |
| EG-I18 | Existing endpoint runtime | High, unresolved | The reference endpoint accepted WIF minting but its User POST returned 409: endpoint profile changed during the resource write. No profile mutation was made to that endpoint by this run. The revision mismatch mechanism remains under investigation. | The harness now creates an isolated `entra-id` endpoint and owned WIF trust instead of provisioning into the reference endpoint. That isolated gallery lifecycle passes. This is isolation, not a fix for the reference endpoint's 409. | Keep an explicit follow-up for the existing endpoint. Do not report the isolated success as proof that existing-profile writes are healthy. |
| EG-I19 | Editing / test precision | Low | A cleanup loop was initially inserted between try and catch, and a case-insensitive contract rejected the correct camel-case enum key. | Parser gate identified the syntax error before mutation; the loop was moved outside the try/catch. A case-sensitive negative check distinguishes the two key forms. | Existing parser gate plus focused contract passed before each live retry. |

The final focused run used an owned endpoint, trust, source User, job, and
federated credential. Their cleanup reports are all successful. The reference
job and its original federated credential were not edited. No production
promotion occurred. Design disposition: **accepted**, reuse the existing
endpoint helper and keep the configuration/write-readback lifecycle cohesive;
no speculative provider framework was introduced.

## Combined matrix correction and result

| ID | Type | Severity | Symptom and mechanism | Resolution and verification | Prevention and detection stage |
|---|---|---|---|---|---|
| EG-I20 | Harness mode lifecycle | High | The first default matrix passed SecretToken, then OAuth and WIF failed with `ProvisioningTaskAlreadyExists`. Jobs were retained until global cleanup, but the gallery principal permits only one job for the template. A failed scheduled cycle could also stay active while the next mode changed principal-wide credentials. | Extract exact-owned job teardown into a shared helper and invoke it from each mode's finally. Confirm collection removal before allowing the next mode. Teardown failure propagates and aborts the mode loop; global cleanup retries remaining owned jobs. The complete matrix now passes all three modes. | Behavioral controls verify ownership refusal, successful removal, and failed-convergence propagation. Static contract locks per-mode finally. Earliest combined run, rather than focused per-mode runs, exposes this defect. |
| EG-I21 | Harness scope / federation safety | High | Review found WIF copied reference `SyncAll` and deletion policy, potentially enrolling unowned users during scheduled fallback. A unique FIC name also did not prevent duplicate issuer/subject collisions. | Build an allowlisted WIF configuration with assigned-only scope, deletion enabled, and notifications disabled. Reuse an exact existing gallery federation without marking it owned; reject an audience mismatch. Deduplicate requested modes. | Contract rejects unrestricted reference-secret copying and requires collision detection. Independent review caught both paths before final consolidation. |

**Combined measured result:** dev runtime `0.55.47`, 672 seconds, **33 PASS,
zero FAIL, zero BLOCKED, zero SKIPPED**, all three required authentication
modes PASS. All **13 cleanup entries** report removed. Three explicit
`UNSUPPORTED` coverage entries remain: Group/membership repetition under OAuth,
Group/membership repetition under WIF, and arbitrary custom-extension mappings.
The first two are deliberate test-matrix reductions, not connector limitations;
the Group lifecycle is proven once under SecretToken. Custom mappings are not
proven by this stock-gallery matrix.

The existing reference endpoint's profile-revision conflict remains unresolved.
Operator visual sign-off is not implied by this result.
Self-improvement: **applied**, executable teardown failure controls now test
outcomes rather than only source markers. Design disposition: **applied**,
one shared teardown helper removes duplicated cleanup and makes the
transaction boundary explicit without introducing speculative abstractions.

## Pipeline enforcement and outstanding runtime diagnosis

Stage 4.8 of the deployment orchestrator now invokes the complete default
gallery matrix after exact dev revision readiness. It rejects child failure,
wrong runtime version, missing/duplicated auth modes, missing User outcomes,
skipped checks, and unverified cleanup. Seven behavioral controls pass, and
the same acceptance block accepts the actual 33-PASS report in an explicit
evidence replay. This is not a rerun of the full deployment orchestrator.

| ID | Type | Severity | Symptom and mechanism | Resolution and verification | Prevention and detection stage |
|---|---|---|---|---|---|
| EG-I22 | Missing pipeline evidence | High | A repository-local standalone gate was not called by the authoritative deployment pipeline, so a normal deployment could omit the real gallery claim. | Wire Stage 4.8, validate the child exit and report outcomes, and keep the prompt and infrastructure document in sync. RED source contract failed before wiring; parser, seven behavioral controls, real-report acceptance, and deployment-doc audit now pass. | The pipeline contract locks the mandatory invocation and failure cases. Standalone success alone is never reported as full pipeline execution. |

The reference endpoint conflict now has measured diagnostic evidence:
a read-only transaction found different hashes for the persisted and runtime
profiles. The persisted settings contain `PerEndpointCredentialsEnabled`;
runtime normalization removes it. The repository compares a persisted profile
revision to the request revision derived from the normalized cached profile.
This gives a concrete mismatch path even with no concurrent profile edit.
No database row was changed. A targeted regression and runtime fix remain
pending on a separate coherent change; the connector gate does not suppress
the 409 or weaken the revision check.

## Legacy-profile correction, 2026-10-14

The previously pending runtime correction is now implemented and locally
verified on its own branch. It is not deployed. PR #214 is merged through
normal merge commit `df012da94b4800f95d3db14d357a7afc5a439288`, preserving
all three connector and pipeline commits with exact-tip CI green.

| ID | Type | Severity | Symptom and root cause | Fix and why it works | Prevention and escape analysis |
|---|---|---|---|---|---|
| EG-I23 | Runtime / persisted versus normalized identity | High | Accepted gallery WIF was followed by User HTTP 409 without a concurrent edit. Request context hashed a normalized profile while the repository hashed raw persisted legacy settings. Reading also mutated the supplied storage object. | Clone before normalization; capture the raw revision and return it atomically with the normalized endpoint snapshot; forward it through all six SCIM controller surfaces. Repository comparison remains unchanged. | Unit RED confirms source mutation; 281 focused units pass. Raw legacy User/Group/Device HTTP CRUD and nine actual-edit rejections pass 12/12 in PostgreSQL; normalized CRUD and the same races pass 12/12 in memory. A normalized-hash negative control fails all three legacy cases with 409. Escaped to gallery export; earliest possible detection was a raw persisted-profile unit/HTTP fixture. |
| EG-I24 | Regression fixture correctness | Medium | First HTTP run produced 12 failures from one setup HTTP 400. The new fixture tried to submit a retired setting through the public admin API, which intentionally rejects it. | Keep valid public endpoint creation, then inject legacy JSON only into the exact owned PostgreSQL fixture. InMemory test names explicitly describe normalized rather than raw persisted profiles. | Whole suite is green on both backends. Setup failures are classified once with dependent failures as cascades; never weaken public validation to seed old data. Caught at first HTTP fixture creation, the earliest applicable gate. |
| EG-I25 | Editing tool friction | Low | One multi-file patch was rejected before any file changed because an empty extra hunk marker preceded the next file header. | Remove the empty hunk and apply the complete patch successfully. | Parser refusal prevented a partial edit; inspect patch grammar before submitting. Caught at edit-time, no escape. |

The complete PostgreSQL rerun after the negative control has zero failures
and zero skips. No dev database row was modified as a workaround. The local
test database is isolated from development and customer data.

**Test/gate improvement: applied.** Raw legacy storage fixtures and a
negative control prove the new assertions detect the original failure.
**Design/architecture disposition: applied.** One explicit snapshot method
keeps profile and revision coherent without a second asynchronous read,
public metadata, a new repository abstraction, or weaker concurrency checks.

### Built-runtime live gate

The runtime correction is saved in logical commit `46bca59a`. The reusable
`9z-DP` live section runs before cleanup, validates actual CRUD values and
published response keys, and preserves endpoint profiles. It passes 24/24
against each owned InMemory and PostgreSQL built API. A raw-legacy fixture
on the isolated PostgreSQL database passes 17/17 further live checks,
including unchanged raw profile revision. All owned endpoints and resources
are removed. These are **65 focused live checks**, not the complete live
matrix, a Docker application result, or a deployed dev result.

| ID | Type | Severity | Symptom and root cause | Fix and verification | Prevention / detection |
|---|---|---|---|---|---|
| EG-I26 | Live contract fixture | Medium | The first allowlisted live run failed one endpoint-key check per backend because its manually transcribed key set omitted documented `_links` hypermedia. Resource CRUD and cleanup passed. | Match the existing response serializer's documented keys, including `_links`; report unexpected key names explicitly. The corrected full smoke passes 48/48, followed by 17/17 raw-legacy checks. | Allowlist checks must use the published contract, not assume every underscore-prefixed key is internal. Caught at first built live contract run, no API change needed. |
| EG-I27 | Local process readiness | Low | An immediate probe of the detached API returned connection refused while the application was still initializing. | Verify its running process, wait for readiness, and confirm `/scim/health` before executing live checks. Both owned runtimes respond with `ok`; no application failure occurred. | Startup confirmation and readiness are separate claims. The deployment orchestrator already owns bounded readiness; ad-hoc probes must honor it too. Caught before any live fixture was created. |

**Test/gate improvement: applied.** The permanent live section checks
outcome values, published-key allowlists, profile preservation, and exact
cleanup, including conditional-write headers.
**Design disposition: accepted.** One cohesive live helper follows existing
section conventions; a new test framework or generic provisioning DSL would
be unnecessary.

### Release consolidation

| ID | Type | Severity | Symptom and root cause | Fix and verification | Prevention / detection |
|---|---|---|---|---|---|
| EG-I28 | Release documentation | Low | The first v0.55.48 metadata push was blocked by C13: the README version badge still claimed 0.55.47. The freshness formatter restamps current headers but does not rewrite badges or historical evidence. | Update only the live badge; the source-truth content audit now passes all 26 documents. No historical release claims were relabeled. | Run both freshness and content checks for release metadata. The existing pre-push gate caught the mismatch before tests, CI, or deployment; no new gate is needed. |
| EG-I29 | Consolidation environment | Low | Validate-mode push passed static, unit, and InMemory E2E gates, then Prisma generation failed because `DATABASE_URL` was absent in the fresh shell. Prisma's `env()` throws before a nullish fallback can run. | Supply a non-secret local datasource URL to generation and the hook process; targeted Prisma generation passes without connecting to or changing a database. | Establish Validate-mode environment before its owning run. Detection was at Prisma generation; a targeted prerequisite check could have caught it before the preceding suites. No production-code workaround is needed. |

**Test/gate improvement: accepted.** The existing content audit caught the
release badge mismatch at the earliest owning pre-push stage.
**Design disposition: accepted.** Targeted metadata edits preserve historical
evidence; using the broad local bump script would rewrite history and violate
CI-only lockfile generation.

The corrected configured Validate-mode push passes all 23 gates: 6,035
API units, 2,432 InMemory E2E passes with four PostgreSQL-only exclusions,
and 1,591 web tests. CI run `38503638725` regenerated both release locks
with zero changed package versions and byte-equivalent dependency-entry maps
(684 API, 395 web). Public-registry and SHA-512 checks pass. The read-only
consolidation review found no significant issues. Merge and dev proof remain
pending; these results do not imply deployment.
