# Tenant 09 to tenant 10: migration and 0.55.67 validation plan

> **Started:** 2026-10-30
> **Scope:** dev and canary only; customer production is excluded
> **Requested release:** 0.55.67, subject to ordinary release and performance admission
> **Execution worktree:** `SCIMServer-tenant10-migration-20261030`
> **Branch:** `ops/tenant10-migration-20261030`
> **Status:** foundations, both Ready databases, both full-source local replays and disposable Azure transfers pass. Local PostgreSQL browser acceptance passes 348 tests with zero skips, failures or flaky results. No target app is serving; release selection/admission, actual target acceptance and final carry/cutover remain pending.

## Executive summary

### Fourth review: carry the parsed login through the actual boundary

The independent review at `b8f9b847` confirms the libpq injection finding
resolved, but identifies a Medium test/implementation gap: the PostgreSQL
fixture encoded database names while hardcoding `postgres` in each URI, then
overwrote the worker login with the expected special-character fixture login.
Its GREEN proves literal worker handling, not encoded-login URI handling.
The production parser also returned the percent-encoded username unchanged,
so a real encoded special-character login could not authenticate.

The new offline `userinfo` case extracts the actual parser and confirms
`RED: production URI parser does not decode login identity exactly once.`
Only then does the parser change to decode the username once, like the
database name. The same case is now GREEN for ordinary names, whitespace,
quotes, backslashes, encoded `@`/`:` and literal percent escapes. It separately
locks the existing raw/alternate password contract; password behavior is not
changed. This is the eleventh review case within the existing 11-script gate.

The real PostgreSQL fixture now encodes each case's login in both URIs and
passes only `sourceIdentity.User` / `targetIdentity.User` into the worker.
No expected-value replacement bypasses production parsing. Corrected real
database execution and full exact-tip publication/review remain pending.

Type/severity: test correctness and URI identity, Medium. Root cause:
expected fixture values were substituted after parsing, hiding an undecoded
production username. Fix: normalize the username once and preserve the
actual parsed value across the worker boundary. Why it works: libpq receives
the intended login rather than its URI spelling, and a future parser
regression can no longer be hidden by test environment replacement.
Detection: independent review; earliest suitable detection is the new
offline actual-parser assertion, followed by real parser-to-worker readback.
Self-improvement is applied through both layers. Design disposition:
accepted; the existing shared parser owns URI normalization, while the
existing serializer owns libpq grammar. No new abstraction is required.

### Third review: literal libpq connection parameters

**Actual behavioral RED:** `f3ad6852` passes all 29 protected gates in
970.8 seconds. Hosted `41674035838` then fails the intended real PostgreSQL
assertion: `RED: TARGET libpq parameters redirected the validated
database/login identity.` This is distinct from the earlier harness failures.
The query executes successfully and reads a different target identity.

The worker now quotes every host, port, database, login and SSL-mode value
using libpq single-quoted parameter syntax, escaping literal quotes and
backslashes. Canonical parsing remains unchanged. One serializer in the
shared setup protects both preflight and full-copy connections. The complete
worker passes POSIX syntax validation, and an exact transformation control
preserves spaces and escapes quotes/backslashes. Hosted `41678029555` at
`b8f9b847` confirms the actual PostgreSQL step GREEN at
`2026-11-03T16:49:45Z`: the three source/target identity combinations, TERM
release, extra-table rejection, 2,000-row manifest fidelity and concurrent
write isolation complete successfully. Fixture ownership/tmpfs/removal
assertions execute in the same step. The normal protected publication passes
all 29 gates in 1,118.6 seconds; full hosted completion and refreshed
independent review remain pending.

Published `7f383242` passes all 29 protected gates in 1,144.8 seconds and
hosted run `41660995714`, including image smoke and Trivy; CodeQL and freshness
also pass. The exact-tip independent review confirms the two second-review
inline fixes, but identifies a new High boundary defect. Decoding the database
name is correct for identity comparison; interpolating that decoded name into
unquoted libpq parameters is not. A name containing encoded whitespace can
introduce another `host` or `dbname` parameter after the validated values.
PR #267 remains draft. No source/target copy or deployment is authorized by
these green checks.

The new real PostgreSQL regression uses the actual URI parser and worker
setup, then reads `current_database()` and `current_user` back from both
connections. Synthetic database/login names include whitespace, quotes and
backslashes; the first case would redirect to `copy_source` under the current
worker. The fixture records its unique allocation name before invoking Docker.
The existing hosted validation job now owns this real integration check as
well as the distinct offline contracts.

Local behavioral RED is not established. A test-harness splatting typo caused
a parser failure and was corrected without editing production. The next run
blocked before any output because Docker was unresponsive; a separate
ten-second read-only inventory probe also timed out. The owned blocked test
and probe processes were stopped. Local fixture allocation/absence remains
unverified until Docker responds. The operator was unavailable to choose
recovery, so use the existing hosted CI runner rather than restart shared
Docker or allocate a different performance host. Production code remains
unchanged until an actual identity assertion is RED.

Detection: independent review; earliest suitable automated check is the real
parser-to-libpq identity readback, not a parser-only comparison or stubbed
`psql`. Test-gap closure is in progress through the new hosted integration
step. Design disposition: accepted. Keep connection serialization in the
existing shared worker setup used by preflight and full copy; no strategy
framework is justified for this single boundary.

#### Publication interruption: worker startup, not assertion RED

The first protected publication of test-only `fc4e7c32` was blocked after
28 passing gates. Web Vitest reported 110 passing files / 1,309 passing tests
but also 15 unhandled fork-startup timeouts, so the gate correctly returned
exit 1. This is not a full web pass or the intended libpq assertion RED.
No application source, dependency or web test changed.

The 15 affected files were selected directly from the first causal worker
errors and rerun together with `--maxWorkers=2`: all 352 tests in those
15 files pass in 111.77 seconds, exit 0. The editor test tool could not discover
tests in the separate worktree, so the existing npm runner executed the exact
selectors. No test, timeout, assertion or gate was disabled. The subsequent
normal protected push must still pass the full default-concurrency gate.

Type/severity: tooling/environment, Medium. Mechanism: worker startup
handshakes expired before those files could execute; the underlying host
cause is not established. A later read-only sample showed about 24 GiB free
of 64 GiB and 23% CPU; it does not prove memory exhaustion or explain the
earlier failure. No surviving Node worker in this owned worktree was found,
and no shared processes were killed. Resolution: targeted bounded-concurrency
diagnosis, with unchanged full-gate publication still pending. Detection and
earliest suitable detection are both the existing web runner, which already
fails closed on unhandled errors. Self-improvement: retain the failed run,
distinguish startup failures from assertion failures, and prove every missing
file rather than treating partial counts as success. Design disposition:
accepted; no unrelated Vitest configuration change is justified.

#### Hosted regression harness correction

The normal protected retry passes all 29 gates at `d70f983b` in 933.4 seconds,
including all 1,661 web tests in 125 files with default concurrency. This
resolves the publication interruption without altering web configuration.
Hosted `41670773572` then reaches the real PostgreSQL fixture, but its new
readback query incorrectly calls the SQL keyword `current_user` as a
zero-argument function. PostgreSQL rejects that query before identity
comparison. This is a harness failure, not the intended connection-identity
RED; production remains unchanged.

The query now uses `current_user` without parentheses. Query/setup failures
are explicitly distinguished from identity assertion failures, and the hosted
step has a three-minute bound rather than waiting indefinitely for Docker.
The next actual database run must confirm the assertion failure.

That subsequent run is `41674035838`: the query now executes and the intended
target-identity assertion is RED. Thus the SQL harness correction is confirmed.
It does not establish that the production connection correction is GREEN.

| Issue | Type / severity | Mechanism and disposition | Detection / earliest suitable check |
|---|---|---|---|
| Decoded database name injects libpq parameters | Connection identity / High | Correct canonical decoding was followed by unquoted interpolation. Quote every downstream value and escape quotes/backslashes in shared worker setup; actual hosted41678029555 PostgreSQL step GREEN at b8f9b847 | Independent review, then actual target-identity RED in hosted41674035838; parser-to-worker real identity readback is the earliest suitable integration check |
| Initial GraphQL thread query lacked a closing brace | Tooling / Low | Metadata lookup failed before any thread change; corrected multiline query succeeded and both addressed threads were resolved | GitHub parser; the same query execution |
| Connection fixture used expression splatting | Harness / Low | `@environment + ...` is not a PowerShell expression; corrected to `$environment + ...` before any database run | PowerShell parser; local syntax check |
| Identity query used `current_user()` | Test correctness / Medium | SQL keyword is not callable; remove parentheses and keep pre-readback errors distinct from identity mismatch. Actual query execution pending | Hosted real PostgreSQL; an earlier real SQL smoke was unavailable while local Docker was unresponsive |

Self-improvement is applied through distinct probe/assertion diagnostics,
pre-allocation fixture-name output and bounded hosted integration. Design
disposition: accepted. Keep the existing fixture and do not change unrelated
test-runner or application behavior to make the harness green.

### Second review: canonical identity and remaining cleanup boundaries

Corrected tip `05adbacd` passed all 29 protected gates and hosted run
`41651296099`, including actual offline contracts, image smoke and Trivy.
The refreshed review confirms the original six findings resolved. It reports
two new High findings and five previously missed Medium observations. The
PR remains draft; these are not waived because the hosted matrix is green.

| Issue | Type / severity | RED / observation | Correction and prevention |
|---|---|---|---|
| Zero-padded port bypasses source/target guard | Database identity / High | Actual copy preflight accepts identical host/database with source port `5432` and target `05432` | Parse/range-check numeric ports and decode the database once in the URI parser. Same-database controls cover both padded ports and encoded database names; GREEN |
| Credential protection requires newer .NET | Runtime compatibility / High | Minimum-runtime contract identifies .NET 7 Unix APIs in the PowerShell 7.2 path | Checked `chmod 600` replaces the unsupported APIs; positive and failed-permission controls pass without assuming the host's .NET version proves the minimum |
| Existing infrastructure subnet lacks delegation | Network integration / Medium | Actual subnet helper accepts an undelegated reused subnet | Infrastructure caller declares the required delegation; reused mismatches fail before allocation and created subnets request/verify it. Focused rejection control GREEN |
| Provisioning cleanup masks the work error | Error handling / Medium | Real provisioning lifecycle loses its deployment error and skips directory cleanup after file removal fails | Preserve the work error, attempt both removals independently, report secondary failures and fail on cleanup-only errors. Combined-failure control GREEN |
| Worker termination bypasses normal EXIT cleanup | PostgreSQL lifecycle / Medium | Actual TERM exit leaves one exported source transaction | Replace server-side sleep with an idle input-held session, close input on finalization, handle signals explicitly and verify source transaction release; combined real PostgreSQL run GREEN |
| Stubbed preflight labelled as real database evidence | Evidence classification / Medium | `test-tenant-copy-preflight.ps1` replaces `psql`; it does not start PostgreSQL | Correct the PR and continuity label to a Docker-hosted shell contract. Actual PostgreSQL snapshot and earlier Azure trial evidence remain distinct |
| Detached fixture lacks durable run ownership | Test resource hygiene / Medium | Actual inspected container has no expected run label or tmpfs data storage | Give the fixture a unique run-labelled name, explicit tmpfs PGDATA, ownership-checked removal and exact-ID absence readback; combined database validation GREEN |

The four new offline cases now pass, together with the original six review
cases. An initial misplaced test closing brace caused a parser failure; this
is runner friction, not behavioral RED. After correcting only the harness,
all four intended assertions failed before the production fixes and pass
afterwards. The real-database ownership assertion likewise failed against
actual container metadata before changing fixture allocation.

The combined real PostgreSQL run now passes four cases: TERM cancellation,
extra-target-table rejection, 2,000-row manifest fidelity and concurrent-write
isolation. Every worker exit releases the source transaction, and the fixture
checks run ownership, tmpfs storage and exact container absence. The source
session stays idle in its read-only transaction instead of executing a
one-hour sleep. Its private FIFO keeps client input open; closing that input
lets the client disconnect and PostgreSQL roll back. TERM/INT/HUP have explicit
exit handling. This removes the long active server query that could outlive
a terminated client; it does not cancel unrelated sessions.

The first signal-enabled run passed TERM release but exposed a new cleanup
issue: the FIFO pathname survived, so the next worker failed with
`mkfifo: cannot create fifo '/tmp/snapshot-input': File exists`. The trap now
unlinks its owned FIFO, reports unlink/client-close failures and preserves
the original worker exit status. The same combined fixture is now GREEN.
Detection: real integration; earliest possible check was consecutive-worker
reuse, now permanent in this fixture. This is separate from target writer
quiescence and is not an Azure application acceptance claim.

Self-improvement is applied through canonical-identity, minimum-runtime,
caller-wired subnet and combined provisioning cleanup controls. Design
disposition: accepted. Keep finite checks in existing helpers; normalization
belongs in the shared parser, not duplicated at each guard. Signal/fixture
integration validation is GREEN; complete corrected-tip publication/review
remain pending. No target deployment, release admission or cutover is implied.

### Independent review corrections in PR #267

Exact-tip hosted run `41645490136` passed validation, image build/push,
container smoke and Trivy for `f440c9bc`; CodeQL and freshness also passed.
Independent review nevertheless identified six real defects. The PR stays
draft until corrected-tip protected gates, hosted CI and refreshed review
complete. Green CI did not establish these previously unasserted outcomes.

| Issue | Type / severity | RED evidence | Fix and why it works | Prevention / escape |
|---|---|---|---|---|
| Permissive caller continued after ACL failure | Credential protection / High | Mocked non-terminating Windows ACL failure was accepted from a `Continue` caller | Private-directory creation and provisioning establish local `Stop` preferences before file operations | Actual helper regression runs under a `Continue` caller; hosted review caught what the earlier `Stop`-only fixture could not |
| Absence guard was not wired into provisioning | Destructive provisioning / High | Existing server received a deployment/password-reset request | Invoke direct provider absence verification before any credential persistence or deployment | Provisioning-level controls reject Ready, Dropping, empty, denied and transport-error states with zero deployments; the earlier helper-only fixture did not prove integration |
| Allocated server credential could be lost | Recovery / High | Allocation began without a verified server-scoped recovery record | Write/read back a private immutable credential record before allocation and a separate verified connection record immediately after outputs, before caller extension work | Failed-allocation control proves the credential exists before Azure invocation; compiled-template fixtures verify returned-URI recovery and immutable credential retention |
| Delegated job names exceeded Azure limits | Transfer integration / Medium | Actual copy prefix rejected `scim-replicate-dev-next` before Azure | Bound the prefix to 19 characters before adding its unique 12-character run suffix | Actual name-construction controls cover dev-next, canary-prod-next and existing canary-prod prefixes; earlier standalone transfer names missed delegated caller values |
| App suspension did not bind to restored database | Writer safety / High | Dev app accepted a canary database restore in the same subscription | Resolve the app's effective DATABASE_URL, including secret references, and compare host, port and database before suspension or restore | Actual copy preflight rejects cross-estate, missing, wrong-port and wrong-database bindings, and accepts matching direct/secret bindings without target mutation; earlier subscription membership was too weak |
| Bootstrap offered an unsupported legacy shell | Runtime compatibility / Medium | Missing `pwsh` launched the Windows PowerShell fallback | Require PowerShell 7.2+ in deployment and check `pwsh` before child launch | Missing-runtime regression proves no legacy child starts; deployment already uses PowerShell 7 syntax, so claiming Windows PowerShell compatibility would be misleading |

All six behavioral REDs are now GREEN. The first app-binding extraction
attempt failed because a dynamically created script had no `PSScriptRoot`;
only the test harness was corrected to bind its actual script directory,
then the real cross-estate acceptance RED was confirmed before production
changes. That setup failure is not counted as behavioral RED.

The expanded combined offline gate passes all 11 scripts. Actual PostgreSQL
Bicep compilation and all five provisioning outcomes pass separately,
including immediate connection-record readback and original credential
preservation. Private recovery records are owner-restricted files, not
off-device backups or an encrypted archive claim. They deliberately survive
allocation/extension failures; temporary template parameters are removed.
The helper returns the record path, never prints its password, and refuses
existing or unverifiable target servers rather than trying password recovery
by redeployment.

Test/gate self-improvement: applied actual-entry-point regressions for caller
error policy, delegated names, absence integration, credential timing and
effective database identity. Design disposition: accepted. Keep these finite
checks in the existing provisioning/copy safety seams; no new policy engine
or speculative persistence abstraction is needed. The real source snapshot
program is unchanged by these review corrections. Release qualification,
target application acceptance, final source freeze and cutover remain separate.

### Migration implementation consolidation (2026-11-03)

The qualification-method correction proceeds independently; migration tooling
is being consolidated rather than waiting on that release decision.
An actual copy-lifecycle regression found a secondary job-cleanup exception
replacing the original transfer failure. Nested `finally` blocks attempted
cleanup but lost the primary diagnosis when another cleanup operation threw.
The corrected lifecycle retains the original error record, attempts revision,
owned-job and named secret-scratch cleanup independently, reports every
secondary failure, and still fails if any cleanup fails after a successful
copy. Failed transfers never reactivate target writers.

| Issue | Type / severity | RED evidence | Fix and why it works | Prevention / escape |
|---|---|---|---|---|
| Transfer error masked by cleanup | Error handling / Medium | Actual extracted lifecycle expected `fixture primary transfer failure` but received `fixture job cleanup failure` | Save the work error before finalization; collect/report cleanup errors separately and throw work error first | Five actual-lifecycle combinations now pass; caught at consolidation, earliest catch was a unit-level combined-failure fixture |
| Missing ignored evidence directory | Tooling / Low | Test output redirection failed before the test ran | Create only the owned `test-results` directory, then run the test and confirm its assertion RED | Do not treat runner setup failure as behavioral RED |
| Exported snapshot survived worker exit | PostgreSQL cleanup / Medium | Actual database fixture reported `completed copy worker left 1 source transactions holding its exported snapshot` | Interrupt the owned `psql` client instead of terminating it so the running sleep query is cancelled and its source transaction closes | Failed-copy fixture is GREEN with all three fidelity/isolation cases; permanent checks also cover successful and concurrent-write exits. Caught in integration consolidation; the original fidelity-only fixture could not detect source-session retention |
| Protected publication lacked codegen URL | Environment / Low | First protected Validate push passed 26 gates, then Prisma reported `Cannot resolve environment variable: DATABASE_URL` | Supply the non-secret `postgresql://localhost:5432/scim_codegen?schema=public` in the same process as the protected push; isolated code generation now passes without database access | The earlier codegen shell's environment did not persist. Explicitly include this codegen-only input in the publication invocation. Caught by the hook; an environment prerequisite check before the hook could have caught it earlier |

Consolidation commit `579b2046` passed API unit coverage (6,254 tests across
216 suites) and inmemory HTTP coverage (2,514 passed, 42 explicit skips,
118 passed suites) during its first protected push. That push remained
blocked at code generation, so those results are not a completed publication.
The source-release check subsequently covers all three worker exits and
passes. No hook is bypassed; the corrected-environment push must complete
the full remaining protected matrix and hosted exact-tip CI.

For tooling publication, run the ordinary `PREPUSH_MODE=Validate` push with
the explicit codegen-only `DATABASE_URL` set in that same shell. Do not copy
a real source or target database credential into this prerequisite, assume
an earlier shell's environment persists, or treat an isolated codegen success
as a substitute for the protected push.

The exported-snapshot fix was confirmed against real PostgreSQL, not client
process absence. The old termination signal stopped the client while its
server query continued sleeping inside an open transaction. The interrupt
uses the owned client's cancellation path; it does not cancel unrelated
source writers or alter the frozen snapshot used by the dump. This prevents
an unnecessary source transaction from remaining until its one-hour sleep
expires. The three data-fidelity and concurrent-write cases still pass.
The regression now checks source transaction release after every worker exit.

The ten offline PowerShell contract scripts now execute through
`scripts/test-tenant-rollover.ps1`, wired into both the normal pre-push checks
and hosted Build Test Image validation. The combined local gate passes,
including the five cleanup combinations, with no Azure or Docker access.
Compiled-template and real PostgreSQL replay tests remain independent
integration evidence; the offline gate is not a substitute for them or for
final source quiescence, application deployment, or browser acceptance.

Test/gate self-improvement: applied actual combined-failure regression
coverage and continuous pre-push/CI execution instead of manual-only tests.
Design disposition: accepted. The existing carry orchestrator and safety
helper remain cohesive; a new finalization abstraction has no second caller
and would be speculative. The one small contract runner has two real callers.

### Fixed-warmup study completed: release remains blocked (2026-11-03)

The independently reviewed study in PR #265 completed successfully as a
**diagnostic**, not performance admission. Run `41632439081` took 6 minutes
47 seconds. GitHub's actual synthetic checkout was
`196000e518464c4b185f13217e308740ff57a345`, whose verified parents are held
parent `ff0b3a46` and reviewed study `991a9ce0`. Its one Linux/amd64 image ID
was `sha256:18901aded38abfabd53b0a045f765d84396af71c51fd9ad81cc5fe6645a3b648`.
All eight round receipts identify that image, application 0.55.67 and client
Node v24.22.2. This is a local Docker image ID, not a published registry
manifest digest or a retained image archive.

Read-only inspection verifies all 49,656 benchmark lifecycle requests and
32,000 chronological measured values, including all warmup spans. Both
blocks retain 0.5 CPU / 1 GiB, `cpu.max=50000 100000`, complete resource/CPU
receipts, no out-of-memory termination, 66 functional assertions and 200
privacy checks per block, timely capture, and absent owned containers and
networks after cleanup. The 100- and 1000-cycle blocks finish in approximately
132 and 174 seconds, inside their separate 15-minute work deadlines.
Privacy/functional calls are additional to the benchmark request count.
The verification report hashes the exact parsed input buffers and retains
all measured observations in their original chronological windows.

**Longer warmup did not establish repeatability.** The following are
descriptive same-image point ratios, not release-assessor results:

| Fixed warmup | Operation and percentile | Baseline ms | Candidate ms | Candidate/baseline |
|---|---|---|---|---|
| 100 | Add, p99 | 67.715361 | 55.530154 | 0.820053 |
| 100 | Populated read, p99 | 35.654852 | 52.172167 | 1.463256 |
| 100 | Empty read, p99 | 35.084532 | 38.918148 | 1.109268 |
| 1000 | Add, p95 | 31.942926 | 25.811263 | 0.808043 |
| 1000 | Remove, p95 | 23.355357 | 27.363747 | 1.171626 |

Even the 1000-cycle treatment has substantial differences between identical
image roles. It is not a demonstrated fix for the original gate. Sequential
host time, database/log histories and observer effects prevent attributing
the differences to warmup alone. The 250-value windows are chronological
descriptions, not independent replications. The prior untraced admission
failure remains unchanged; no diagnostic marker is removed and no favorable
window is substituted. No further unchanged campaign is allocated.

The next substantive boundary is a separately frozen and reviewed
performance-method design, not another warmup increase or a waived failure.
Any replacement must preserve genuine regression protection and explicitly
address correlated requests, tail-estimate precision and finite execution
budgets before allocation. The requested release remains 0.55.67; a different
release is not silently selected. Neither prov10 application is deployed,
no final carry/cutover has occurred, and customer production is untouched.

Execution-analysis notes: an initial inspection script assumed the functional
test lived beside the runner; canonical discovery corrected it to
`scripts/live-test-sections/minimal-group-members.ps1`. A subsequent strict
hash check correctly stopped because Git object bytes use LF while committed
`.gitattributes` forces PowerShell checkout bytes to CRLF, including on Linux.
Exact policy-derived checkout bytes match every retained source hash. These
are inspection-tool assumptions, not study defects or altered artifacts.
The inspection now verifies the canonical path and exact committed checkout
policy; hashes are never accepted by trying arbitrary transformations.
Detection and earliest possible detection are both the offline evidence
inspection. Full-transcript RCA reconciliation and off-device recovery
remain unestablished.

Test/gate self-improvement: applied the explicit source/checkout-policy
checks in the owned inspection script; existing experiment-isolation guards
continue to prevent a green diagnostic from becoming release admission.
Design disposition: accepted. The bounded two-caller builder and existing
trace lifecycle remain cohesive; no new application abstraction is needed.

PR #265 is merged normally into held #251 at
`0b6490f7cbc1d728fe338579d764d2e29fabb3e2`, after exact-tip CI, independent
code review and actual artifact inspection. This is diagnostic integration,
not release admission. The separate private checkpoint
`qualification-warmup-41632439081-20261103` retains all downloaded artifacts,
both complete publication/hosted logs, review, owned inspection and current
plan. Its verified Git bundle preserves the exact measured synthetic
checkout and complete ancestry. The 37,343,782-byte CurrentUser-DPAPI payload
passes a decrypted SHA-256 roundtrip; named plaintext ZIP/staging are removed.
It preserves the measured source, not a claim that the later integration
commit itself was measured. Previous encrypted recovery points remain intact.
Off-device recovery and a retained diagnostic image binary are not claimed.

### Calibration review and bounded study preparation (2026-11-03)

PR #264 received independent review after its initial exact-tip hosted checks
passed. Two real evidence-integrity findings were reproduced and corrected
in `d374a3d0`: window summaries did not include the raw observations claimed,
and hashes reread paths after parsing. The corrected report reconstructs
all 16,000 original observations in order, hashes the exact parsed buffers
and reproduces all twelve original comparisons/four failures unchanged.
Focused contracts pass 66/66. The exact review-fix tip passes all 30 normal
protected Validate gates in 1154.8 seconds: complete tooling 235 PASS /
8 explicit skips, API unit 6254 PASS, inmemory HTTP 2514 PASS / 42 explicit
skips, and Web Vitest 1661 PASS. Hosted run41625825632 passes validate and
build-and-push. Refreshed independent review at exactd374a3d0 reports no
active issues and both original threads are resolved; its state is COMMENTED,
not formal APPROVED. PR264 merges normally into held #251 at
ff0b3a46907545539de6d3dcfdc6616216348c0a. The immediate parent-head lookup
still returns6f846cf8, so propagation must be verified before the next
readiness boundary. #251 remains draft and no campaign is retried.
This does not admit #251 or alter the original failed evidence.

A separate isolated `SCIMServer-qualification-warmup-20261103` worktree now
implements the proposed fixed 100/1000-cycle diagnostic in commit991a9ce0.
Its full normal protected publication passes all30 Validate gates in1317.2s:
tooling247 PASS/8 explicit skips, API6254, HTTP2514/42 explicit skips,
web1661. Previously owned physical dependencies were reused, without new
installation or shared-module mutation. The post-run source is clean.
Exact991a9ce0 hosted41629105026 passes actual validate, image build/push,
container smoke and Trivy steps. PR265 targets held #251. Independent
review at exact991a9ce0 is COMMENTED with no open code issues, explicitly
retaining actual hosted-artifact inspection beyond mocked tests. After
verifying both stable source/base and the parent draft hold, deliberate
PR265 readiness starts bounded study41632439081 at the correct head.
Actual run steps include its exact-image build and both fixed treatments.
This was the allocation checkpoint; the completed result and artifact
inspection now appear in the newer section above.
Focused contracts
pass 137/137 after semantic RED, including actual HTTP 4407/8007-request
counts, complete spans and cleanup, original-assessor rejection, actual
shared-builder execution and native-analysis isolation. The two-treatment
Linux study was not yet executed at that preparation checkpoint. Its 65-minute job retains the
original resource limits, 1000 measured cycles and 15-minute per-block work
stops. No adaptive warmup, sample selection, retry or admission is permitted.
No target app, final source freeze/carry, registry cutover or customer-prod
change has occurred; #251 remains draft. Its head now confirms the propagated
prerequisite mergeff0b3a46. The earlier stale immediate readback was not used
to open a readiness boundary.

The immutable private recovery point
`qualification-review-d374a3d0-study-991a9ce0` preserves complete source
history, the independent findings, corrected raw observations, exact RED/GREEN
evidence and the complete 30-gate review-fix publication log. Both encrypted
payloads pass SHA-256 roundtrip verification; named plaintext archives and
staging files are removed. It does not claim off-device recovery or a hosted
study. Both previously requested obsolete diagnostic cancellations are now
confirmed completed/cancelled, not successful qualification.

### Current-image qualification implementation (2026-11-03)

Continuation is active in the isolated
`SCIMServer-qualification-image-binding-20261103` worktree, based on the exact
0.55.67 candidate `abdef720`. Commits `f83eecfc` and `ba99530c` bind the
qualification workflow to its actual checkout image instead of the frozen
0.55.58 candidate. Source SHA, package version, Linux/amd64 image identity and
revision label are checked before allocation. The historical protocol,
performance bounds, resource quotas, sample counts and retained failures are
unchanged. No serving API, browser source, schema, dependency manifest or
lockfile was changed.

- Focused source-binding contracts: **58 PASS, zero skips or failures** after
  observed RED.
- Complete local membership tooling: **227 PASS, 8 explicit retained-fixture
  or opt-in skips, zero failures**.
- Historical negative evidence: the updated assessor reproduces all 12
  original control checks exactly, including the same three failures.
- Actual fresh-base local image: **0.55.67, Node 24.22.2, Linux/x64**, with
  real immutable identity and a separately generated source-bound protocol.
  Windows Docker Desktop is not treated as Linux-host qualification.
- The normal protected push **passed all 30 Validate gates**, without hook
  bypasses, in 1,195 seconds. API unit: 6,254 PASS in 216 suites. API inmemory
  E2E: 2,514 PASS and 42 explicit skips in 118 passing/2 skipped suites.
  Web Vitest: 1,661 PASS in 125 files with no skips or failures. API lint:
  zero errors and 507 warnings, with serving source unchanged.
  Isolated API, web and root dependencies were restored only after
  corresponding observed missing-dependency failures. Prisma client
  generation succeeds without contacting a database. No shared worktree
  dependencies or lockfiles were modified.
- Prerequisite [PR #263](https://github.com/pranems/SCIMServer/pull/263)
  targets #251's branch without duplicating or rewriting its history.
  Exact tip is `ba99530c459d6b559fdd5a6693f5cde773a10aa4`.
  Hosted run `41613586343` passed both validate and build-and-push.
  Independent Copilot review at that exact tip reports no open code issues,
  explicitly retaining the hosted Linux qualification requirement.
  The REST review-request event verifies the actual reviewer is Copilot;
  the initial short CLI alias `copilot` was rejected and was not treated as
  a successful request.
- PR #263 merged into #251 at
  `6f846cf8ed8aa8a2bd63867018e806937418e6ae`. #251 was made ready for the
  current-image run, then returned to draft after its failure; it is not
  merged into master. Corrected current-head qualification
  `41615647439` built/bound the actual image, then failed the first same-image
  block; details below. All current-tip ordinary validation, image builds,
  CodeQL and freshness checks pass.
- The qualification workflow is absent from default master. Its supported
  path is reviewed integration into #251 followed by its normal
  ready-for-review trigger, not an assumed branch dispatch.

Hosted qualification, reviewed release merge, immutable publication, actual
target acceptance, final data carry and registry cutover remain independent
pending steps. Neither target application is claimed deployed.

**Execution issue - readiness/merge propagation race (Medium, CI process):**
immediately marking #251 ready after the prerequisite merge emitted one set
of expensive events still identifying the former `abdef720` head, followed
by current `6f846cf8` events. The obsolete qualification `41615184471`
actually selected the old workflow without the new build step and occupied
the concurrency slot. The obsolete native `41615184495` and CPU
`41615184515` runs were also queued. Explicit cancellation was requested only
for those three runs created by this continuation; existing historical
evidence and other users' runs were not changed. The obsolete qualification
is now confirmed cancelled, with its partial artifact downloaded locally.
The first current-head event `41615189303` was skipped because its event
still carried the prior draft state. After verifying the stable new head,
a fresh draft/ready transition started the correct current-image campaign
`41615647439`. Neither cancelled nor skipped work is qualification success.
The earliest possible check was confirming the parent PR head had propagated
before its readiness transition; detection occurred at run source/job
inspection. Prevention is to verify that stable parent head first, then
independently require the actual run head and expected build step before
waiting for or admitting its results. Do not equate an accepted ready command
with a campaign on the intended source.

**Current-image measurement result (2026-11-03):** run
[41615647439](https://github.com/pranems/SCIMServer/actions/runs/41615647439)
completed its build/binding and all four first-control rounds. Both roles
actually used the same immutable 0.55.67 image
`sha256:92cd502441b9fca1db77e1f09136a0ddb8c66552b659a250c36b53be1ac3d52b`.
Its actual synthetic merge checkout is
`bc60f7f3482eba23d5c53f01693448b6831d8747`, distinct from the PR head;
the generated protocol binds that actual checkout, not an assumed head.
All rounds retain 0.5 CPU, `50000 100000` quota/period, 1 GiB and 100 warmup
cycles. There are 17,628 checked requests and 16,000 retained timings.
All 66 functional assertions, 200 private-log checks, capture/finalization
and exact container/network cleanup pass.

| Failed same-image check | Baseline ms | Candidate ms | Ratio |
|---|---:|---:|---:|
| Populated read p95 | 5.067600 | 2.897739 | 0.571817 |
| Remove p95 | 37.160945 | 41.732953 | 1.123033 |
| Empty read p95 | 6.775415 | 2.986064 | 0.440720 |
| Empty read p99 | 54.143737 | 45.715803 | 0.844341 |

These are repeatability failures, including faster out-of-range controls,
not an old/current comparison or proof of a product regression. The opposite
control and both old/current blocks correctly did not run. No unchanged
qualification rerun, limit relaxation or application optimization was made.
The automatic CPU/native companion workflows still use the frozen .58
protocol, so cancellation was requested for this continuation's redundant
`41615647468` and `41615647421`; they cannot diagnose the new .67 artifact.

**Observed history/stability gap, not established root cause:** first-visit
app-cgroup CPU windows are 15.649415 and 15.917395 seconds; second visits are
12.935777 and 13.405268, while SQL calls remain 25,591-25,593. Even after
the fixed 100 warmups, populated-read p95 changes from 6.355253 to 2.652742 ms
between the first/last 250 measured samples of the first role visit, and
6.801990 to 2.667220 ms for the other role's first visit. All four broader
windows show roughly 97.8-98.5% of scheduler periods throttled. This is not
97.8-98.5% CPU utilization or request-specific causal attribution.
The existing warmup count therefore does not demonstrate a stable measurement
regime. A prospectively reviewed calibration/stabilization design is the
next decision; choosing a larger warmup after seeing a favorable result or
simply repeating until green is not valid admission.

**Self-improvement applied:** exact-image binding exposed the current
artifact's real control failure rather than recycling an older image PASS.
Run-head/build-step verification caught the event propagation race, and
functional/capture/cleanup claims are recorded separately from latency.
**Design disposition: accepted.** No speculative production-code change,
new framework or paid host is justified by the present evidence. A change to
measurement design requires an explicit prospective boundary and review.

**Calibration continuation:** the operator was unavailable for a focused
measurement-design choice. That is not paid-resource, gate-waiver or
deployment approval. Under the existing instruction to diagnose/fix issues,
the pragmatic next step is a non-admitting analysis using the retained data.
Branch `fix/qualification-calibration-20261103`, commit `0c9e07b2`, adds six
tested contracts and a small collector to the existing assessor. Semantic
RED precedes **64/64 focused PASS**. Its actual report hash-binds inputs,
retains all 64 chronological windows/16,000 samples and reproduces all 12
original checks exactly, including the four failures. The new normal
protected Validate push is running. It does not change warmups, workloads,
quotas, thresholds, application code or dependencies.

The second baseline visit's populated-read p95 windows are 4.574270,
30.201782, 22.543207 and 16.514300 ms; the second candidate visit's are
2.465563, 3.469971, 3.396606 and 2.432962 ms. Simply dropping the first cold
window does not explain or remove the observed problem. The windows are
descriptive, not independent samples or a new acceptance test.

**Verified external method guidance:** the current upstream
[Node benchmark measurement guidance](https://nodejs.org/api/bench.html#measurement-model)
explicitly warns that fixed warmups do not guarantee stable optimization and
recommends inspecting raw sample trends and multimodal distributions.
This is methodological guidance, not a proposal to install its experimental
runner or assume it exists in the pinned Node 24 runtime. The
[Linux CFS bandwidth documentation](https://www.kernel.org/doc/html/latest/scheduler/sched-bwc.html)
explains that exhausted CPU quota can stop a task group until its next
period. These sources justify investigating warmup and quota scheduling;
neither establishes the unique cause of this application's observations.

The next prospective diagnostic design, **not implemented or approved for
admission**, is bounded as follows:

1. Review the current descriptive collector and its exact-result safeguards.
2. Freeze a diagnostic question before collecting new data: does a fixed
   1,000-cycle warmup, compared with the original 100, materially change
   within-visit and across-visit instability for the same current image?
3. Use one existing GitHub Linux host/image build, original half-CPU/quota
   period/1-GiB allocation and original 1,000 measured cycles. At most two
   four-round same-image diagnostic blocks; retain all warmup and measured
   timings, process visits, image/runtime identities and cleanup receipts.
4. Define the diagnostic schema, explicit non-admission markers and bounded
   work/cleanup/upload budget in reviewed source before execution. The
   existing qualification validator must continue rejecting changed warmup
   or instrumented receipts. Do not silently relax it to accept the study.
5. Treat sequential-treatment host/time differences and changed database/log
   history as limitations. Do not infer causation or false-failure probability
   from smaller windows, or adapt warmup until a favorable result appears.
6. If the bounded study does not clarify a reproducible measurement regime,
   report it unresolved and stop. If it does support a candidate correction,
   propose that correction separately for prospective review and actual
   admission; do not rewrite any existing failed result.

The reviewed release, immutable final artifact, actual target HTTP/browser
matrix, final writer freeze/carry and role cutover remain required after
valid performance admission. The latest failed-source evidence is retained
in `qualification-failure-20261103T1011035881166Z`, with verified protected
archive roundtrip and no plaintext generated archive left behind.

The move will reuse the existing estate registry, PostgreSQL carry scripts,
directory bootstrap scripts and deployment validation pipeline. It will not
replay the SCIM API or introduce a second model-aware data copier.

Tenant 10 authentication succeeded through the normal browser flow. Azure
Owner and Entra Global Administrator were verified separately for the actual
signed-in account. No elevation or account substitution was performed.
The registry still marks tenant 09 active; no target routing or role cutover
has been performed. Current source HTTP health is unverified as noted below.

**2026-11-03 migration feasibility clarification:** source tenant expiration is
not the fundamental obstacle to creating the target dev and canary apps.
The [actual tenant-08 execution RCA](TENANT_09_MIGRATION_EXECUTION_ISSUES_AND_RCA.md#i1---the-control-plane-expired-in-the-middle-of-the-migration)
records that both old applications and PostgreSQL continued serving after ARM
expired. The existing [replication entry point](../scripts/replicate-estate.ps1)
accepts preserved source connection strings and treats unavailable source ARM
as a warning. The [database transfer worker](../scripts/rotate-tenant-data.ps1)
uses a temporary job in the target tenant, with PostgreSQL authentication
independent of source Azure authentication. This migration's actual full-source
Azure trials and November 2 post-expiry recovery already establish that path.
Restoring source ARM access is not a prerequisite for the database carry.

At `2026-11-03T08:44:02Z`, read-only ARM calls with the verified target
automation identity confirm both target PostgreSQL 17 servers **Ready** and
**zero Container Apps**. The prepared registry still says tenant 10 `next`.
Separate integrated-browser health probes against retained source hostnames
returned `ERR_FAILED` for dev and a 30-second timeout for canary. Neither
establishes why source HTTP is unavailable from this client or means the
PostgreSQL data plane has stopped. No new dump was run merely to repeat the
November 2 successful recovery. The private
`tenant10-decision-readiness-20261103T084402Z.json` receipt preserves these
observations without credentials.

The remaining build decision must be kept separate from migration mechanics:
the requested 0.55.67 is an unmerged held candidate, not an unavoidable
dependency of every tenant move. A different existing release cannot silently
replace that exact request; its publication provenance and applicable gates
must be checked, and the operator must authorize the changed version.
Provisioning a dedicated benchmark host is a separate proposal, not a
requirement imposed by expired-source PostgreSQL migration. Final cutover
still requires independently verified writer quiescence, an honest final
database snapshot and actual target validation; source expiry does not prove
the old writers stopped.

**2026-11-02 expiration incident:** source ARM now explicitly rejects token
acquisition with `AADSTS5000229`: tenant 09 is unavailable due to expiration
(observed `2026-11-02T12:43:40Z`). Cached `az account show` still reports the
subscription as Enabled, which is not evidence that control-plane access works.
The registry's active role therefore describes routing, not a healthy directory.
No logout, account substitution, privilege change or source mutation was
attempted. The protected October 30 data-plane credentials and application
metadata were captured before this loss of access.

A fresh read-only data-plane recovery **passed** using those preserved
credentials. Its metadata is explicitly labelled as the retained October 30
baseline, not a fresh ARM capture. Both complete network-isolated restores
passed with nine tables each, zero invalid indexes and zero unvalidated
constraints. Independent verification confirms **30 file checksums and 22
protected artifacts**, with no remaining plaintext archives or restore
containers. Earlier backups remain untouched.
The first wrapper failed because it copied an old generated `dev-dump-toc`
alongside the genuine configuration metadata. The complete fresh dev archive
was encrypted and retained, and the original failure receipt remains unchanged.
After semantic RED and 10 actual-copy selector controls passed, the corrected
continuation excludes old dumps, TOCs and restore manifests. It reuses that
checksum-verified dev archive instead of dumping dev again, captures canary
only, and requires complete restores of both in a new package:
`rollover-after-expiry-20261102T1259169094310Z`. Three actual estate-selector
controls and the existing encryption/corruption self-test pass.
The successful continuation completed at `2026-11-02T13:07:17.909Z` and
independent verification completed at `13:08:33.960Z`. All **eight non-log
table fingerprints per estate match the October 30 recovery exactly**,
including resource/member content, endpoint configuration, credentials/DEKs,
JWKS host policy, server settings and migration history. Only `RequestLog`
differs: dev has 358,914 rows versus 375,676, and canary 23,878 versus 24,164.
Those are observed snapshot differences; no unique cause is claimed here.
Previously verified crypto acceptance is not repeated for unchanged protected
credential/DEK rows. This fresh backup is not a coordinated write freeze,
an admitted application release or final zero-data-loss carry.
Consolidated checkpoint `snapshot-20261102T1311214885406Z` verifies **147
checksums, 48 protected byte roundtrips, 21 protected JSON checks and 1,318
browser archive entries**. It preserves the updated recovery helpers and
both full-history Git bundles, and checksum-binds the separate fresh source
package's manifest/outcome/provenance. No earlier recovery package or snapshot
was overwritten. CurrentUser DPAPI still does not prove off-device recovery.
Source HTTP health has not been established: the direct dev request and the
subsequent configured-network requests to both retained source hostnames timed
out after 30 seconds. Those transport failures do not identify their unique
cause or prove the database is unavailable; the fresh dev database dump was
already growing past 444 MB through the separate PostgreSQL data plane.
No HTTP retry loop or healthy-source assumption is permitted.
Actual tenant-10 ARM reads at `2026-11-02T12:49:24Z` still prove both PostgreSQL
17 servers Ready in Central US, no target apps, and unchanged active/next roles.

The target deployment principal now has Contributor only on the two target
resource groups and exactly one effective `Application.ReadWrite.OwnedBy`
assignment. Its owned-app create/update/delete outcome was verified, including
exact value readback and cleanup. Three permanent target auth-proof identities
were recreated using that principal, with credentials private to the Windows
user. Each acquired a real Entra token. Actual tenant, client, audience and
subject claims were checked without retaining tokens.

The proof bootstrap initially recorded a version-2 issuer even though all three
tokens were version 1. The new metadata regression passed after observed RED,
and the existing private credential records were corrected from actual tokens,
without recreating applications or rotating secrets. Decoding these claims is
diagnostic evidence, not signature-validation or target WIF acceptance.

**0.55.67 is not a released artifact yet.** The candidate is
`abdef7207428ec26ce54e76ec0e26a08921ea6ea` in draft PR #251. Master is
`eb733f61e7f25d1d642fe746075e266c3b19ad60`, version 0.55.66.
Ordinary candidate correctness checks passed, but the retained performance
qualification failed and the new tip is not admitted. Its skipped campaign
jobs are not passing qualification. No release tag, final release digest or
source-only exception has been established.

The operator's request authorizes preparation and migration. It does not
silently waive the existing release hold, performance bounds, exact-source
publication rule or customer-production approval requirement.

## 0. Release decision brief (2026-11-03)

### Main conclusion

The expired-source recovery route works and target foundations are ready.
The requested latest build is blocked by release qualification and publication,
not by a need to revive source ARM or purchase a dedicated Azure host.
There is no already published, fully admitted 0.55.66 replacement established
by this investigation. Keep 0.55.67 as the requested outcome unless the
operator explicitly changes it; investigate the measurement failure on
existing resources before proposing new expenditure.

The following paths are independent until target runtime acceptance:

```text
Data path:
  Preserved source PostgreSQL credentials
    -> read-only dump through a temporary target-tenant job
    -> target PostgreSQL 17, complete content and identity verification

Release path:
  Reviewed source and valid performance evidence
    -> reviewed merge to master
    -> exact-source published image and immutable digest

Combined target acceptance:
  Restored data + admitted image
    -> dev HTTP/authentication/corpus/browser/latency gates
    -> same digest on canary and the complete applicable gates
    -> verified final writer freeze, final carry and revalidation
    -> explicit client migration and atomic registry-role cutover
```

Final copy ordering must keep target writers suspended during restore.
An earlier rehearsal or successful source backup is not the final frozen
snapshot. Source ARM expiry does not establish that old clients stopped writing.

### Exact PR state and what 251 contains

[PR 251](https://github.com/pranems/SCIMServer/pull/251) is OPEN and draft.
Its exact head is `abdef7207428ec26ce54e76ec0e26a08921ea6ea`.
Live master is `eb733f61e7f25d1d642fe746075e266c3b19ad60`.
GitHub reports MERGEABLE/CLEAN, all review threads resolved and seven ordinary
checks successful. There is no formal APPROVED review; returned review states
are COMMENTED. Branch protection requires `validate`, `build-and-push` and
`Analyze (javascript-typescript)`, with strict up-to-date checks, but does not
configure a required-review count. The project still requires a reviewed PR.
Skipped qualification/profiling campaigns are not passes.

| Comparison | Commits including merges | Changed files | Insertions | Deletions |
|---|---:|---:|---:|---:|
| Published 0.55.20 source to master 0.55.66 | 491 | 981 | 134,291 | 12,406 |
| Master 0.55.66 to PR 0.55.67 | 62 | 91 | 18,429 | 51 |
| Published 0.55.20 source to PR 0.55.67 | 553 | 1,031 | 152,673 | 12,410 |

Counts are endpoint-tree differences, not sums of intermediate changes.
The candidate worktree's local `master` is stale and was not used.
The [complete comparison](https://github.com/pranems/SCIMServer/compare/6785200ff59ccbc12f62b795439fb245e1635480...abdef7207428ec26ce54e76ec0e26a08921ea6ea)
uses the actual published baseline source, not a guessed Git tag.

PR 251 uniquely contributes:

- The frozen four-block membership qualification protocol and fail-stop assessor.
- Linux orchestration, immutable image selection, bounded resource/deadline
  handling, privacy receipts and ownership-checked cleanup.
- CPU/native-function, process-history, SQL-statement, GIN and derived-reference
  diagnostic tools, with 19 script-test paths.
- Three guarded performance workflows, ordinary CI membership-tool checks,
  full checkout history and two-worker web validation.
- Pre-push Prisma configuration preflight, documentation and coordinated
  0.55.67 root version metadata.

The production API source, Prisma schema/migrations, browser source and estate
registry are identical to live master 0.55.66. API/web manifests and locks
match except root version fields; there are no unique dependency-version
upgrades in 251. Its 91-file delta consists of 36 documentation paths, six
GitHub paths, 19 script-test paths, 26 tooling paths and four API/web manifest
and lock paths. It is not the source of all features added since 0.55.20.

### Meaningful changes from the published 0.55.20 baseline

The verified 0.55.20 source is
`6785200ff59ccbc12f62b795439fb245e1635480`, from successful
[publisher 33823450302](https://github.com/pranems/SCIMServer/actions/runs/33823450302).
Its public image manifest is
`sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a`.
This verifies the comparison baseline; it is not a new live read of customer
production. WIF, OAuth, custom resources and encrypted credentials already
existed in that baseline.

| Area | Cumulative change already merged to master |
|---|---|
| PATCH | Typed namespace/selector parsing; ordered operations against the evolving candidate; append/all-match handling; required/immutable enforcement; atomic rollback |
| Query and schema contracts | Filter/sort before projection; bounded JSON search arrays; stronger original/expanded profile validation; canonical output/internal-field removal; independent common/extension externalId semantics |
| Concurrency and lifecycle | Commit-time resource-version predicates, coordinated uniqueness, transactional Group/member writes, profile-change fencing and atomic endpoint deletion |
| Snapshot freshness | Database-owned endpoint UUID replaces repeated whole-row freshness hashing; verified snapshots avoid repeated body work while retaining post-lock checks |
| Group handling | Coherent reads, one-statement populated member replacement and preservation of accepted members.$ref through POST/PUT/PATCH/readback |
| Credentials | Visible bcrypt/keyed migration queue, active-only unfinished-work reporting, same-client-ID secret handover, atomic rotation, deactivate/reactivate and inactive-only permanent purge |
| Authentication | Dedicated bearer/OAuth flags, effective enablement in discovery, bounded issuer-indexed trust cache, JWKS isolation by complete policy and effective egress-policy provenance |
| Token and media-type contracts | Per-endpoint 60-604,800-second token lifetimes, default 3,600; OAuth responses remain application/json rather than SCIM media type |
| Operator workflows | Profile-derived User/Group/custom-resource forms, one authoritative editable request body, ETag-aware edits, dynamic custom-resource tabs, Workbench examples and context-preserving navigation |
| Layout and identity | Bounded responsive inventories, explicit column widths, panel scrolling, separate copy/open actions and full absolute UTC timestamps |
| Logs and dashboard | Endpoint-name history, custom-resource identity, URL-preserved filters, bounded SQL aggregation, serialized fan-out/in-flight sharing, cached activity/dashboard results and count-free latest reads |
| Privacy and errors | Startup no longer prints DATABASE_URL; stronger durable-history/public-secret boundaries, structured /Me filter escaping and sanitized repository errors |
| Delivery assurance | Owned disposable fixtures, backend parity, migration/live/browser controls, source/image provenance, physical dependency ownership and public-registry lockfile verification |

The full comparison changes 131 API runtime paths, 88 browser runtime paths,
12 database paths, 207 API test paths, 103 browser test/baseline paths,
267 documentation paths and the remaining workflow/tool/build paths.
These counts describe the cumulative release, not 251 alone.

There are **11 added migration directories, 19 to 30**:
credential type/active lookup; dedicated auth settings; case-insensitive
endpoint-name uniqueness with collision preflight; RequestLog endpoint-name
snapshot, URL trigram, activity-summary and timeline indexes; redundant-index
removal; table-specific autovacuum/analyze tuning; nullable accepted member
reference; and database-owned endpoint snapshot UUID/trigger.
The snapshot migration has a five-second lock limit and 30-second statement
limit. The UUID is not a public writable attribute. Applied history row counts
in restored source databases are a separate measurement from migration-directory
counts in these two source trees.

Key dependency changes include Hono 4.12.25 to 4.13.11,
`@hono/node-server` 1.19.10 to 2.1.3, multer 2.2.0 to 2.5.0,
fast-uri 4.1.2 to 4.2.3, Vite to 8.1.6 and Vitest to 4.1.11,
plus reviewed exact transitive security overrides. The Hono/Prisma-parent
qualification was performed and issue 256 is closed, not a current unresolved
adapter blocker. Root/API Dockerfiles are unchanged between the endpoint
trees, but mutable Node-24 base updates changed the actual published runtime:
0.55.20 has Node 24.20.0; 0.55.60 has Node 24.22.1.
The final 0.55.67 image/runtime is not established yet.

### What the performance failure actually means

[Qualification 40974749991](https://github.com/pranems/SCIMServer/actions/runs/40974749991)
ran October 29 against source `ff2d2377`, not the current reconciled tip.
Its frozen protocol compared identical 0.55.58 images first. A valid
same-image control requires ratios between `1 / 1.10` and `1.10`.
Only the first BAAB control block completed; three p95 comparisons failed:

| Operation | Baseline-role p95 ms | Candidate-role p95 ms | Ratio | Required interval |
|---|---:|---:|---:|---|
| Populated Group read | 4.107535 | 2.727228 | 0.6639573369428807 | 0.9090909 to 1.10 |
| Remove member | 35.750806 | 39.378554 | 1.1014731807724552 | 0.9090909 to 1.10 |
| Empty Group read | 6.665426 | 3.480782 | 0.5222144841158822 | 0.9090909 to 1.10 |

p95 means the 95th-percentile latency. The two apparently faster rows fail
because identical code should be repeatable within the control's bounds;
they are not measured product improvements. The block retained 16,000
timings and passed its functional/privacy/resource/cleanup checks.
The opposite-order same-image control, actual 0.55.20-versus-0.55.58 blocks
and final 0.55.66/0.55.67 image qualification did **not** run.
This result proves repeatability failure, not a measured final-product
regression and not final-product safety.

There was a separate genuine earlier application-cost problem:
the 0.55.56 common-runtime comparison failed 12/12 latency ceilings and made
110,614 database calls versus 53,372. PR 250 reduced repeated work while
retaining correctness checks and merged reviewed source without claiming the
operational hold closed. A later 0.55.58 run passed one ordering, but other
results remained inconsistent; a frozen Windows receipt retained add p99
+10.22% and empty-read p99 +25.98%. One passing receipt still had SQL
execution +37.14%, despite calls -4.10% and application CPU -8.02%.
Do not dismiss the entire concern as hosted-runner noise. Scheduling,
quota/history effects and database/logging work remain hypotheses requiring
request-level evidence, not established single root causes.

Current exact-tip correctness evidence remains strong but separate:
protected Validate 30/30 PASS; API units 6,254; HTTP 2,514 with 42 explicit
test skips/two skipped suites; web units 1,661; membership tooling 226 with
two skips; seven hosted ordinary checks; and the local 348-test zero-skip
browser acceptance. A PR test-image scan is not a final published release.

### Available images and genuine choices

| Version | Verified publication | Why it is not an automatic substitute |
|---|---|---|
| Requested 0.55.67 | PR test images, draft/unmerged source | No admitted final release |
| Merged 0.55.66 | Public version and exact merged-SHA references return MANIFEST_UNKNOWN; no official publisher for that tip found | Merged code is not an existing release image; inherited runtime/performance concerns remain |
| Published 0.55.60 | Successful publisher 39989347764; source 5bfff2dea1dec6f3e4b99c9a4cc0e6cb8e27388d | Same production API/schema/browser source as 0.55.58 onward; publication did not close the hold; later dependency corrections are absent |
| Published 0.55.20 | Verified original source/publisher/digest above | Downgrade compatibility with newer restored source databases is unproved; silently selecting it would not satisfy the requested upgrade |

The 0.55.60 manifest is
`sha256:316a645f021b5c9b833c295d94248e7df00ee37aa13d6d5614e55f9f04c83a4b`.
Public GHCR and publisher history were checked; absence claims do not cover
every private registry. Bypassing 251 avoids its experimental tooling merge
but does not eliminate application changes already merged through 250.

### Recommended next steps and operator input

1. Keep the requested 0.55.67 source identity and existing bounds. Finish a
   bounded review of retained raw rounds, with a falsifiable history/isolation
   hypothesis and a fixed experiment budget. Do not rerun unchanged hoping
   for green or loosen thresholds.
2. Use existing infrastructure first. The checked-in workflow runs on
   GitHub-hosted `ubuntu-24.04`; dedicated Linux/Azure hardware is an
   explicitly unapproved design proposal, not a coded prerequisite.
   Any protocol change must be prospective and explicit; any new paid
   infrastructure needs its own owner, cost and lifetime approval.
3. Resolve the release qualification, obtain the reviewed merge, publish from
   exact merged master, scan and record the immutable artifact.
4. Carry to isolated target databases with target writers stopped, preserving
   source IDs, settings, credentials and keys. Deploy dev, then run the
   documented stage-by-stage target matrix, including real auth, data
   contracts, cross-region latency and all browser settings/flows.
5. Promote the same digest to canary and repeat its applicable gates.
   Obtain operator visual acceptance. Establish source writer quiescence,
   take the final carry, revalidate, move clients and atomically change roles.
   Customer production remains excluded.

No new source-tenant sign-in, replacement account, credential disclosure or
paid-host approval is needed merely to continue the existing-resource
investigation. The operator decision is needed only if recovery speed now
takes priority over the specified latest release: authorize a separately
verified source-equivalent recovery deployment, then upgrade independently.
The actual source-version image availability/admission and restored-data
compatibility must be checked before promising that alternative. It is not
permission to substitute 0.55.60 or downgrade to 0.55.20.
Final client cutover additionally needs an agreed write-freeze window and
the list/owners of clients that must change URLs.

**Limitations:** no new benchmark or complete deployment suite was run for
this read-only investigation. No full transcript reconciliation, off-device
recovery proof or new live customer-production version read is claimed.
The optional knowledge graph is missing in the candidate worktree; run
`/understand` before graph-based blast-radius analysis or an overlay.
Git/source, hosted checks, retained raw evidence and actual target reads
provide the analysis above.

## 1. Verified identities and evidence

| Surface | Observed state |
|---|---|
| Source tenant | Provisioning IAM Team 09 |
| Source tenant ID | `9751e42f-78f3-42f4-8b8a-6e73845aceae` |
| Source subscription | `8cb58fd6-cf6f-4334-9fe0-3b12f93a6596` |
| Target tenant | Provisioning IAM Team 10, `proviamtest10.onmicrosoft.com` |
| Target tenant ID | `ea9f551e-8155-4010-87a8-b6fa1459f882` |
| Target subscription | `71091610-e5bc-44a6-bed7-ca4113b6520a`, `Proviam-Subscription` |
| Actual target account | `v-prasrane@microsoft.com` |
| Target-local directory identity | `v-prasrane_microsoft.com#EXT#@proviamtest10.onmicrosoft.com` |
| Target user object ID | `0d1f76ad-1aa4-4149-9564-eec03026059e` |
| Azure permission | Owner at the exact target subscription |
| Directory permission | Global Administrator, separately read from Microsoft Graph |
| Target resource groups | `scimserver-dev` and `scimserver-prod`, eastus, creation Succeeded |
| Target resource inventory | Source-shaped VNet, three subnets, shared Consumption environment and Log Analytics deployed and readback verified; two PostgreSQL 17 servers Ready and zero target apps confirmed November 3 |
| Registered providers | Microsoft.App, Microsoft.DBforPostgreSQL, Microsoft.OperationalInsights, Microsoft.Insights, Microsoft.ContainerRegistry, Microsoft.Network |
| Target interactive CLI profile | `%USERPROFILE%\.azure-proviam10-user` |
| Verified automation profile | `%USERPROFILE%\.azure-proviam10` |
| Deployment principal client ID | `307af53b-2ba3-459f-91c3-0ca9de9ba8b8` |
| Deployment principal object ID | `fa4246d9-5d5b-4956-ab6e-3cb119b59310` |
| Deployment credential expiry | `2027-10-31T03:22:07.7510239Z` |
| Directory grant | One requested role and one effective `Application.ReadWrite.OwnedBy` assignment |

| Target proof identity | Application ID | Verified token metadata |
|---|---|---|
| WIF | `e6c49b6a-3d39-4a00-82e8-727c6a3fecd3` | Version 1; exact target/client/audience; subject present |
| OAuth2 credentials | `66d57609-1da9-498a-a300-93a02a191ed5` | Version 1; exact target/client/audience; subject present |
| Secret token | `8470d307-7188-447a-88a5-7780b886ce14` | Version 1; exact target/client/audience; subject present |

Their observed issuer is `https://sts.windows.net/ea9f551e-8155-4010-87a8-b6fa1459f882/`.
The corresponding tenant key endpoint uses `/discovery/keys`, not
`/discovery/v2.0/keys`. No token or client-secret value belongs in this report.
All temporary `scim-migration-owned-proof-` registrations were confirmed absent;
the three named proof applications above are intentionally retained.

The new deployment credential, corrected proof records and target registry
are backed up separately in
`%USERPROFILE%\.scimserver-deploy\tenant10-bootstrap-20261031`.
All three DPAPI payloads were decrypted and byte-content roundtrip checked;
encrypted checksums are retained in `integrity.json`. This does not change
either immutable source recovery point or prove independent off-device recovery.
That initial three-file receipt is historical, not the inventory of later
allocation records. A separate immutable snapshot,
`snapshot-20261031T0451481074932Z`, now retains 19 verified checksums and seven
protected JSON roundtrips, including the current registry and all captured
failed-name/new-name database records. Original files and the initial receipt
remain unchanged. Allocation was still pending at this snapshot; it is not a
Ready-database or successful-carry recovery point.

The later consolidated snapshot `snapshot-20261031T0531151952158Z` retains
73 verified file checksums and eight protected JSON roundtrips. It includes
both Ready-server credential records, actual trial/connectivity receipts,
the current registry, all migration working files, four session helpers,
the working patch and a verified complete-history Git bundle at `eb733f61`.
`latest-snapshot.json` selects this snapshot without modifying earlier ones.
The migration code remains uncommitted; the bundle/patch/source copies are
recovery material, not a reviewed publication or an admitted application image.

At initial preflight, ARM name-availability checks passed for `scimserver-pg-dev-h6q2tf` and
`scimserver-pg-canary-c4k8rt`. The target subscription's eastus2 capability
response advertises PostgreSQL 17 and Standard_B1ms. This is preflight metadata,
not successful capacity allocation. No server or app has been provisioned.
Before provisioning, resolve the existing PostgreSQL template's secret-bearing
`databaseUrl` output and its deployment consumer together. Do not expose a new
administrator password in ARM output/history or command-line arguments.

**PostgreSQL provisioning correction confirmed:** the compiled template no
longer returns a secret-bearing URI. The existing deployment consumer now
uses a shared provisioning helper: secure parameters live only in a private
temporary directory, native arguments contain its file path rather than the
password, and the URI is encoded locally from non-secret outputs. The bootstrap
download includes both helper dependencies. Generated passwords are no longer
printed and interactive PostgreSQL password entry is masked. Four focused
default/explicit-zone/explicit-SKU/failure/missing-output cases pass, with complete private
parameter cleanup, after compiled-output disclosure RED.

Both initial PostgreSQL 17/B1ms allocations in eastus2 failed with Azure
`SkuNotAvailable`, despite the capability advertisement. Their credentials
were encrypted and roundtrip verified before allocation, and remain preserved.
Actual server reads showed Azure's `Dropping` cleanup state; the dev resource
was subsequently confirmed absent. No database data or application was carried.
The subsequent explicitly placed zone-1 dev allocation also failed. It used
the same SKU, region and preserved credential, rather than an unchanged retry.

**Allocation decision update:** the explicit zone-1 B1ms attempt also failed.
Both failed server resources were then confirmed absent. The decision form
returned that the operator was unavailable and delegated a pragmatic choice.
B2s, the advertised eastus2 default, was selected for both next estates to keep
the existing network location instead of adding a distant database hop. This is
not described as explicit operator budget approval. Public pay-as-you-go compute
prices are USD 0.017/hour for B1ms and USD 0.068/hour for B2s, approximately
USD 24.82 versus USD 99.28/month for two servers at 730 hours, excluding storage,
backups, discounts and taxes. The decision raises compute cost by approximately
USD 74.46/month and is recorded for review. Both B2s allocations subsequently
failed with `SkuNotAvailable`; no higher-tier database became Ready.

**Current allocation path:** capability metadata advertises B1ms in Central
US. Both `next` estates now select `centralus` / `Standard_B1ms`, avoiding the
proposed higher compute tier. The Container Apps environment remains in eastus;
cross-region application/database latency must be measured before acceptance.
An attempted reuse of the failed dev name returned `InvalidResourceLocation`
after a generic resource listing was empty. That proves an empty listing was
insufficient to establish cross-region name reuse; it does not establish the
cause or duration of Azure's retained location mapping. A later direct server
read returned `ResourceNotFound`.

The fresh planned names are `scimserver-pg-dev-m7j4rn` and
`scimserver-pg-canary-n8r5vk`. One controlled Central US dev allocation completed under its new name:
PostgreSQL 17 / Standard_B1ms is Ready and all four required extensions are
allowed after restart/readback. Canary allocation also completed with the same
verified version, SKU and four-extension outcome. Independent direct reads
confirmed both servers' actual `Central US` location and Ready state.
Failed-attempt credential records remain intact;
new records are scoped by estate and server name and roundtrip verified before
allocation. No existing server password was reset and no failed resource was
deleted. The launcher now requires an explicit direct server `ResourceNotFound`
response, rejecting Ready, Dropping, empty-success, authorization and transport
results. Six absence-decision regression cases passed after a semantic stale-
listing RED; the existing five private-provisioning cases remain GREEN.

**Azure trial:** real target app inventory is empty. The corrected copier now
requires an explicit `ConfirmNoTargetApps` choice and a successful empty
provider inventory before restoring without a named app; five decision cases
passed after RED. The Azure job image is pinned to the exact PostgreSQL digest
used by the existing preflight/snapshot tests, with an image-mismatch RED/GREEN.
The disposable trial uses two uniquely named databases on the new dev server,
never source-estate or application databases. The initial trial encountered an
installed-CLI argument mismatch and a missing private Container Apps logging
extension. The latter was installed only after that missing-tool failure.
Immediate generic-inventory cleanup also reported a just-deleted job still
present; a later provider read confirmed absence. Provider-based bounded
cleanup now passes 24 safety assertions after a pending-deletion RED, including
timeout rejection and preservation of other runs' jobs. A corrected real trial
completed as recorded below; no trial success is inferred from the mocked cases alone.

**Trial and real connectivity confirmed:** the corrected Azure trial now passed
seed, read-only preflight, exported-snapshot copy, post-copy value assertions
and exact owned cleanup. Both manifests contained two tables and had identical
SHA-256 `85c24f4856feab6430205a950e638e28a010828600cba03a1836c4ddb16833aa`;
the dump was 62,690 bytes. PostgreSQL assertions verified every one of 2,000
UUID/payload rows, the singleton JSON value and four extensions. This is a
synthetic disposable workflow trial, not a full SCIM database migration,
pending application-schema replay or encryption/reveal acceptance.

Both real source-to-next-database connectivity probes also passed through Azure
jobs using protected recovery credentials. Each source exposed nine tables;
both next `scimdb` databases were empty. The dev probe observed 76 endpoints,
1,607 resources, 33 credentials, one DEK, eight JWKS entries, 145 memberships,
one setting, 33 migrations and 374,886 request logs. Canary observed 65 endpoints,
1,146 resources, 18 credentials, one DEK, seven JWKS entries, 126 memberships,
one setting, 32 migrations and 24,164 logs. These are live read-only counts, not
full content equality or zero-loss proof. The different dev log count from the
earlier immutable capture is observed without attributing a cause; both recovery
points remain preserved. Each job ended with `DRY RUN COMPLETE` and verified
owned absence. No application database was written by these probes.

The exact 0.55.67 requirement is retained. The delegated decision does not
waive release admission or authorize substitution with 0.55.66.

Source ARM topology was read separately before target provisioning: VNet
`10.40.0.0/16`, delegated infrastructure/workload `/21` subnets and the private
endpoint `/24` subnet. The existing networking template matches these prefixes.
The actual environment has an explicit Consumption workload profile, public
ingress and Log Analytics; the environment template omitted the profile.
The compiled-template contract reproduced semantic RED, then passed after
explicitly declaring the existing source profile. This preserves topology,
not a new paid workload tier. Actual target resource readback remains required.

The target VNet was deployed through the existing compiled networking template,
after ARM validation, by the target's scoped automation principal. Exact CIDR,
all three subnet prefixes and both Container Apps delegations passed readback.
Microsoft.Network registration was performed separately by the already verified
target Owner account. No source networking was changed. Shared Consumption
environment `scimserver-env` and workspace `scimserver-logs` were deployed through
the corrected existing template after ARM validation. Actual environment
readback passed Succeeded state, exact target subnet, external topology,
Consumption profile and Log Analytics. No application image or database was
deployed, and no source/client routing changed.

This is not the separate Entra provisioning development tenant. Its account
preferences are not substituted into this hosting-tenant migration.

The earlier protected recovery package at
`%USERPROFILE%\.scimserver-deploy\rollover-20261030-verified` reverified:
68 file checksums, 53 protected payloads, and both restored databases.
A new source recovery point is restored and verified separately at
`%USERPROFILE%\.scimserver-deploy\rollover-20261030-resume`.
Neither capture is a final write-frozen cutover snapshot.

The fresh recovery point has 23 successfully decrypted protected artifacts and
25 checksum-verified files. Both databases fully restored in isolated PostgreSQL
with nine table-content fingerprints each, no invalid indexes and no unvalidated
constraints. Exact temporary containers, volumes and plaintext dumps were
removed. The earlier immutable package was not altered.

| Fresh restored table | Dev | Canary |
|---|---:|---:|
| Endpoint | 76 | 65 |
| ScimResource | 1,607 | 1,146 |
| ResourceMember | 145 | 126 |
| EndpointCredential | 33 | 18 |
| CredentialDek | 1 | 1 |
| JwksHostAllowlistEntry | 8 | 7 |
| ServerSetting | 1 | 1 |
| RequestLog | 375,676 | 24,164 |
| Prisma migration rows | 33 | 32 |

All eight non-RequestLog table-content fingerprints exactly match the earlier
snapshots in both estates. RequestLog counts and fingerprints differ between
these two capture times; both versions remain preserved. No cause for that
live-estate change is inferred, and no write-frozen zero-loss claim is made.
Restore timestamps are `2026-10-31T02:55:03Z` and `2026-10-31T02:56:39Z`.

**Recovery limitation:** Windows-user Data Protection API (DPAPI) protection is
verified on the capturing profile. Independent off-device/portable recovery is
not yet proved. Do not delete either recovery point or imply another machine
can decrypt it without an explicitly tested portable-recovery arrangement.

## 2. Changes since the August migration

Git comparison used the role-registry checkpoint `d0a2f0a8` and the requested
candidate `abdef720`. The scoped migration/schema/deployment comparison has
17 changed files, 939 insertions and 103 deletions. These numbers describe that
bounded file set, not the whole product.

| Existing surface | What changed or remained unchanged | Migration consequence |
|---|---|---|
| Full database carry | The core `rotate-tenant-data.ps1` and `replicate-estate.ps1` mechanisms remain the earlier PostgreSQL approach | Reuse them; do not replace them with API replay |
| Tenant lookup | CLI helper still duplicated registry IDs in a hardcoded map | Updated in this branch to derive identities, profile paths and scopes from the registry |
| Tenant selectors | Bootstrap/proof/consent scripts enumerated only previous tenants | Added the target key and exact-subscription-ID selection |
| Role cutover | Two separate role changes conflict with exactly-one-active validation | Added a tested simultaneous retire/activate option to the existing role helper |
| Prisma history | Twelve migration files were added in the scoped August-to-current comparison | Carry complete schema/history, then identify the actual pending migrations from each source; do not assume identical histories |
| Endpoint state | Database-managed `snapshotRevision` and new indexes are present in current schema | Preserve them in full dumps; compare shared source columns when upgrade migrations add columns |
| Audit records | Auth attribution, endpoint-name snapshots and timeline/summary/trigram indexes evolved | Preserve full RequestLog rows and verify indexes, not only resource totals |
| Startup | Direct Prisma CLI migration deployment and secret-safe configuration logging | Do not assume npm/npx exists in the runtime; retain fatal migration behavior |
| Release pipeline | Exact-source publication, digest parity, dependency ownership, failed-prerequisite guards and browser evidence have grown substantially | Use the current complete gate walk, not the August command sequence |
| Browser validation | Existing specs cover many surfaces but not an exhaustive settings/auth/provisioning product matrix | Inventory outcome coverage and close gaps before claiming complete validation |
| Candidate delta | Candidate serving/schema/UI/estate source matches reviewed master; the scoped schema/carry/pipeline diff from master is empty | The 0.55.67 label does not imply a different schema, nor admission |

### Carry-script corrections required before a real target restore

The existing carry script's target-quiescence block still treats an empty
replica read as stopped, ignores the update exit code, and sets a stopped flag
without proving all revisions have no replicas. It also restores a fixed
one-replica setting rather than the actual pre-carry state.

Those are not acceptable restore gates. Before using that path against an
existing target, add failing contract tests and require:

1. Exact target tenant/subscription/app identity and source/target separation.
2. Successful target quiescence, with explicit all-revision/replica readback.
   An unreadable replica result is UNAVAILABLE/FAIL, never proof of zero.
3. A successful complete dump and restore with fatal errors enabled.
4. Verified table-content/identity comparison, not size and counts alone.
5. Preservation of pre-carry target revision/scale state for recovery.
6. Private temporary secret files and verified removal of the exact owned job.
7. No restart into partially restored data after a failed restore without an
   explicit safe recovery disposition.

For initial trial/target filling, create the database before creating an
application writer. That avoids seeding races, but does not excuse unsafe
final-delta quiescence.

## 3. Step-by-step execution and stop conditions

```text
Verify tenant/account/permissions
  -> retain and refresh source recovery points
  -> review and test migration script corrections
  -> register providers and create non-serving target foundations
  -> prove a throwaway database carry and cleanup
  -> admit 0.55.67 source and one immutable release image
  -> restore parallel dev and canary with no app writers
  -> apply explicit pending migrations and prove data fidelity
  -> full dev gates, then canary gates using the same digest
  -> agree final source write freeze and fresh capture
  -> atomic registry cutover and actual client URL switch
  -> post-switch verification and retained recovery path
```

### Phase 0: preserve and stage

1. Verify the old recovery package and refresh both live source databases,
   application secrets and infrastructure settings without changing the source.
2. Keep the earlier backups immutable. Encrypt new captures separately and
   verify a full restore, all-table fingerprints and cleanup.
3. Stage tenant 10 as `next`; retain tenant 09 as active and customer production
   as permanent. Do not bulk-replace identifiers or FQDNs.
4. Close carry safety, target selection and atomic role-change gaps in the
   existing scripts using RED/GREEN tests, review and exact-tip checks.
5. Keep migration tooling separate from the existing 0.55.67 source union.
   Do not switch or alter the performance integration worktree.

### Phase 1: target foundations and directory bootstrap

1. Register the required resource providers and verify registration completes.
2. Create target `scimserver-dev` and `scimserver-prod` resource groups.
   These names are safe only because every command pins the new subscription.
3. Check actual PostgreSQL 17/Burstable capacity, name availability and quota.
   A SKU listing is not a capacity allocation or successful deployment.
4. Create a narrowly scoped deployment principal for these two resource groups,
   storing credentials outside Git with restrictive access. Record the actual
   app ID and expiry in the target registry after creation.
5. Apply the existing narrow `Application.ReadWrite.OwnedBy` consent step only
   for this new deployment principal and then verify its effective grant.
   Do not assign new directory roles to the user or touch customer production.
6. Recreate the three auth-proof applications and verify actual token issuer,
   subject, audience and application permissions. Issue new-tenant secrets;
   do not replay old directory object IDs.
7. Provision shared Container Apps environment, logging and network components,
   target ACR mirror if required by the unchanged full pipeline, and distinct
   PostgreSQL servers. Use current parameterized templates and generation-free
   globally unique names; validate the cross-resource-group environment ID.
8. Allow-list `CITEXT,PG_TRGM,PGCRYPTO,UUID-OSSP`. Preserve source settings that
   matter for behavior. Restrict target network access to the agreed runners.
   Do not change the source firewall as an authentication workaround.

### Phase 2: throwaway trial carry

1. Use a clearly identified disposable target database/estate, not dev/canary.
2. Restore a full source snapshot with no application replica writing.
3. Compare every table's row counts and content fingerprints against that exact
   snapshot, plus primary/SCIM IDs, membership, DEKs, credential envelopes,
   singleton settings, JWKS hosts, constraints and index validity.
4. Read each source's actual Prisma migration names/checksums. Prove the pending
   upgrade migrations on a restored copy before applying them to a target.
5. Compare original shared columns after upgrade; separately allow only the
   documented migration-owned changes/new columns/indexes and history entries.
6. Prove retained credential authentication and reveal behavior with the same
   effective encryption key. Source images currently use their documented
   default key fallback; key-policy rotation is not folded into this move.
7. Test failure/cleanup/recovery cases. Verify the exact temporary resources are
   removed. Remove the trial registry entry before activating the tenant, since
   multiple same-purpose estates would fail the active-role invariant.

### Phase 3: 0.55.67 release admission

1. Preserve the retained failed performance evidence and current draft status.
   Do not rerun the same failed campaign until it happens to pass.
2. Resolve the qualification hold through the separately approved prospective
   environment/protocol route in the qualification design, retaining bounds.
   A dedicated runner and spending/protocol changes need their own approval.
3. Require reviewed source, required exact-tip CI, actual qualification
   admission, and a normal merge to master. Skipped campaign jobs do not pass.
4. Build/publish from that merged source and verify OCI source/version
   provenance, scan results and the immutable GHCR digest.
5. Promote that same digest to dev and canary. No local rebuild, branch-only
   image, mutable `latest` substitution or source-only merge exception.

**Stop here if admission is unavailable.** Empty target foundations may remain
prepared, but no 0.55.67 application deployment or completed migration is claimed.

### Phase 4: parallel target restoration and upgrade

1. Restore dev and canary independently while their target application writers
   are stopped or not yet created. Never mix their databases or settings.
2. Verify source-schema content before startup can seed or upgrade rows.
3. Apply the trial-proven pending migrations using the final image's direct
   Prisma CLI. Require zero failures and valid resulting schema/indexes.
4. Inject new target database URIs and preserve effective auth/encryption
   material. Do not expose secrets in terminal arguments, JSON reports or Git.
5. Update only deliberately old-hosting-tenant-dependent WIF/proof issuer and
   app references. Preserve external ISV/customer tenant IDs and trust settings.
6. Create/start target applications with the admitted 0.55.67 digest and verify
   exact revision readiness, digest and intended traffic routing.

### Phase 5: full dev, then full canary validation

Use the current full deployment-pipeline stages with no `-Skip*` flags, or its
complete manual gate walk with an explicit per-gate result file. Before running
it, remove source-tenant defaults from the execution context: pin target
subscription/profile, target URL and ACR; do not let active-purpose lookup
auto-promote purplecliff while tenant 09 is deliberately still active.

| Stage | Required evidence |
|---|---|
| 0 | Migration changes have observed RED failures, minimal GREEN and safe refactor evidence |
| 1 | API/web build and type/lint, size budgets, schema/migration replay checks, docs, supply chain, base-image support, script static gates |
| 2 | Complete API unit/E2E, web unit/coverage and owned six-mode persistence matrix; explicit skips assessed, not hidden in a pass total |
| 3a | Unit/HTTP/live completeness, response-key contracts, error/status/SCIM diagnostics |
| 3b | Logging/PII, RFC, registered settings/UI reachability, security/dependency and performance evidence |
| 3c | Changed-code/design audit, documentation, execution RCA and coverage gap disposition |
| 4 | Local/Docker integration, immutable release/source/digest proof, live target HTTP/auth tests, migrations and deployed infrastructure checks |
| 5 | Full browser suite, measured layout, accessibility, visual-diff inspection and audited URL/image/source-bound evidence |
| 6 | Integrity, source/target ID/settings comparison, registry-based retention, cleanup and immutable report/artifact |

Run dev first, then the same digest against canary with full live/auth/browser
and data-integrity verification. Canary approval is not customer-production
approval. A FAIL, required SKIP, PARTIAL, missing receipt or unverifiable identity
blocks cutover; no aggregate phrase such as "all tests passed" replaces the table.

### Phase 6: final synchronized switch

1. Coordinate a source write-freeze window with other sessions and provisioning
   clients. Freeze test writers on the new targets as well.
2. Capture fresh final databases/configuration, restore the final delta and
   repeat fidelity/upgrade checks. Do not use today's snapshot as zero-loss proof.
3. Complete dev/canary acceptance and obtain operator visual verification for
   affected UI surfaces. Do not declare UI ready from automated green alone.
4. Perform one validated atomic active/retiring registry write, preserving all
   source entries and the permanent customer tenant.
5. Derive new URLs from target ARM. Update actual Entra provisioning client URLs,
   proofs/callbacks and genuinely coupled CI settings using a private mapping.
6. Verify public URLs, auth, real provisioning, user/group/custom-resource IDs,
   memberships and settings after switch. Keep two revisions per dev/canary.
7. Keep purplecliff intact until acceptance and the recovery decision. Routing
   back after new writes requires reconciliation; otherwise recover forward.

## 4. Browser outcome acceptance, not presence-only coverage

The candidate has only Chromium configured, three workers and zero retries.
The full configured command is `npx playwright test --reporter=line`.
The existing suite is not evidence of Firefox/WebKit testing.

For each local, Docker, new dev and new canary target:

- Bind the run to the actual URL, admitted source SHA, immutable digest and
  revision. Inject test credentials through process memory.
- Run the complete configured suite, not just a route smoke subset.
- Record executed/passed/failed/skipped counts and missing coverage separately.
- Assert actual saved values, backend effects, row/drawer contents, response
  bodies, auth behavior and navigation restoration.
- Measure table/column/truncation bounds at wide and narrow viewports. CSS
  properties and visible test IDs are not layout correctness evidence.
- Inspect every visual diff before any intended-baseline update. Retain traces,
  screenshots and reports without secrets.
- Add regression specs for uncovered outcomes before accepting the surface.

Required surface inventory includes dashboard; endpoint inventory/create/edit;
all thirteen nested endpoint routes; global logs/settings; manual provisioning;
profile; discovery; operations; workbench; token gate; keyboard/palette/theme;
loading/error/recovery; auth diagnostics; and resource lifecycle flows.

Settings acceptance must cover each declared control's published/default value,
change/save/reload/reset path and relevant runtime effect, not just its existence.
Test all auth families and User/Group/custom-resource journeys, plus high-risk
combinations involving uniqueness, mutability, PATCH filtering, bulk fail-fast,
credential retention/lifetime, WIF/egress controls and schema overrides.

An unbounded "every possible combination" claim is not measurable. Create a
finite auditable matrix containing all controls and required use cases, explicit
pairwise interactions, and the full selected high-risk combinations. Any missing
cell remains unverified rather than being covered by a green smoke test.

The source inventory found **50 Playwright spec files**, **25 registered route
nodes** (12 top-level entries including the endpoint layout, plus 13 endpoint
children). Its earlier manual setting count was incorrect. The executed
registry-derived inventory on 2026-11-02 proves **38 unique definitions**:
20 boolean, 2 enum and 16 numeric. These are definition counts, not 38
independently editable switches or proof of every backend effect.
`PersistRequestSecrets` is a fixed always-redacted policy, authentication
flags can be managed by Connect, and two numeric definitions use the specialized
token-lifetime editor. Tests import the actual registry instead of transcribing
these counts or treating documentation as a control.

| Surface | Existing evidence | Acceptance gap |
|---|---|---|
| Bulk | Four new execution journeys include exact mixed status mapping, persisted successful users, corrected-row retry, failed-row-only CSV download, malformed CSV rejection and measured result fields at 1440/900px | Actual target execution and broader auth/fail-fast combinations remain required |
| Manual Provision | New execution journey proves User and Group persistence, actual duplicate conflict, corrected retry, tab-result reset and navigation to the created resource; inactive target issues no mutation | Actual target and remaining auth combinations are not proven |
| My Profile | `global-history-workflows.spec.ts` proves shared-secret preflight does not send `/Me` | This is a real negative-request test, not proof of editing, validation or a `/Me` round trip |
| Endpoint settings | Runtime inventory proves 38 definitions. Existing settings/related-settings specs pass. Sixteen added numeric cases prove valid commit, independent admin readback/reload and lower/upper rejection with zero invalid PATCH requests | Every required backend effect and selected high-risk interaction still needs explicit target evidence; source counts and persistence alone are insufficient |
| Other routes | Existing navigation, state, lifecycle and geometry specs | Broad route coverage does not prove every data value, responsive/accessibility case or cross-resource combination |

The actual authoritative zero-skip check lives in Stage 5.3 of
`dev-deployment-pipeline.ps1`, not a separate frontend auditor. It runs the full
suite with `--reporter=line,json`, sets `E2E_ALLOW_MUTATIONS=1` and
`E2E_SHAPE_COVERAGE=1` for an owned test estate, requires exit zero and rejects
nonzero `stats.skipped`. The pipeline's earlier stages provide separate image/
source checks. The browser JSON alone does not prove the deployed digest or
image source; bind those receipts explicitly in the migration report.

No Playwright run has yet been performed against tenant 10. The complete
settings/use-case matrix and missing regression specs remain acceptance work,
not a completed validation claim.

### Local browser evidence, 2026-11-02

The first guarded full in-memory run remains **FAILED**: 303 passed, 25
skipped, four failed and zero flaky. Its reports, screenshots and transport
traces are retained separately. Matching the actual OAuth fixture, serving
the built production frontend and serializing browser execution are explicit
environment changes, not repeated unchanged attempts until a lucky PASS.

The later complete seeded PostgreSQL production-preview run passed **319**
with **13 visual opt-out skips**, zero failures and zero flaky in **689.65s**.
The 13 explicitly enabled local visual comparisons then passed in **22.76s**
with zero skips and `--update-snapshots=none`. Existing Operations geometry,
all nine shape cases, 16 existing settings-matrix cases, four related-settings
cases and four JWKS-host cases passed in that complete run.
The focused mutation-enabled group also passed 12 tests in 24.3s.

The added [numeric persistence spec](../../SCIMServer-tenant10-browser-acceptance-20261101/web/e2e/settings-numeric-persistence.spec.ts)
passes all **16** numeric definitions, including both token-lifetime editors,
with admin value readback and reload retention. Values one below minimum and
one above maximum produce visible validation errors, retain the prior saved
value and send zero endpoint-update requests. The completed boundary run
took **46.88s**, with zero failures, skips or flaky cases.
The [execution spec](../../SCIMServer-tenant10-browser-acceptance-20261101/web/e2e/bulk-and-manual-execution.spec.ts)
now verifies the downloaded failure CSV header and the exact duplicate row,
and proves neither successful operation is included. This focused case passes.

The authoritative combined run with mutation, shape and visual opt-ins together
**passed 348 tests, zero skipped, zero failures and zero flaky**, exit 0.
It started at `2026-11-02T12:22:41.258Z` and took **748.09s**. Its completed
report is `test-results/prisma-seeded-production-all-gates.json` in the
isolated browser worktree. This is a real single-run count, not the sum of
separate focused runs. Its command, from the browser worktree's web folder:

```powershell
npm run test:e2e -- --reporter=json --workers=1 `
  --update-snapshots=none `
  --output=..\test-results\prisma-all-gates-output
```

`E2E_ALLOW_MUTATIONS=1`, `E2E_SHAPE_COVERAGE=1` and
`E2E_VISUAL_BASELINES=1` were explicitly set on this owned local test estate.
The candidate release worktree is still clean at exact `abdef720`; only the
isolated browser starter and two added specs differ. No screenshot baseline
was created or regenerated.

These tests use an owned empty-
then-seeded PostgreSQL database and the exact candidate's built frontend/API
on loopback; they are not full restored-corpus acceptance, Docker compose
acceptance, Azure acceptance, image admission or operator visual verification.

## 5. Execution log and issues

### Current gate receipt

| Check | Current result |
|---|---|
| `pwsh -NoProfile -File scripts\test-tenant-registry-resolution.ps1` | PASS, 24 assertions |
| `pwsh -NoProfile -File scripts\test-tenant-cutover.ps1` | PASS, 14 assertions after observed missing-parameter RED |
| `pwsh -NoProfile -File scripts\test-scim-estates.ps1` | PASS, 15 existing registry controls |
| `pwsh -NoProfile -File scripts\test-tenant-copy-safety.ps1` | PASS, 24 assertions covering strict reads, revision suspension/resumption, private scratch, ownership and bounded provider cleanup |
| `pwsh -NoProfile -File scripts\test-tenant-copy-snapshot.ps1` | PASS, real PostgreSQL extra-table rejection, 2,000-row content fidelity and concurrent-write snapshot isolation |
| `pwsh -NoProfile -File scripts\test-tenant-copy-preflight.ps1` | PASS, immutable deployed/tested image, alternate-password parity and failed table-enumeration rejection after observed RED |
| `pwsh -NoProfile -File scripts\test-tenant-copy-no-apps.ps1` | PASS, five explicit app-inventory decisions after RED |
| `pwsh -NoProfile -File scripts\test-tenant-copy-log-transport.ps1` | PASS, missing/present actual command and process-preference restoration; real target-profile command preflight also passed |
| `pwsh -NoProfile -File scripts\test-tenant-postgres-absence.ps1` | PASS, six direct-read absence decisions after RED |
| `pwsh -NoProfile -File scripts\test-tenant-postgres-provisioning.ps1 -BicepPath <existing compiler>` | PASS, compiled secret-output rejection and five default/zone/SKU/failure/output/cleanup cases |
| `pwsh -NoProfile -File scripts\test-tenant-credential-storage.ps1` | PASS, missing-file rejection and private/idempotent ACL protection |
| `pwsh -NoProfile -File scripts\test-tenant-directory-grant.ps1` | PASS, effective consent, explicit failures, duplicates and idempotent request reconciliation |
| `pwsh -NoProfile -File scripts\test-tenant-proof-metadata.ps1` | PASS, seven version/issuer/key/invalid-claim cases after observed RED |
| Actual directory bootstrap and three proof tokens | PASS for target directory outcomes only; target SCIM auth remains NOT RUN |
| `pwsh -NoProfile -File scripts\test-tenant-environment-template.ps1 -BicepPath <existing compiler>` | PASS, actual compiled resource declares the source Consumption profile and Log Analytics after semantic RED |
| PowerShell parser | PASS, latest 35 changed/session scripts; zero parse errors |
| Private Node replay syntax and focused tests | PASS, fourteen provenance/lifecycle/archive-parity tests; zero skipped tests |
| Original/candidate canary crypto comparison | PASS, the same four strictly inactive archived failures; all six active retained credentials authenticate, and actual original/candidate archived controller responses match |
| `pwsh -NoProfile -File scripts\audit-deployment-doc.ps1` | PASS, static C1/C2/C3 only; not a deployed `-Live` result |
| `git diff --check` | PASS at script/static consolidation |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1` | PASS, 27 documents after closing two F4-coupled deployment-guide gaps |
| Literal JSON fences in updated migration/deployment guides | PASS, one literal block parsed; no diagram content edited |
| Fresh database restore helper, both estates | PASS, complete disposable restores and cleanup |
| Fresh DPAPI/checksum integrity and old/new table fingerprints | PASS as recorded in section 1; logs differ between snapshot times |
| Complete API/web/backend matrix on the migration tip | NOT RUN; retained candidate correctness evidence is a separate claim |
| Admitted 0.55.67 release source and shipping digest | BLOCKED |
| Actual target PostgreSQL readiness | PASS, both Central US/17/B1ms servers and four-extension readbacks |
| Actual disposable Azure workflow trial | PASS, seed/preflight/copy/value assertions and owned cleanup; synthetic data only, not a full source-schema/runtime trial |
| Actual real-source connectivity | PASS, both nine-table sources to empty next databases; read-only, no data carry |
| Full source database carry, pending migrations and encryption/reveal acceptance | Both local full-corpus replays PASS, preserving original content/IDs/history; both strict Prisma schema-model diffs are empty. Dev verifies 24 envelopes, canary six, with four inactive archived failures explicitly preserved under the original response contract. Both real full-source Azure disposable transfers now PASS with nine-table fidelity and exact cleanup. Final frozen carry and candidate runtime/HTTP acceptance remain pending |
| Full dev/canary deployment-pipeline stages | NOT RUN; no admitted target application image |
| Full measured Playwright, settings/use-case matrix and operator visual acceptance | NOT RUN; no target application deployed |
| Final freeze, client switch, atomic registry cutover and post-switch checks | NOT RUN |

These results do not constitute full validation or a completed migration.
Latest replay consolidation also passed 27-document freshness, static
infrastructure C1/C2/C3 and whitespace checks. The new immutable recovery
snapshot retains all four replay attempts, including explicit failed outcomes,
protected logs/baselines/diagnostics and eight current session tools.
Retrospective summaries for the first two failed attempts are marked as such;
original protected logs remain authoritative. Exact checksum counts and the
snapshot folder are recorded in the private `latest-snapshot.json` and
`snapshot-integrity.json` receipts, not inferred from these prose totals.
The later continuation retains six attempts, nine session tools and the
actual archived-controller contract receipt. Both complete local replays pass;
GitHub reports zero registered self-hosted runners and unchanged draft PR #251.
No benchmark infrastructure or campaign was allocated.
The current immutable snapshot is `snapshot-20261101T0604363097526Z`:
122 verified checksums, 44 protected byte roundtrips and 20 JSON checks.
The later runner-authorization form returned operator-unavailable text in
every field, not an approved owner or numeric spending limit. No provisioning
or qualification rerun follows from that response.

### Qualification preparation without spending approval (2026-11-01 UTC)

PR [#251](https://github.com/pranems/SCIMServer/pull/251) remains OPEN/DRAFT at
`abdef7207428ec26ce54e76ec0e26a08921ea6ea`. Ordinary checks are successful;
diagnose, profile and qualify are skipped. No admission or shipping-image
claim follows from those checks.

The operator-unavailable response is handled as permission to prepare a
proposal and public estimate only, not to buy or provision a runner. No
compute resource, quota request, protocol change, benchmark rerun or threshold
exception is authorized or performed here.

A concrete environment to evaluate is one Linux VM on a subscription-exclusive
Azure Dedicated Host, with an ephemeral least-privilege runner registration
and only the approved synthetic qualification workload. Microsoft documents
that no other customer's VMs are placed on the host, but networking and
underlying storage remain shared. This is a candidate environment, not proof
of guest-to-physical CPU affinity or successful tail-latency qualification.
The original images, quotas, workload definitions, samples and reciprocal
1.10 limits must remain fixed unless a separate prospective review changes
them.

| Public indicative option | Observed retail rate | Illustrative host-only cost | Still unverified |
|---|---|---|---|
| Central US, `Dadsv5_Type1`, consumption Dedicated Host | USD 7.17 per hour, primary regional meter | Two hours: USD 14.34; eight hours: USD 57.36 | Actual negotiated price, tax, disks/network/licensing, subscription quotas, regional allocation and required isolation/observability |

The time examples are arithmetic, not an approved duration or monetary
ceiling. Billing is per host even when guest VMs are stopped; deleting the
owned host and verifying its absence must be part of any approved cleanup.
The Azure pricing MCP could not initialize because its executable was locked
(`EBUSY`). The public retail API was read successfully instead; the shared MCP
installation and other users' processes were not changed.

Sources:

- [Dedicated Host isolation, quotas and billing](https://learn.microsoft.com/en-us/azure/virtual-machines/dedicated-hosts/overview).
- [Azure public Retail Prices API](https://prices.azure.com/api/retail/prices),
  read on 2026-11-01 UTC with service `Virtual Machines`, region `centralus`,
  product containing `Dedicated Host`, and consumption pricing. The returned
  `Dadsv5 Series Dedicated Host` / `Dadsv5 Type1` meter is USD 7.17 / `1 Hour`.

Next approval must name the accountable owner, all-in cost ceiling, fixed
wall-time limit, acceptable isolation evidence, prospective protocol and
cleanup authority. Before any measurement, test rejection of unavailable
isolation, wrong image identities/quotas, missing samples and failed cleanup.
An unavailable capability remains a stop, not a success-shaped substitute.

### Isolated full-source replay investigation

The first dev rehearsal restored the complete protected source database into
an owned PostgreSQL 17 container published only on IPv4 loopback. It failed
before running Prisma at
`20260416025138_add_requestlog_perf_indexes`: the stored applied checksum did
not match the current candidate file. The private failure logs were protected
and the owned container, volume and plaintext scratch were removed.

The current migration file explicitly describes removal of originally
generated schema-drift operations. That comment alone does not establish the
source checksum's provenance or database compatibility. The test-only probe
now distinguishes current-file equality from a checksum matching an immutable
Git ancestor of the exact candidate. It records any historical mismatch
explicitly, rejects unknown checksums and Git failures, and still requires
every original migration row to remain byte-content equivalent after replay.
It never rewrites stored checksums, marks a failed migration resolved or
edits candidate source.

Six focused provenance tests pass: line-ending variants, an explicit
historical-difference receipt, historical CRLF, unknown-checksum rejection,
empty-history rejection and Git-error propagation. The second dev rehearsal
passes: it applied `20261020160000_add_endpoint_snapshot_revision`, preserved
all original values/IDs in all eight non-history tables and every original
migration-history row, and verified all 24 revealable credential envelopes
(nine legacy bcrypt, 15 keyed) using the original DEK and effective keys.
All 33 credential records are content-preserved; nine without retained
envelopes were not claimed as plaintext authentication/reveal proofs.

The stored April checksum is
`2468da04e42a9ce38dac7f2fad6c6229f1b89c056aeecf363d50c75d55d2dae2`,
matching `f9c6d3cddc4f121f63b60e3be6226654df915fc4`. Direct Git ancestry
verification passes. The narrowly inspected rewrite guards the same
cleanup/index operations with `IF EXISTS` / `IF NOT EXISTS`; no original
history was rewritten during rehearsal. Canary rehearsal stopped before Prisma.
Independent schema-model/HTTP acceptance in Azure has not run. Local replay,
target Azure acceptance and release admission remain separate gates.

### Canary retained-secret defect found before migration

The complete canary restore contains 18 credential records, ten with retained
envelopes, one persisted DEK and all nine source tables. The effective source
KEK unwraps that DEK successfully. Six envelopes decrypt and authenticate
under the candidate: one legacy bcrypt and five keyed credentials. Four
envelopes fail AES-GCM authentication: three OAuth-client credentials and one
bearer credential.

The exact retained original canary image
`sha256:42613fe093bcb770c8eec849f2ac8840afa1b0ca85a1b8baf98efa33665745f9`
was run only as a network-disabled, stdin-fed crypto probe, without starting
the application. Its actual crypto module fails on the same four credential
IDs. This proves a pre-existing source envelope/key compatibility defect, not
one introduced by candidate migration. It does not establish whether the
mechanism was historical key replacement or ciphertext alteration.

**Why this matters:** a byte-perfect database carry preserves these existing
reveal failures. It cannot recover an unavailable original key or repair an
authenticated ciphertext. These four admin reveal failures do not by
themselves prove normal credential authentication is broken; authentication
uses stored hashes separately.

No pending canary migration was executed, no credential or key was changed,
and no failure was waived. The complete diagnostic and original/candidate
identity comparison are protected. The exact replay container and plaintext
scratch were verified absent; the original-image helper also verified its
owned cleanup.

An initial diagnostic patch incorrectly checked aggregated failures inside
the loop, so its candidate tally was incomplete. New first/last-failure and
all-failed tests reproduced two meaningful RED assertions, including an
all-failed false-success path. Moving the decision after the loop made all
nine provenance/diagnostic tests GREEN. The rerun measured all ten envelopes
and all four matching source/candidate failures. The partial intermediate
diagnostic is retained as such, not accepted as complete evidence.

**Updated disposition after lifecycle and contract verification:** all four
records are inactive credentials on one test endpoint. The connection-secret
resolver selects active credentials only. The actual original and candidate
admin controllers also return the same explicit `retained:false` reason and
error audit for an inactive undecryptable bearer or OAuth credential; field
allowlists and values match in method-level fixtures. This is not an HTTP or
browser test, and those remain separate target gates.

The initial probe over-constrained faithful migration by requiring every
historical inactive ciphertext to become decryptable. The corrected gate
permits only explicitly recorded archive parity: an immutable original image,
identical original/candidate failed IDs, every failed credential strictly
inactive, and at least one successfully authenticated active retained
credential. Any active failure, new failure, unmatched identity or all-failed
corpus still fails. No record is repaired, deleted, reactivated or omitted.
The receipt explicitly says not all retained envelopes are decryptable.

Both complete isolated replays now pass. Dev authenticates/reveals 24
envelopes, including 17 active records; canary authenticates/reveals six active
envelopes and preserves the four archived failures. Both apply the one pending
snapshot-revision migration, preserve every original value/ID/migration row,
and produce empty strict Prisma schema-model diffs. Fourteen focused controls
pass, including active-failure rejection and all-failed-corpus rejection.
The source-archive question no longer blocks local faithful replay. Release
admission and actual target HTTP/browser acceptance remain blocking gates.

Only the two October source recovery packages and the target bootstrap
directory exist in the authorized deployment-recovery root. No older key
package was found there, and no credential history or unrelated locations
were searched. No recovery or rotation is needed to preserve this archived
source behavior.

| Date | Observed result |
|---|---|
| 2026-10-30 | Earlier recovery package reverified: 68 checksums and 53 protected artifacts |
| 2026-10-30 | Normal isolated browser login succeeded for exact tenant 10; Azure Owner and Entra Global Administrator verified independently |
| 2026-10-30 | Empty target subscription resource-group inventory; required providers initially not registered |
| 2026-10-30 | New next-tenant definitions staged; source/permanent roles unchanged |
| 2026-10-30 | Registry-based lookup RED observed for unknown future key; GREEN 24 assertions including target selectors and exact subscription selection |
| 2026-10-30 | Atomic cutover RED observed for absent paired-retirement parameter; GREEN 14 assertions including permanent-tenant protection and WhatIf byte preservation |
| 2026-10-30 | Existing registry negative/positive controls remain GREEN 15/15 |
| 2026-10-30 | Five target providers registered; both eastus resource groups created with exact target tenant/account guards; resource inventory remains empty |
| 2026-10-30 | Fresh encrypted dumps captured: dev 771,564,228 bytes and canary 38,008,220 bytes before encryption; isolated full-restore proof started |
| 2026-10-30 | Requested candidate source/ordinary checks verified, but 0.55.67 release admission remains blocked |
| 2026-10-30 | Release-prerequisite decision requested; operator unavailable. Default is to retain 0.55.67 requirement and prepared target, not authorize a different release or a new qualification campaign |
| 2026-10-31 UTC | Both fresh full restores passed with nine table fingerprints each and zero invalid indexes/unvalidated constraints; 23 protected artifacts and 25 checksums verified; private scratch and containers cleaned |
| 2026-10-31 UTC | Eight non-log table fingerprints per estate exactly match the earlier recovery point; changed live logs are preserved in both snapshots |
| 2026-10-31 UTC | Copy suspension/cleanup tests passed; real exported-snapshot copy rejected an orphan table and retained all 2,000 seeded rows while excluding a later source write |
| 2026-10-31 UTC | Target deployment principal, two scoped Contributor grants and private credential verified; automation login passed |
| 2026-10-31 UTC | Exact Graph app-role assignment and one requested role verified; owned-app update value and deletion readback passed; temporary registrations cleaned |
| 2026-10-31 UTC | Three auth-proof applications created through automation; each acquired a real token; issuer mismatch detected and corrected with seven RED/GREEN regression cases |
| 2026-10-31 UTC | Seven focused script runners passed; 17 scripts parsed; whitespace, static deployment-doc and execution-plan JSON/link checks passed |
| 2026-10-31 UTC | Three target bootstrap payloads encrypted and decrypted with byte-content roundtrip verification, separate from source backups |
| 2026-10-31 UTC | Both planned PostgreSQL names available through ARM; target eastus2 capability metadata advertises PostgreSQL 17/B1ms, not allocated capacity |
| 2026-10-31 UTC | Source VNet/environment topology read; compiled environment profile RED/GREEN passed; sixth provider Microsoft.Network registered under exact target Owner identity |
| 2026-10-31 UTC | Target VNet deployed through existing networking template and actual three subnet/delegation outcomes verified; shared environment deployment started with no application image |
| 2026-10-31 UTC | Shared Consumption environment and Log Analytics deployment completed; actual Succeeded/subnet/public/profile/logging outcomes verified, with no application or database deployment |
| 2026-10-31 UTC | Final 18-script parser and static infrastructure checks passed; doc freshness returned GREEN for 27 documents after Azure/sovereign guide updates; one literal JSON fence parsed and whitespace check passed |
| 2026-10-31 UTC | Both eastus2 B2s allocations failed after B1ms/default and explicit-zone failures; no database became Ready |
| 2026-10-31 UTC | Central US/B1ms selected for both next estates; cross-region name reuse rejected by ARM despite an empty listing; later direct old-dev read returned ResourceNotFound; new-name dev allocation started |
| 2026-10-31 UTC | Direct PostgreSQL absence guard reproduced stale-list semantic RED, then passed six decisions; all five safe-provisioning cases remain GREEN; failed-attempt recovery records retained |
| 2026-10-31 UTC | Exact PR #251 head abdef720 remains OPEN/DRAFT; ordinary checks pass while diagnose/profile/qualify remain SKIPPED; no release admission or cutover inferred |
| 2026-10-31 UTC | Focused consolidation passed: 27-document freshness, 25-script parser, whitespace, 15/15 registry controls; execution plan contains no literal JSON fences |
| 2026-10-31 UTC | Immutable target-bootstrap snapshot saved separately: 19 checksums and seven protected JSON roundtrips, including current registry and retained old/new allocation credentials |
| 2026-10-31 UTC | Both fresh-name Central US PostgreSQL 17/B1ms servers completed restart/readback with all four extensions; independent direct state/location/version/SKU checks passed |
| 2026-10-31 UTC | Empty target app inventory verified; absent-app decision tests 5/5, immutable-image/preflight GREEN, and provider cleanup/revision/private-scratch tests 24/24 |
| 2026-10-31 UTC | Real synthetic Azure copy/verification passed: 62,690-byte dump, identical two-table manifest hashes, all 2,000 UUID/content rows plus singleton/extensions correct; owned jobs/databases cleaned |
| 2026-10-31 UTC | Dev and canary real source-to-target dry runs passed with nine source tables and empty next application databases; source read-only, no actual source data carry |
| 2026-10-31 UTC | Executable log-dependency gate GREEN after semantic RED; actual private target-profile preflight passed; final provider inventory shows no jobs and exactly two Ready Central US servers |
| 2026-10-31 UTC | Final focused consolidation: 30 scripts parse, 27-document freshness, static infrastructure C1/C2/C3, 15 registry controls and clean whitespace |
| 2026-10-31 UTC | Consolidated immutable bootstrap/tooling snapshot: 73 checksums, eight protected JSON roundtrips, 37 migration working files, four session helpers and verified base Git bundle; source recovery packages untouched |
| 2026-11-01 UTC | Full dev source-to-disposable-target Azure transfer started on the existing next server. Source remains read-only; no target application, routing change or final carry. Exact job `scim-pgcopy-f5cb65b3e33b`, execution `scim-pgcopy-f5cb65b3e33b-7ns05gf`; source snapshot fingerprinted, 761,016,535-byte dump completed, restoration still running at 06:32 UTC |
| 2026-11-01 UTC | Duplicate-source manifest acceptance reproduced as semantic RED; corrected actual validator passes eight JSONL acceptance/rejection cases. The running transfer loaded the earlier wrapper, so its final receipt may need independently verified transport adaptation rather than repeating a successful copy |
| 2026-11-01 UTC | Existing-database overwrite risk reproduced as semantic RED in the actual creation block. Four lifecycle decisions now pass: reject existing names, reject inventory failures, persist create intent before the provider call, and clean the owned database after a lost create response |
| 2026-11-01 UTC | Dev worker Succeeded at 06:34:47 UTC with nine tables and equal manifest SHA-256 `45e5c400c307b99d21d86827675d747c7f458eefe0cdecd194cab7960860be2c`. Earlier wrapper returned the expected JSONL false-negative; retained real evidence independently passed the corrected validator. Exact job/database absence, no target apps and protected-only log verified at 06:36:54 UTC. No duplicate dev copy |
| 2026-11-01 UTC | Canary-only corrected transfer PASS: 37,988,116-byte dump, nine tables and equal manifest SHA-256 `02925dba4f117ebe8e418c38fdeacf6fc1ed1ff67bd8ebcc6f0245016bb759ca`; worker completion at 06:39:26 UTC, coordinator measured 202.61 seconds through evidence validation. Exact cleanup and protected-only log independently verified. Source routing and tenant roles unchanged |
| 2026-11-01 UTC | Six lifecycle controls PASS, including primary-error preservation and cleanup-only rejection; eight manifest controls and four changed private PowerShell parsers PASS. Documentation freshness PASS for 27 documents. These are focused migration-tooling checks, not the requested full application/deployment/browser matrix |
| 2026-11-01 UTC | Created separate `test/tenant10-browser-acceptance-20261101` worktree at exact candidate `abdef720`, keeping the release candidate clean. Existing dependency junctions reused without installing packages or changing locks. Generated the missing Prisma 7.8.0 client locally; API build, strict new-spec type check and web production build PASS |
| 2026-11-01 UTC | Added four real-browser outcome journeys: Bulk mixed success/duplicate with corrected-row retry and persisted GET checks, malformed CSV mutation rejection, Manual Provision User/Group create/conflict/retry/tab-result reset/open-resource flow, and inactive-target mutation rejection. All four PASS against loopback-only candidate API/frontend with disposable in-memory data. Bulk result rows measured at 1440px and 900px; no production UI change, Azure deployment or target browser acceptance claimed |
| 2026-11-01 UTC | Complete local Playwright suite launched with JSON/log evidence retained in the isolated browser worktree. It is not yet a PASS, not a Docker/Prisma/Azure matrix, and not exhaustive persistence/effect coverage of all 43 declared settings controls |
| 2026-11-02 UTC | Full local in-memory suite completed: 332 discovered, 303 passed, 25 skipped, four failed, zero flaky; 1,242.54 seconds. Explicit `--update-snapshots=none` prevented baseline writes. Earlier unguarded run was stopped and is not acceptance evidence; source status confirmed no baseline changes |
| 2026-11-02 UTC | Failure diagnosis: actual OAuth fixture expected `scimserver-client` while the local API used `e2e-client`; corrected local-only environment. Retained Workbench trace shows `ERR_NETWORK_IO_SUSPENDED`; endpoint navigation reported `ERR_NO_BUFFER_SPACE`. Those three failed scenarios pass with matching OAuth configuration and one browser worker. Operations remains a separate unsatisfied layout/fixture check; no full-suite PASS inferred |
| 2026-11-02 UTC | Created one labeled, loopback-only, resource-bounded PostgreSQL 17 container with fresh empty database and random protected local credential. All 30 exact-candidate migrations applied. Four new execution journeys PASS on actual Prisma/PostgreSQL (47.0 seconds), distinct from four in-memory PASS (44.1 seconds). No source corpus used or cloud access involved |
| 2026-11-02 UTC | Switched the local frontend from Vite development modules to the existing built production preview, reducing module-request/socket pressure. Actual loopback listener and same-origin API proxy HTTP 200 verified. No production source, release candidate, cloud app or routing change |
| 2026-11-02 UTC | Seeded all six disposable shape profiles, enabled owned-fixture mutations and passed the full PostgreSQL production-preview browser run: 319 passed, 13 explicit visual opt-out skips, zero failures/flaky, 689.65s. The 13 visual comparisons separately passed with explicit opt-in and no snapshot updates. No baseline changes |
| 2026-11-02 UTC | Added all-16 numeric persistence and lower/upper boundary outcomes, including token-lifetime editors; 16 PASS in 46.88s. Existing registry imports emit the actual inventory: 38 definitions, correcting the erroneous manual 43. Bulk failed-row download content PASS. Strict added-spec compilation PASS with inherited repository aliases |
| 2026-11-02 UTC | Combined local production-preview/PostgreSQL browser gate PASS: 348 passed, zero skipped, zero failures, zero flaky; 748.09s. All mutation, seeded-shape and visual opt-ins enabled together; no snapshot writes. Exact candidate `abdef720` remains clean/unadmitted; Azure acceptance and final carry/cutover are not inferred |
| 2026-11-02 UTC | Stopped the two exact attached browser servers. Verified local PostgreSQL owner label and full container ID before removing only that container; subsequent inventory proves absence and all three loopback ports are released. No plaintext local database env file remains. Non-secret cleanup receipt and protected local proof retained privately |
| 2026-11-02 UTC | Immutable snapshot `snapshot-20261102T1237406669573Z` PASS: 140 file checksums, 48 protected byte roundtrips and 21 protected JSON checks. Its encrypted browser ZIP independently verifies 1,318 entry sizes/hashes and preserves both failed and passing reports, traces/screenshots, two added specs and measured attachments. Both complete-history base/candidate bundles verify. Includes all six local replay attempts, both Azure trials and local teardown proof; earlier snapshots untouched. CurrentUser DPAPI is not off-device recovery proof |
| 2026-11-02 UTC | Release recheck still reports exact `abdef720`, OPEN/DRAFT, ordinary checks successful and qualification skipped. Runner-authorization fields again returned operator-unavailable text, not an owner, numeric budget/lifetime, valid boolean approval or alternate release. No paid runner, qualification repeat or admission bypass |
| 2026-11-02 UTC | Source account identity matches tenant 09 and cached subscription Enabled, but actual ARM rejects with `AADSTS5000229` due to tenant expiration at 12:43:40Z. Started fresh protected data-plane-only recovery in `rollover-after-expiry-20261102T1245358536637Z`; original metadata provenance remains October 30. No source/control-plane mutation, routing change or target deployment; capture outcome still pending |
| 2026-11-02 UTC | Source HTTP health remains unverified: dev direct request and both configured-network requests timed out at 30s. Separate PostgreSQL data-plane dump is progressing; an HTTP timeout is not classified as database loss. Tenant-10 actual ARM preflight still proves both servers Ready/PostgreSQL17/CentralUS, no target apps and unchanged registry roles; receipt retained privately |
| 2026-11-02 UTC | First fresh dev dump completed and passed archive listing, but its wrapper refused to overwrite the copied October30 dev TOC. Protected the completed dump and retained FAILED outcome. Actual-loop semantic RED reproduced stale-TOC copying; corrected selection passes ten inclusion/exclusion cases plus three actual dump-estate choices and encryption/corruption self-test. Continued in fresh `rollover-after-expiry-20261102T1259169094310Z`, reusing verified dev ciphertext and dumping canary only. Canary fresh dump protected/roundtrip verified at 37,680,122 bytes; full restores still pending |
| 2026-11-02 UTC | Post-expiry recovery PASS at 13:07:17.909Z: both full isolated restores, nine table fingerprints per estate, zero invalid indexes/unvalidated constraints. Independent 13:08:33.960Z receipt verifies 30 file checksums, 22 protected artifacts, no plaintext dumps or restore containers, and exact matching of all eight non-log tables per estate to October30. Log rows changed; no new credential/data/schema regression is inferred. Original failed package and all earlier backups remain unchanged |
| 2026-11-02 UTC | Consolidated post-expiry snapshot `snapshot-20261102T1311214885406Z` PASS: 147 checksums, 48 protected byte roundtrips, 21 protected JSON checks and 1,318 encrypted browser archive entries. Updated tools and both Git bundles retained; separate fresh source package manifest/outcome/provenance checksum-bound. No repeated unchanged application suite or qualification run |
| 2026-11-03 UTC | Historical expired-tenant execution and actual copy path verified. Target ARM at 08:44Z confirms both PG17 Ready and zero apps; browser source health fails without a proved outage cause. Completed PR251 versus live master and published0.55.20 analysis: 251 changes91 tooling/test/doc/metadata paths, with no production API/schema/browser delta; frozen same-image calibration fails3 p95 comparisons, not a measured final0.55.67 regression. No public0.55.66 release image or admitted0.55.60 substitute established. Dedicated host remains an unapproved proposal, not a migration prerequisite. Added release decision brief and updated session continuity; no benchmark rerun, deployment, source mutation or customer-prod change |

| Issue | Mechanism and disposition | Detection / prevention |
|---|---|---|
| Shared Azure extension access failure | CLI login loaded unrelated azure-devops metadata. Used a target-private extension directory, without changing global permissions | Login preflight; isolated core-command directory |
| Broker login had no authenticated account | Pending interactive broker flow did not establish access. Stopped it and used normal browser login, not device code or recovered credentials | Account readback; actual identity/tenant/subscription checks |
| JSONL framing can invalidate otherwise correct copy evidence (transport/Medium) | Live Azure CLI logs wrap messages in JSON records with a string `Log` field. The loaded old wrapper rejected the successful dev worker because a plain-text boundary does not match the JSON quote after the nine-table count | Applied in the private coordinator; eight fixtures and actual retained dev log pass after JSONL decoding. Worker status Succeeded and exact cleanup independently verified; original wrapper failure retained in a separate adaptation receipt. Canary then passed with the corrected wrapper. Earliest detection was a real-transport fixture before starting the expensive copy |
| Equal hashes did not prove two distinct manifests (test correctness/High) | The initial validator accepted two identical source-manifest lines without a target record, potentially admitting incomplete evidence | Applied; exactly one source and one target identity, equal full SHA-256 values, and exact nine-table/completion evidence. Duplicate-source semantic RED now GREEN. Caught by the local reverse check before accepting a completed full-source trial |
| Lost create response could leave an untracked disposable database (ownership/Medium) | Cleanup depended on a successful create response, and creation lacked a verified-absence check and durable ownership intent | Applied; reject an existing exact name, journal fresh GUID-scoped intent before create, and perform bounded exact cleanup after any attempted owned creation. Six actual-block decisions pass after existing-name RED, including primary-error preservation and cleanup-only rejection. Corrected canary ran with the ownership journal and independently verified cleanup; no real overwrite or leaked database was observed |
| Fresh browser worktree omitted generated client (tooling/Low) | API build reported missing generated Prisma modules with cascading repository type errors. Generation then required a DATABASE_URL merely to load config | Adapted; used a nonconnecting loopback placeholder, generated the existing pinned 7.8.0 client into this worktree and rebuilt GREEN. No database, dependency install or lock rewrite. Generation is a fresh-worktree prerequisite |
| Inherited proxy blocked local readiness request (environment/Low) | PowerShell readiness timed out while the loopback API had started normally | Adapted; direct no-proxy curl returned HTTP 200, and PowerShell `-NoProxy` plus exact listener readback confirmed 127.0.0.1 ownership. No API behavior was changed |
| Layout test assumed a native table (test correctness/Medium) | New Bulk test selected `tbody td`, counted zero despite successful operation results and persisted resources. Failure screenshot and accessibility context showed generic result rows instead | Applied; measure direct children of the three actual test-ID-addressed rows, assert nonzero field count and all right bounds, scroll the result into view and attach measurements at both viewport widths. Four browser journeys then passed. This was a test-selector defect, not an observed production layout regression; no baseline regeneration |
| TypeScript 6 rejected isolated file arguments (tooling/Low) | Targeted strict type check returned TS5112 because a tsconfig existed beside explicit source arguments | Adapted using the tool's documented `--ignoreConfig`, retaining explicit strict, DOM, node and module-resolution options. New spec and its fixture imports compile cleanly |
| Local OAuth fixture identity mismatch (test environment/Medium) | The global token-mint browser spec hardcodes client `scimserver-client` and uses `E2E_OAUTH_CLIENT_SECRET`; the initial isolated API used the different unit-test client pair | Applied to local-only runtime configuration; matching expected client plus explicit browser secret makes the scenario pass. UI SCIM token remains separate. Earliest detection is a fixture/API configuration preflight, not full-suite execution; no authentication fallback or production secret change |
| Shared-host browser network suspension (environment/Medium) | Full local run recorded navigation `ERR_NO_BUFFER_SPACE` and Workbench trace `ERR_NETWORK_IO_SUSPENDED`; both reached transport before assertions. Snapshot showed 1,591 TIME_WAIT connections and 17,605 MiB free RAM, not proof of a unique root cause | Adapted by serializing focused diagnosis and serving built production assets instead of development modules. Exact affected scenarios pass, but original failed run remains failed. Do not retry until lucky, change system TCP settings or terminate unrelated processes; a later full pass under a changed environment must remain separate evidence |
| Azure role is not directory authority | Verified Owner and Global Administrator through separate APIs; did not infer one from the other | Preflight before directory bootstrap |
| Hardcoded tenant map ignored the new registry | Replaced duplicated identity map with the existing registry-derived data; preserved caller shape | RED/GREEN future-tenant and legacy invariants |
| Sequential role transition cannot validate | Paired retire/activate added to the existing helper; both mutate only after WhatIf/confirmation and validate before writing | RED/GREEN atomic and permanent-tenant controls |
| Restore quiescence can false-pass | Empty/error reads and ignored scale update can masquerade as stopped; deactivate every originally active revision and verify every revision's replicas | Applied; 20 safety assertions. Azure trial remains required |
| Copy counts can false-pass | An extra target table survives ordinary clean restore, and separate source queries race with live writes | Applied; full manifests and dump share one exported snapshot, verified by three real PostgreSQL cases |
| Reapplying a private ACL failed | Redundant Set-Acl required SeSecurityPrivilege after the credential was already privately saved | Applied; verify and retain an already-correct ACL, set only when needed; missing-file and repeat-protection tests |
| Consent command returned success without access | Stale role-map reference and legacy admin-consent exit zero did not establish an effective app-role assignment | Applied; resolve actual role ID, assign only the selected role, read effective assignment independently |
| Repeated permission add duplicated requests | Repeated CLI additions produced duplicate selected requiredResourceAccess entries | Applied; reconcile only selected duplicates, preserve unrelated permissions, verify exactly one request and assignment |
| Shell/test transport friction | Windows batch metacharacters failed query parsing; CRLF broke Linux shell input; script-scope mocks did not survive child-script scope | Adapted; native CLI backend, normalized test transport and disposable-process mock state. No global extension/ACL change |
| Directory propagation and speculative ownership | Immediate reads lagged mutations; an external suggestion asserted a missing owner, disproved by actual owner readback | Adapted; bounded actual value/absence checks; no unnecessary owner or broad permission grant |
| Proof issuer was invented from token endpoint | OAuth v2 endpoint issued v1 tokens, but bootstrap saved a v2 issuer/key URL | Applied; derive exact issuer/key metadata from validated tenant/client/audience/subject claims. Seven regression cases and all three real tokens pass |
| PostgreSQL preflight CLI command absent | Installed CLI has no flexible-server check-name-availability command | Adapted; use the actual ARM name-availability endpoint and verify both positive results. No provider/permission expansion or package installation |
| Target profile lacks a Bicep binary | Compiler discovery is profile-local; existing binaries are present in earlier profiles | No install or provisioning claimed; reuse a verified existing compiler when template/consumer hardening is ready |
| Environment template omitted actual workload profile | Source uses delegated subnet and explicit Consumption profile; omitted template property did not prove the same topology | Applied; compiled-resource RED/GREEN preserves source Consumption and Log Analytics. Target allocation/readback is separate |
| Bicep invocation mixed CLI frontends | Native Bicep accepts positional input, unlike az bicep's --file option | Adapted test transport, then reran unchanged template to observe semantic RED. Compiler-argument failure is not counted as behavioral RED |
| Coupled user-facing documentation missing | F4 rejected the environment-template change because Azure and sovereign deployment guides were not reviewed alongside it | Applied; both guides now describe explicit Consumption/delegation and public-only validation limits. The existing F4 gate caught the gap before consolidation |
| PostgreSQL deployment exposed generated password | Existing script printed the generated value, passed it as a native argument and read a secret-bearing ARM output | Applied; compiled-output RED/GREEN, private temporary parameter file, locally encoded URI, masked input and dependency download wiring. Four mocked provisioning cases pass |
| Dry-run and full-copy authentication differed | Dry-run used the raw URI password while full copy resolved raw/decoded alternatives | Applied; one shared shell connection resolver. Preflight RED/GREEN and the three real PostgreSQL snapshot cases pass after refactor |
| Failed enumeration could report success | Source table listing fed a shell pipeline whose last while-loop status hid a failing psql process | Applied; checked psql writes a temporary table list before iteration, with ON_ERROR_STOP. Explicit failing-enumeration case rejects success |
| Catalog advertisement did not allocate capacity | Both B1ms creations returned SkuNotAvailable in eastus2; actual reads showed failed-resource cleanup | Unresolved allocation; preserved credentials and explicit zone-1 attempt. Capability metadata is never recorded as Ready/capacity proof |
| Bicep conditional-property patch landed inside storage | An insufficiently contextual closing-brace hunk nested the zone expression incorrectly | Applied; compiler failure caught it before another allocation, contextual storage/authConfig patch fixed it and four provisioning cases returned GREEN. Not counted as semantic TDD RED |
| B1ms placement remained unavailable | The controlled zone-1 attempt failed with the same SkuNotAvailable response | Distinct attempt retained; delegated B2s decision recorded with public cost delta, but subsequent actual B2s allocation also failed |
| Advertised larger SKU also failed | Both eastus2 B2s deployments returned SkuNotAvailable; catalog support was not capacity | Unresolved availability; same-tier Central US allocation under a new dev name is the next distinct attempt. Measure the eastus/Central US database hop before acceptance |
| Empty inventory did not prove cross-region name reuse | Generic listing was empty but subsequent ARM creation returned InvalidResourceLocation for the previous eastus2 name; later direct read returned ResourceNotFound | Applied; fresh destination names, retained failed-name records, and a direct-read guard with six semantic regression decisions. Earlier preflight could have used direct reads; the Azure location mapping itself remains unexplained |
| Trial database CLI argument differed | Installed db-create/delete commands require --name, not the attempted --database-name spelling; initial creation was rejected before seed/copy | Adapted to installed CLI syntax; no source data touched. Earliest detection was command help rather than Azure trial |
| Copy logs required a missing extension | Core job create/start worked, but logs parsing attempted an interactive extension install and failed with EOF | Installed containerapp only in the private target extension directory after the explicit missing-tool failure; logs help now resolves. Actual trial logs remain a separate outcome |
| Cleanup read raced asynchronous deletion | Job deletion returned before generic inventory removed the entry; cleanup masked the earlier log error, although a later provider read showed no remaining job | Applied; provider-based bounded absence verification with semantic RED and 24 total GREEN safety assertions. Unknown/read failures and timeout remain failures; other-run ownership is preserved |
| Copier had no explicit new-tenant writer proof | Omitting TargetAppName skipped suspension without establishing app absence | Applied; explicit ConfirmNoTargetApps plus validated empty provider inventory; five semantic decision cases. New credentials are held only by controlled temporary trial jobs, not shared clients |
| Test image differed from Azure transfer image | Local regression ran an immutable digest while the actual YAML selected a mutable tag | Applied; actual YAML pinned to the tested digest, with image-mismatch RED/GREEN; no claim of live copy from the static check alone |
| SQL argument expansion broke verification (framework/Medium) | Actual Azure SQL parser received DO $ instead of the supplied DO $$; command-argument dollar expansion precedes the quoted shell heredoc | Applied; named SQL dollar quote and an unsafe-sequence preflight. Actual verification rerun passed all 2,000 UUID/content rows, singleton/extensions; local SQL validity alone could not prove the platform transport |
| Missing log transport recurred (tooling/High) | A prior October migration had already distinguished worker success from evidence capture, but no executable logs dependency check existed before job creation | Applied; fail-before-transfer logs-command gate, automatic installation disabled only process-locally and preference restored; actual live captures remain separate from command availability |
| Historical migration checksum stopped full replay (migration-history/Medium) | Initial isolated dev restore succeeded, but the strict current-file check rejected `20260416025138_add_requestlog_perf_indexes` before Prisma execution; the stored checksum exactly matches candidate ancestor `f9c6d3cd`, while the later file guards previously unguarded cleanup/index statements | Applied in the private probe; explicit ancestor evidence instead of false current-file equality, six focused negative/positive controls, unknown variants fail, and dev GREEN preserves original migration rows and data. Earliest detection was a metadata-only checksum probe before the expensive full restore; target Azure/runtime acceptance remains separate |
| Canary envelopes cannot authenticate under the preserved DEK (source-data/High) | Four of ten envelopes fail in both exact original and candidate crypto, while the effective KEK unwraps the single DEK and six other envelopes decrypt successfully | Unresolved source compatibility defect; protected complete identity comparison, no key/data modification and carry blocked. Source admin-reveal coverage before rollover preparation was the earlier possible detection gate; root mechanism beyond the proved envelope/key mismatch is not yet established |
| Aggregated diagnostic check landed inside the loop (harness/High) | First/last failures produced an incomplete tally, and an all-failed set could bypass the misplaced decision | Applied; two semantic RED assertions, decision moved after iteration, nine total GREEN controls and complete actual ten-envelope rerun. The new harness unit tests were the earliest possible gate; no partial tally or false-success path was admitted |
| Azure pricing MCP executable locked (tooling/Low) | MCP initialization failed with `EBUSY` while copying its executable in the shared npm cache | Adapted to the official read-only Retail Prices API; no cache deletion, installation changes or unrelated process termination. No resource was provisioned |
| Documentation append context differed (tooling/Low) | A multi-hunk evidence update expected a sentence without its existing word `than`; the patch was rejected | Corrected the exact existing context and applied the coherent update. A rejected edit is not behavioral RED; final whitespace and documentation gates pass |
| Release label can masquerade as admission | Candidate metadata says 0.55.67 but PR remains draft and final artifact/admission are absent | Keep source correctness, campaign result and release artifact distinct |
| Existing browser coverage is incomplete | Some surfaces only assert presence, not saved values/runtime/layout | Outcome matrix and gap closure before target acceptance |
| Manual registry counts contradicted one another (evidence correctness/Medium) | Initial inventory claimed 43; later manual recounts contradicted their own tables. A count copied into prose did not prove the actual candidate declarations | Applied: passing tests import all three definition arrays and the map, assert unique-key completeness and attach the runtime inventory: 20 boolean, 2 enum, 16 numeric, total 38. Earliest detection is executable inventory before planning coverage. Historical rows retain the original claim with this explicit correction |
| Standalone type check omitted project aliases (tooling/Low) | Adding registry imports introduced the legitimate `@scim/types` alias, which alias-less explicit-file `tsc` could not resolve | Adapted with a private focused tsconfig extending the actual web config and including only the two added specs. It passes without casts, dependency changes or a production tsconfig edit. Earliest detection is focused compile immediately after adding imports |
| Source directory expired while release was still held (environment/High) | Actual ARM token acquisition returns `AADSTS5000229` even though cached account metadata says Enabled. Fresh control-plane configuration/secrets cannot be assumed recoverable after expiry | Recovery succeeded using independently preserved data-plane credentials and explicit October 30 metadata provenance: both complete restores and all eight non-log table matches per estate verified, without source mutations. No reauthentication to a different tenant or reinterpretation of empty/error output. Earliest reliable gate is an actual ARM request; pre-expiry capture preserved this recovery path. Final write quiescence cannot simply assume source revision control remains available; it needs separately verified evidence before zero-loss cutover |
| Source HTTP readiness timed out after expiry (environment/Medium) | A dev request bypassing the proxy timed out; using the normal configured network path also timed out for dev and canary. Neither result identifies the unique network/service cause | Explicit failed health receipt retained in the fresh recovery package, without assuming service health or database loss. PostgreSQL dump progress independently establishes that data-plane access was still available. No unchanged retry loop, source restart or network-policy change; this remains an unresolved source-service observation |
| Retained metadata included generated archive TOCs (tooling/Medium) | The fresh dev `pg_dump` and archive listing succeeded, but writing its TOC hit the non-overwrite guard because the wrapper had copied an older generated TOC as metadata | Applied after semantic RED: exclude old dumps, TOCs and restored manifests in the actual metadata-copy loop; ten fixture cases now pass. Preserve original failure and encrypted completed dev dump; corrected continuation checks its prior receipt/hash, captures only canary and admits neither until both complete isolated restores pass. Three actual estate-selector cases prevent repeating dev. Earliest gate was a fixture inventory test before the expensive dump, now operationalized |
| Extracted-copy test lacked child-local accumulation state (test harness/Low) | The first fixture raised `op_Addition` on a PSObject before reaching the intended stale-TOC assertion | Applied: initialize the extracted block's own metadata array rather than relying on inherited scope. The intended stale-TOC semantic RED was then observed and all ten actual-copy cases passed after the real fix. This harness failure is not counted as behavioral RED or as a source defect |

**Self-improvement applied:** registry, atomic role, copy snapshot/quiescence,
credential protection, effective consent and token-metadata regression tests
close specific false-green escapes. Azure trial and browser gaps remain named
blocking gates, not dismissed as historical behavior.
The empty-inventory escape is closed in-place for known existing/deleting/error
outcomes by six direct-read absence regressions. Azure's cross-region name
mapping is separately avoided with fresh names, not claimed resolved by that
test. Server-scoped private records retain every previous failed-name backup.
Absent-app and eventual-deletion regressions close two additional orchestration
gaps before real data carry. Actual Azure trial, source-fidelity replay and
application acceptance remain independent checks.
The recurring log dependency now has an executable pre-transfer gate rather
than only a prose convention. The SQL argument boundary was confirmed by real
RED/GREEN and distilled into the existing central transport pattern.
Historical provenance and complete failed-set aggregation now have nine
focused controls. Canary failures are compared with the actual original image,
not attributed to migration from a candidate-only error. Source failures remain
blocked, not converted into a successful restore claim.
The later lifecycle investigation narrows this disposition: inactive archived
failures with exact original runtime/response parity are recorded, not treated
as healthy decrypted secrets. Active or new failures remain blocking.
The current complete local replays and schema-model diffs pass this stronger,
contract-aligned gate; no original archive data changed.

**Design disposition: accepted.** Reuse the existing registry/carry/pipeline
seams. No speculative replacement migration framework or application rewrite
is justified. The helper lookup becomes smaller and removes duplicate identity
ownership. Release qualification remains a separate decision boundary.
The growing transfer coordinator remains a structural review candidate;
revision/cleanup/ACL mechanics are cohesive in the existing copy-safety helper,
while the embedded PostgreSQL transaction is a separate execution boundary.
JWT decoding is extracted for its two real consumers, not a new authorization
framework. No further speculative strategy layer is justified.
Explicit Consumption configuration is one cohesive template correction that
matches observed source topology. No new paid tier, policy framework or
government-cloud qualification is inferred.
The PostgreSQL-specific absence guard remains a small cohesive preflight beside
the existing safe provisioning helper; no general Azure resource framework is
introduced. Failed-name record retention is operational recovery bookkeeping,
not credential rotation on an existing server.
The private replay probe keeps schema/content checks and source/candidate
crypto comparison as explicit small boundaries; no production service grows
and no speculative migration framework is introduced. Failure journaling
rethrows the original failure and protects logs even when cleanup fails.
For browser additions, **accepted**: registry-driven tests follow existing
fixture/admin-readback patterns, and the two small cohesive specs do not grow
production orchestrators or introduce a speculative testing framework.
**Self-improvement applied:** numeric persistence and boundary outcomes close
an actual coverage gap; CSV content assertions replace a presence-only check;
the executable registry inventory prevents another misleading manual count.
For post-expiry recovery, **accepted**: the existing dump/restore owners remain
the execution seams. One bounded estate selector supports the existing
two-estate capture and the concrete canary-only continuation without duplicating
the dump implementation. The private wrapper handles metadata provenance and
failure retention, not a new migration framework. Ten real metadata-copy cases
and three real selector cases close the stale-TOC/repeated-work gap in place.
The private evidence capture rejects the wrong candidate and an active run
without its completed report before writing an archive. Positive capture
requires zero skips/failures/flaky cases, prohibits unexpected source or
baseline changes, encrypts source/reports/traces/screenshots without a
plaintext ZIP, and independently checks every decrypted archive entry's size
and SHA-256. Full base Git bundles remain separate from uncommitted sources.

**Provenance:** Git objects, exact PR/check metadata, actual tenant/permission
reads, visible test results and the retained qualification documents. No full
JSONL transcript reconciliation or off-device backup proof is claimed.

For the November 3 decision investigation, **design disposition: accepted**.
The existing data-plane transfer and release/publication mechanisms remain
separate cohesive concerns; no replacement framework or new runner layer is
introduced. **Self-improvement applied:** the front-page status now reflects
the completed 348-test local browser run and distinguishes migration
feasibility from the requested candidate's release hold. Historical execution
and current actual reads, rather than the old plan or cached subscription
state, are the evidence for the expired-source route. Final writer quiescence
and actual target acceptance remain explicit independent checks.

## References

- [Migration comparison](TENANT_MIGRATION_COMPARISON_AND_LEARNINGS.md)
- [August execution RCA](TENANT_09_MIGRATION_EXECUTION_ISSUES_AND_RCA.md)
- [Estate registry](../scripts/scim-estates.json)
- [Existing carry orchestrator](../scripts/replicate-estate.ps1)
- [Existing PostgreSQL carry](../scripts/rotate-tenant-data.ps1)
- [Current full deployment pipeline](../scripts/dev-deployment-pipeline.ps1)
- [Deployment infrastructure](DEPLOYMENT_INFRASTRUCTURE_AND_FORM_FACTORS.md)
