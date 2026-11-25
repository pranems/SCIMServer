# Docker Desktop removal readiness

**Last verified:** 2026-11-25
**Status:** Local native Engine live and complete browser qualification pass; six-mode acceptance is composed, not an original all-green run. Performance, Azure dev, directory flows and operator acceptance remain open.
**Product version:** 0.55.70; documentation scope, not new qualification, shipping or deployment evidence
**Deadline from the supplied notice:** December 2, 2026

## Executive summary

The selected replacement remains independent Docker Engine in Ubuntu WSL,
with independent Windows Docker, Compose and Buildx clients over pinned,
key-only loopback SSH. Docker Desktop is not required by that route.
Docker Desktop removal is still deliberately not performed.

Markdown is the canonical documentation format. The earlier assessment
already existed as Markdown, both in this repository and in the private
report folder. HTML was an additional, pre-rendered viewing option because
the editor had competing Mermaid renderers. It was not intended to replace
Markdown. Presenting the HTML first and mixing initial closing receipts with
later results made the final state unnecessarily difficult to understand.
This document separates dated evidence, current corrections and open gates.

The latest November 24 checkpoint below is authoritative for local native
qualification. It preserves earlier failed runs rather than replacing their
receipts. Passing local tests does not authorize deployment, Docker Desktop
removal, artifact deletion or production promotion.

The marketplace Mermaid renderer and its already-uninstalled residual
directory are now removed. `npm run docs:mermaid:doctor` passes with one
built-in renderer, Mermaid 11.17.0, matching the gate. An already-open preview
can still require closing and reopening; no claim is made that every other
editor window has refreshed.

## 1. One authoritative status model

### Native narrow-viewport access follow-up, 2026-11-25

**Conclusion:** the Operations tables already provide functional horizontal
scrolling. No production CSS change is needed. At 900px the table initially
extends past the viewport, but the existing results region lets a user
reach the trailing column through horizontal mouse-wheel input.

The permanent [browser regression spec](../web/e2e/operations-horizontal-access.spec.ts)
creates its own endpoint, long user and group through HTTP. It resolves
the actual administrative row ID rather than assuming it equals the SCIM
resource ID. Each fixture endpoint is deleted and absence is checked.
The four positive cases measure every header and cell against the viewport
and all clipping ancestors, require actual inner text overflow, and verify
hit-testable copy and navigation actions. ID and timestamp copies are checked
against the clipboard, and endpoint navigation is exercised.

| Native backend | Viewport | Users / groups table width | Name column width | Trailing cell right edge before / after input | Visible region right edge |
|---|---:|---:|---:|---:|---:|
| InMemory | 1440px | 1101px | 427.15625px | 1391px / 1391px | 1391px |
| InMemory | 900px | 640px | 243.46875px | 930px / 851px | 851px |
| Actual Compose Prisma | 1440px | 1101px | 427.15625px | 1391px / 1391px | 1391px |
| Actual Compose Prisma | 900px | 640px | 243.46875px | 930px / 851px | 851px |

At 900px each results region is 561px wide and naturally scrolls from 0
to 79px. Thus the 640px table does not need to fit the whole viewport at
once. Both user and group names actually clip: inner client widths are
403px at 1440px and 219px at 900px, with measured content widths greater
than those limits. Presence, CSS properties and `innerText` alone are not
used as proof of layout correctness.

Two deliberate negative controls disable horizontal user scrolling in
every overflowing ancestor while preserving the table and its truncation.
The same access assertion rejects their clipped trailing columns. An
initial control disabled only the outer main panel and was correctly found
insufficient because the inner results region still scrolled. This closes
the viewport-access assertion gap without changing the intended UX.

Final scoped browser results are **6 pass / 0 fail / 0 skip in each native
mode**, 12 total executions. The prior complete corrected 353-pass browser
receipts and the original 352-pass/1-fail receipts remain separate and
unchanged. This is not a new complete browser-matrix or performance claim.
The new spec compiles under strict TypeScript checking.

Source base is normally merged `a72f95b0` (PR #291), version 0.55.70.
API, web production source, Dockerfile, dependency manifests and all three
locks are byte-equivalent to qualified `f8c2ce1f`. These browser checks used
only the pinned nonshipping f8 image
`sha256:66827a266316c42db5fff1499009d045da9364a9083cfb950860be49371a735f`,
not the stale host static frontend or any cloud deployment. Both fresh
owned loopback targets reported the actual expected version and backend.
Each positive navigation also waits for the exact seeded resource row and
successful SCIM HTTP response before cleanup. All eight positive browser
request IDs match the corresponding live request-log item, path and HTTP 200.

Private failed receipts, final measurements, execution issues and exact
owned cleanup evidence are retained under
`native-narrow-viewport-20261125` in the parent session's private evidence
folder. Original native 11-container/49-volume/6-network identities are
preserved; identity preservation is not fresh data-byte proof. Docker
Desktop, its artifacts/backups and the offline global bridge remain
untouched. Azure browser execution remains blocked by the missing approved
ACR mirror, and directory flows, performance, operator visual acceptance,
independent review/merge and Desktop removal remain open.

**Self-improvement:** applied a permanent clipping-ancestor and natural-input
access guard with discriminating negative controls. **Design disposition:
accepted** - the existing results panel already owns scrolling, and a new
production wrapper or abstraction would be speculative.

### Native API preparation follow-up, 2026-11-24

**Conclusion:** fresh native worktrees now have an explicit API-only
preparation command in the existing
[standalone builder](../scripts/build-standalone.ps1). Base master
`fc99388f5109802ff2255ba07527510e94eef644` includes normally merged PR #290.
This follow-up changes local setup tooling only, not the qualified
application, dependency graph, image, runtime or cloud estate.

```powershell
pwsh -NoProfile -File .\scripts\build-standalone.ps1 -PrepareOnly
```

The sequence is immutable API `npm ci`, local Prisma generation, then
TypeScript compilation. Every stage checks its native exit before continuing.
Generation temporarily sets `DATABASE_URL` to
`postgresql://build:build@127.0.0.1:1/build`, a deliberately nonconnecting
build-only value, and restores the caller's value before compilation even
when generation fails. No real database or secret is required. Local Prisma
and TypeScript CLI files are checked after installation; a missing CLI cannot
silently turn into an npx download. Missing host tools fail explicitly.

`-PrepareOnly` returns before package cleanup/assembly, web builds, optional
binary downloads and all runtime work. Packaging options are rejected before
installation. The normal builder reuses the same stages and then continues
through its existing package flow. Root and web dependencies remain separate;
the unchanged Fast hook validates rather than installs or prepares source.
The compiled API's older static frontend is not a browser acceptance target.
Use the current Vite frontend for development or the assembled package for
its separately qualified workflow.

#### Observed command results

| Check | Actual result | Claim established |
|---|---|---|
| Fresh `npm --prefix api run build` | Exit 1: missing `tsc` | Owned package dependencies really were absent before restoration. |
| Approved-proxy `npm --prefix api ci --no-audit --no-fund --registry=https://packagefeedproxy.microsoft.io/npm/` | Exit 0, 660 packages | Immutable package restoration alone. |
| Build immediately after that install | Exit 2, TS2307 at generated Prisma imports | Package restoration does not restore ignored application-generated source. |
| `pwsh -NoProfile -File scripts\build-standalone.ps1 -PrepareOnly`, with no DATABASE_URL | Exit 0; Prisma 7.8.0 client and compiled API entry present; no `standalone` output | Actual generation/compilation succeeds without a real datasource or package. |
| New `native-preparation.contract.ps1` against the exact base builder | Exit 1, 41 assertion failures | The base does not implement the new preparation boundary or generation environment. |
| Same new on-demand contracts against the correction | Exit 0, 97 assertions | Exact command order, install/generation/build failures, missing host/local tools, caller environment/location restoration, unchanged lock and retained package output. |
| Existing `standalone-migrations.contract.ps1` | Exit 0, 59 assertions, unchanged | Existing generated package/launcher contracts remain intact. No actual database was started by this mock suite. |
| `npm --prefix api run lint` | Exit 0, zero errors and 507 existing warnings | No API lint regression. |

All three source lock SHA-256 values are unchanged:

| Lockfile | SHA-256 |
|---|---|
| API | `6e9c81f9875a0aea9b62bc32896ee711423e1c5ee985226e0475088004ab0594` |
| Web | `23960ff78d58a6db808f4ecbce3769e66324f42bcbf2e6a107de5abe31b39106` |
| Root tooling | `3f5beca5fe56374c3ddb606861d4170fe197d285099636ab55bd4c60d9121245` |

Private receipts remain under the supplied session evidence root, in
`files\native-prerequisite-preparation-20261124`. Initial unsuccessful test
development logs and the original fresh-build failure are retained.

| Receipt | SHA-256 |
|---|---|
| `api-ci-only-build-red.log` | `0f28dad8b5fe7cfe6366e8cfda084a7712eef7e1d5e213ecd4b60207023c5ab4` |
| `actual-prepare-green.log` | `d2b5c81363a46c13899f5ac1a342054ea3771ce9be07a318f6fa5e6ad634dbe7` |

These hashes identify bounded setup receipts, not a nested native lifecycle
journal or a complete rerun of the prior native qualification. The three
1,845-assertion live runs and two 353-test browser runs below remain pinned to
their original source/runtime/image identities. No Desktop deletion, gateway
migration, shipping image, workflow dispatch, Azure/Graph write, migration,
runtime start or performance tuning was performed here.

#### Execution issues, root causes and prevention

| ID | Type / severity | Symptom and root cause | Correction and why it works | Detection and earliest useful prevention |
|---|---|---|---|---|
| R46 | Setup prerequisites / Medium | Two earlier normal fresh-worktree Fast pushes failed TS2307. This owned reproduction confirms that the ignored Prisma client is application-generated source, not an npm-installed package. The builder had the correct order but coupled it to packaging and caller-provided generation configuration. | Reuse its two stages with explicit `-PrepareOnly` and a scoped nonconnecting generation datasource. Actual ci-only build exits 2, then real preparation exits 0. Every failed stage stops the sequence; all lock bytes remain unchanged. | Earlier detection was the Fast API build. Earliest useful prevention is explicit preparation before that hook, plus the new on-demand order/failure contracts. Automatic hook/test registry integration is not claimed or changed. |
| R47 | New test-double scope / Low | The first contract double used script-scoped state which resolved in the invoked builder's child scope, rather than the test owner. That caused test-harness failures and was not valid order evidence. | Share uniquely named process-global contract state and remove it in finally. Reexecute the exact base with the corrected doubles: 41 real assertion failures, then 97 GREEN assertions. | Detected in focused contract output before real preparation. Earliest check is proving that real command invocation reaches the test-owned recording state. Initial failed logs remain retained. |
| R48 | New fixture teardown / Low | Repeating a missing-CLI scenario tried to remove its already-absent sentinel on the second datasource case. The runner terminated after 76 PASS lines, not a complete successful suite. | Check exact sentinel existence before targeted removal; reset generated/compiled fixture outputs for each case. Final completion and actual exit 0 now accompany the 97 assertions. | Detected at the contract runner's nonzero exit. Earliest check is full fixture lifecycle completion, not a partial PASS count. |
| R49 | Edit placement / Low | An initial patch put the post-install CLI checks before npm ci. This would prevent a fresh worktree from preparing at all. | Move checks to the generation stage after the checked install. The actual fresh-worktree run and ordered call assertions prove install comes first. | Detected by direct source read before execution of that candidate. Earliest check is the real stage ordering, not just presence of each command. |

**Provenance/completeness:** this bounded follow-up reconciles its persisted
command logs and diagnosed tooling issues. The earlier parent transcript and
native lifecycle artifacts were not reread or requalified, and no full
historical transcript completeness claim is made. Missing root Mermaid and
web Vite dependencies were expected fresh-worktree prerequisite failures;
owned approved-proxy npm ci restores each separately without editing locks.
The existing npm fetch registry is the approved proxy; no npm configuration
or quarantine setting was changed.

**Self-improvement applied:** tests assert the preparation outcome and failure
boundary rather than relying on the documented command order alone.
**Design accepted:** reuse the existing cohesive install/generate/compile
stages. No new installer abstraction, hook coupling or application dependency
is justified. Final normal Fast delivery and exact-head CI are separate
receipts; parent review and merge remain required.

### Verified native qualification checkpoint, 2026-11-24

**Conclusion:** unchanged production sources pass three native full live
modes: immutable-image InMemory, actual Compose Prisma and owned Windows
Node InMemory, each 1,845/1,845 with actual exit 0. Only the first two use
the attested OCI image; Windows Node runs directly on the host.
The image also passes the complete browser suite on both InMemory and actual
Compose Prisma. The browser qualification has zero skips and includes pixel
comparisons. This is local runtime qualification, not a green Azure dev
pipeline, accepted performance, directory integration or removal approval.

#### Source, image and review identities

[PR #289](https://github.com/pranems/SCIMServer/pull/289), the test-only Token
Save repair at `28f56ef80620d4d853d7259043cbcc4d0ae4a424`, normally merged
at `82e5f9aa495bee68da34325ab52952e1830e7290` on November 24 at
22:44:39 UTC. Normal Validate passed 32/32 gates: API 220 suites/6,274
passes, reduced HTTP 2,519 passes/45 known skips, and web 126 files/1,664
passes. API lint had zero errors/507 warnings; web TypeScript had 66 existing
errors, unchanged and below the existing ceiling of 96. All six configured
exact-head checks succeeded. The owner recorded a COMMENTED source
self-review and the parent performed direct source review; neither is an
independent GitHub approval. These are PR #289 results, not results of a
subsequent documentation-only PR.

The complete Git trees of the executed test head `28f56ef8` and merged
`82e5f9aa` are identical:
`eea50f4d6dbe7d4204e12eaa37934b63a4c34236`. Production API/web source,
Dockerfile and all three lock objects are identical to attested
`f8c2ce1f2e325affd2e780d0fe5ee0aba330901c`. This equivalence does not
change the executed test HEAD or the image's Open Container Initiative
(OCI) revision label.

The authoritative unchanged image is
`ghcr.io/pranems/scimserver@sha256:66827a266316c42db5fff1499009d045da9364a9083cfb950860be49371a735f`.
Its application version is 0.55.70 and Node is 24.22.3; the Windows host
Node is 24.13.0. Native qualification used Docker Engine 29.1.3 on Ubuntu
24.04, through the native Unix socket. The separately documented independent
Windows SSH route remains available. The global Desktop daemon bridge was
offline and untouched; these results do not qualify that bridge.

#### Results and preserved failures

| Evidence boundary | Observed outcome | Interpretation |
|---|---|---|
| Original canonical six-mode run at f8 | Exit 1; five of six modes passed. The complete-coverage lane initially reported 117 files/1,560 passes with worker-start timeouts. | Original run remains FAIL. The timeout root cause is unproven. |
| Retry of only the failed complete-coverage lane, unchanged inputs | 126 files/1,664 passes; lines 85.74%, branches 75.86%, statements 83.06%, functions 75.53%. | Composed six-mode acceptance, not an original all-green canonical invocation. |
| Other complete matrix lanes | API units 220 suites/6,274 passes on each backend; full InMemory HTTP 2,575 passes/45 known skips; Prisma HTTP 2,620 passes; ordinary web 126 files/1,664 passes. | Full HTTP is distinct from the reduced pre-push/CI HTTP population. |
| Three native full live modes | Immutable-image InMemory, actual Compose Prisma and owned Windows Node InMemory: each 1,845/1,845 with actual process exit 0, 169 sections and 2,060 steps. | Unchanged production-source evidence in all three modes; attested image/Node 24.22.3 only in the first two. Windows Node is host 24.13.0, not an image run. Harness counts include credits for retired explanatory rows; not every historical capability was executed. |
| Earlier complete browser attempts, each backend | Each 352 passed, one failed, zero skipped, actual exit 1. | Remain FAIL. Global OAuth fixture inputs did not match the fresh owned server. |
| Corrected focused token-log case, each backend | One passed, actual exit 0, before each complete run. | The first causal failure was verified before full-suite repetition. |
| Final complete browser suite, native InMemory | 353 passed; zero failures, skips, flaky tests or unhandled errors; actual exit 0. | Three workers, zero retries; all 13 pixel tests and eight Token Save tests pass. |
| Final complete browser suite, actual native Compose Prisma | 353 passed; zero failures, skips, flaky tests or unhandled errors; actual exit 0. | Same flags and concurrency; all 13 pixel tests and eight Token Save tests pass. |

The browser opt-ins were `E2E_ALLOW_MUTATIONS=1`,
`E2E_SHAPE_COVERAGE=1` and `E2E_VISUAL_BASELINES=1`, exclusively against
fresh owned disposable servers. Six shape templates, 18 Users, 10 Groups,
15 memberships, one credential and zero Devices, plus owned long-user
fixtures, were prepared before API caching. Definitions alone were copied
to new InMemory fixtures; schema strictness and extension definitions were
not weakened. No diff PNG required classification, no visual baseline was
edited and no operator visual approval is inferred from pixel-test success.

#### Correct OAuth inputs, not a product change

The existing
[token-log browser case, declaration line 170](../web/e2e/logs-activity-tables.spec.ts#L170)
requires a successful global token response at assertion line 227.
Its existing request uses the literal client ID `scimserver-client` and
[the `E2E_OAUTH_CLIENT_SECRET` fallback, line 224](../web/e2e/logs-activity-tables.spec.ts#L224).
The fresh owned server used a different disposable secret from that fallback.
The private fixture explicitly bound this already-supported environment
variable to the actual owned server secret and configured the literal client
ID on that server. No repository launcher, test, authentication or runtime
configuration was changed.

Before focused and full execution, private `Resolve-BrowserOAuth` checked
the actual source-supported resolution. Wrong-secret, wrong-ID and
omitted-environment controls each refused admission with actual exit 1;
correct inputs exited 0 and produced an actual OAuth 200 with contract-safe
proof. This is operational proof in private guard files, not a newly
committed permanent repository regression gate. Secrets and token values
are not published. Do not invent a browser client-ID environment override
that this source does not consume.

#### Measured layout contract and its limit

[OperationsPage rowTable, line 107](../web/src/pages/OperationsPage.tsx#L107)
retains its existing minimum width of 640 pixels. Browser measurements
prove bounded columns and actual text clipping, not whole-table viewport fit.

| Viewport | Table width | Name column | Clipping client/scroll width, InMemory / Prisma | Result |
|---|---:|---:|---|---|
| 1,440 pixels | 1,101 pixels | 427.156 pixels, about 38.8% | 403/684 and 403/664 pixels | All four headers remain within the table. |
| 900 pixels | 640 pixels | 243.469 pixels, about 38.0% | 219/684 and 219/664 pixels | All four headers remain within the table; name column neither expands nor collapses. |

At the narrow viewport the table's right edge was 930 pixels, beyond the
900-pixel viewport. Therefore these measurements do **not** prove responsive
viewport fit. Horizontal-scroll access and operator layout judgment remain
unmeasured. Existing inventory geometry cases at 1,440, 900 and 390 pixels
passed on each backend, but do not remove the Operations limitation.
No unrelated CSS or browser spec was changed. Operator visual acceptance
on Azure dev remains pending; do not call this "validated on dev" or
"ready for prod."

#### Evidence seal, cleanup and execution RCA

The parent independently verified all 1,151 artifact hashes/sizes and
1,928 unchanged tracked-source hashes. The frozen journal has 304 events:
one expected-plan event and 101 complete ID-matched lifecycles, including
83 actual native process exits and 18 PowerShell operation statuses.
These are different kinds of completion evidence, not 101 native exits.
Interleaved events are matched by ID, not assumed adjacent triples.
Sealing followed all runtime writers and closures against the frozen
journal; manifest/bookkeeping writes are explicitly excluded.

| Immutable evidence | SHA-256 |
|---|---|
| Final browser qualification receipt | `256134720F4246A7EDB1B713E66E91226E5ADE2161A65BC068CC08A908E9AC15` |
| Artifact manifest | `0A2635F0BA9FA46F15D28C5227C928E59958A2F82368FD0056B1252B904EE463` |
| Frozen operational journal | `E203ACD86913BA48BCC8C730C2686027E09C9A651510042165FB5C8DD9B234FA` |

Final cleanup retained the original 11 containers, 49 volumes and six
networks; actual fixture ports 52747, 52748 and 52749 were absent.
This is identity preservation, **not** a fresh database-byte-preservation
claim. The private inventory and full report remain private.

| Issue / severity | Observed cause and correction | Detection / earliest prevention |
|---|---|---|
| Complete-coverage worker startup / Medium | Original 117-file partial result failed. Only the unchanged failed lane was retried successfully; root cause remains unproven. | Full matrix coverage lane. Preserve both receipts and report composed acceptance. |
| Browser OAuth fixture mismatch / Medium | Existing global fallback did not equal the fresh server secret. Bind the actual supported environment value and literal client ID on owned fixtures. | Earlier full browser FAIL; source-aware OAuth preflight and the focused token-log case could catch this before a full run. Three refused controls and one accepted control verify the private correction. |
| JSON admission key order / Low | Six raw JSON comparisons rejected equivalent objects. Canonicalize object keys, preserving all values and array order; no profile relaxation. | Private admission before execution; compare semantic objects rather than serialization order. All failed receipts remain immutable. |
| Layout claim boundary / Medium | Bounded columns can pass while the table extends outside a narrow viewport because of its existing minimum width. | Measured browser geometry. Report clipping and viewport fit as separate outcomes; operator/scroll acceptance is still open. |
| Published documentation provenance / Medium | Initial consolidation attributed all three live modes to the OCI image, although the third was owned Windows Node InMemory on host Node 24.13.0. Corrected the readiness guide, both context records and PR summary to name each actual mode and attribute the image only where used. No result, source or runtime changed. | Parent direct review of published documentation caught the wording error. Earliest prevention: reconcile each result's launcher and runtime identity before summarizing source equivalence as image evidence. Parent acceptance of this correction remains pending. |

Latest issues were captured contemporaneously. Full historical transcript
reconciliation after November 24 at 01:39 UTC is not verified; this section
does not invent complete migration RCA coverage.

**Self-improvement: applied.** The guide now separates original failures,
unchanged retries, host-versus-image provenance, source/image equivalence, actual exits, semantic admission
and measured layout outcomes. Private operational controls are explicitly
distinguished from committed gates. **Design disposition: accepted.**
Documentation consolidation introduces no production growth, dependency
edge, new abstraction or speculative runtime change.

- [x] Local native full live qualification and complete zero-skip browser qualification.
- [x] Composed six-mode acceptance with original failure retained.
- [ ] Full ordered Azure dev pipeline with existing approved ACR mirror and actual permissions.
- [ ] Authorized three-mode gallery/directory workload identity federation (WIF) flows, all 13 checks.
- [ ] Operator visual acceptance on dev, including remaining layout judgment.
- [ ] Separate removal/Intune and artifact-deletion authorization; not granted by local qualification.

The logging performance candidate campaign is closed, FAIL and unpublished:
ResourceTypes p95 was 11.0344 ms against strict `<10 ms`; Group POST p95
increased 34.08847% against the allowed 10%. No further unchanged benchmark
is claimed. The ordered dev pipeline remains blocked by missing approved
mirror/permission evidence in the current active ephemeral estate. No new
funding approval or billable resource was authorized.

Full gallery/directory WIF flows remain pending. PR #288's 96 offline
contracts are not an executed directory flow. Gallery `PlanOnly` creates a
temporary synchronization job and is not read-only. The optional global
Desktop-backed MCP gateway remains retained and unmigrated; the native
project browser alternative is qualified. No Desktop uninstall, Intune
consent, artifact deletion, AutoCanary or customer-production operation
is authorized. Older checkpoints below retain their capture-time scope.

### Token Save browser contract repair, 2026-11-24

**Conclusion:** this is a local browser-test correctness repair, not a change
to authentication, product behavior, release readiness or deployment status.
[TokenGate.handleSave, line 72](../web/src/layout/TokenGate.tsx#L72) still writes the
trimmed token, dismisses the dialog and invalidates the query/router state.
Saving does not have a dedicated server-side token-save response.

The preserved exact-source `f8c2ce1f2e325affd2e780d0fe5ee0aba330901c`
native Prisma full-browser result was **327 passes, one failure, 25 skips**.
In `token-gate.spec.ts:184`, concurrent `save.click()` operations raced.
Trace call 4776 waited for stability, then encountered a detached button and
timed out after 5,000 ms. Call 4778 actually clicked and completed navigation
in 272 ms. The dashboard screenshot had no dialog; subsequent GET requests
returned 200. Stored-token and app-shell assertions were never reached.
This establishes a test-action delivery race, not a demonstrated defect in
the private `pendingRef` guard.

[The repaired double-click test, line 175](../web/e2e/token-gate.spec.ts#L175) resolves
one actionable locator for one trusted `dblclick` pointer gesture. A
test-local observer delegates to the original `Storage.prototype.setItem`
and records successful writes only to the actual localStorage token key.
The test requires the exact write sequence `[TOKEN]`, the exact stored token
and a visible app shell. Equal repeated values would satisfy the old stored
value check, but now fail the write-sequence assertion. No force click,
synthetic DOM dispatch, swallowed action error, timeout increase, wait,
skip, retry adjustment or visual baseline change is used.

The dialog may disappear after the gesture's first click. Therefore this
test proves the user-visible once-only persistence outcome; it does not
claim to force a second call through a private guard branch.
[The existing TokenGate unit case, line 188](../web/src/layout/TokenGate.test.tsx#L188)
separately checks mocked save/query/router call counts. That unit file was
inspected, not changed or rerun, and no new private-branch coverage is claimed.

| Evidence | Exact outcome |
|---|---|
| Preserved full-browser RED on native Prisma | 327 passed, one failed, 25 skipped; first failure was locator action delivery. |
| Discriminating negative control | After the trusted gesture, an intentional second actual same-value localStorage write produced seven passed, one failed, no skips. The new assertion received two token values instead of one. The injection was removed. |
| Final complete token-gate file, native image InMemory | Eight passed, zero failed, zero skipped; process exit 0. |
| Final complete token-gate file, native Compose Prisma | Eight passed, zero failed, zero skipped; process exit 0. |
| Strict changed-file compiler | `npx tsc --ignoreConfig --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node e2e\token-gate.spec.ts` exited 0 from `web`. |
| Owned cleanup | All newly labelled fixture containers, volume and network removed. Original exact identities and populations remain 11 containers, 49 volumes and six networks. |

Both final browser commands were
`npx playwright test e2e/token-gate.spec.ts --workers=1 --reporter=line,json --output=<owned backend output>`
from this repair worktree's `web` directory, with `E2E_BASE_URL` set to the
respective admitted loopback fixture and `E2E_TOKEN` set to its disposable
SCIM token. Runs were serial, with no configuration or threshold changes.
Fixtures ran on Ubuntu-24.04 Engine
`68f34f63-05bc-488a-b093-402808b594b2`, through a fresh owned Docker client
directory and the native Unix socket. Both used
`ghcr.io/pranems/scimserver@sha256:66827a266316c42db5fff1499009d045da9364a9083cfb950860be49371a735f`.
Actual HTTP version readback was 0.55.70, Node v24.22.3 and the expected
backend. Exact request-ID log readback inside each owned container correlated
the Windows HTTP target. The immutable image label binds production source
to f8; only the browser harness in this worktree changes.

Bounded receipts, the command journal, before/after identity sets, compiler
results and structured private RCA are retained under this worktree's ignored
`test-results/token-save-repair/`. The original trace, screenshot and failed
receipt remain under the separate
`containers-native-f8-qualification-20261124` worktree's
`test-results/native-f8-qualification/`. Root and web dependencies were
absent before immutable `npm ci`; no foreign dependency tree was reused.
All three tracked lockfile hashes remain unchanged.

**Execution RCA and escape analysis:**

| Issue / severity | Mechanism and resolution | Detection and earliest prevention |
|---|---|---|
| Browser action delivery / Medium | Concurrent locator actionability checks raced against dialog dismissal. Use one trusted pointer gesture and observe actual writes rather than inferring their count from the final value. | Preserved full native browser RED; earliest useful check is this focused real-browser case. The negative control closes the equal-value duplicate-write blind spot. |
| Private fixture correlation / Low | Immediate Prisma request-log readback returned zero matches before persisted evidence became available. The owned helper now polls the exact request-ID/path/status evidence with the established bounded parent-helper pattern. No application or test wait was added. | Preflight before the Prisma browser run; this is already the earliest fixture-admission boundary. |
| Compiler harness and test typing / Low | TypeScript 6 rejects explicit files without `--ignoreConfig`; scoped inputs also need Node types. A required added Window-property cast was rejected. Declare the observer property as optional and capture its typed array locally; the exact strict command above then passes. | Focused compiler, before commit; the editor also reports no errors in the final changed spec. |
| Documentation navigation / Low | The freshness checker treated `file.ts:line` navigation targets, relative or absolute, as nonexistent filenames. Use repository-relative source links with explicit verified line labels and `#L` fragments; preserve the existing checker and production source. Editor-specific fragment navigation is not claimed as verified. | Related-document F3 check; earliest useful check is link validation before commit. |

**Self-improvement: applied.** The duplicate-write negative control proves
that the strengthened assertion rejects an otherwise identical final token.
**Design disposition: accepted.** This remains a small, cohesive test-local
observer and gesture repair; no production strategy or abstraction is needed.
The private RCA was captured at fix confirmation from this bounded execution;
it is not a full historical-transcript reconciliation. No complete browser,
live, backend matrix, unit, coverage or benchmark qualification was rerun.
Parent delivery and separate private observer/zero-skip qualification remain
open. Overall migration is still incomplete, and Desktop remains retained.

### November 24 offline full-deployment admission

The local deployment pipeline now checks the cached tenant/subscription
against the **active dev role** before any cloud-mutating stage. A retiring
account context is rejected rather than silently targeting tenant 09.
The current dev estate declares anonymous GHCR, so it does not provide a
compatible approved ACR mirror default. Full deployment requires an explicit
`-RegistryAcr` for an existing approved active mirror and actual verified
import/push permissions. No ACR is guessed, created or waived.

The original mirror/import/digest, merged-master and shipping gates remain
mandatory. Dry-run admission and SkipDeploy admission require no mirror;
DryRun also avoids account/container prerequisite commands. See the
[canonical infrastructure guidance](DEPLOYMENT_INFRASTRUCTURE_AND_FORM_FACTORS.md#november-24-offline-deployment-admission-correction).
Offline semantic tests establish rejection/admission logic only. They do not
establish real account permissions, mirror availability, full-pipeline
success or deployed performance. The separate unpublished logging candidate
still fails HTTP performance and is not admitted by this correction.
Docker Desktop and its artifacts remain untouched.

The wiring follow-up scopes every ACR CLI operation to the active dev
subscription, including explicit approved mirrors. Different mirror
subscriptions are unsupported rather than inferred. Current canary capture
also resolves its app/group and pins its ingress read to the current
canary subscription. The pipeline always checks a supplied `-DevFqdn`
against the authoritative scoped current-dev ingress before HTTP capture;
foreign and alternate green-label hosts are rejected. The separate
blue/green promotion/verification flow is unchanged. SkipDeploy still needs
the actual authorized ingress read for its existing capture, but no mirror;
DryRun bypasses ingress and direct ACR tag-list commands.

Dev revision pruning receives the admitted subscription explicitly, and the
pruning dependency scopes each operation without switching cached accounts.
The existing retention and serving/rollback protection rules are preserved.

### Historical merged-source checkpoint, 2026-11-23

The consolidated source at this historical checkpoint was
`a7ef00012da717a5933cd9429a9d0afb771b1d2c`, following normal merges of
[root-tooling PR #284](https://github.com/pranems/SCIMServer/pull/284) and
[live-harness PR #285](https://github.com/pranems/SCIMServer/pull/285).
The combined reviewed tip `d3e5cec5` passed all 29 normal Fast push gates
and all six exact-tip PR checks in
[workflow 45287233922](https://github.com/pranems/SCIMServer/actions/runs/45287233922).
Exact CI inventory: API 220 suites/6,274 tests; reduced HTTP 2,519 passes
and 45 known backend skips; web 126 files/1,664 tests. The nonshipping
test image, container smoke and HIGH/CRITICAL-gating Trivy checks pass.
These checks do not replace the complete backend matrix or admit a release.

The guide itself is now included in the existing documentation currency
manifest. Permanent controls using its actual header first failed three
assertions, then passed all 30 self-test assertions after the minimal
manifest/marker correction. The full audit passes all 29 registered
documents, and existing documentation CI already invokes the self-test.
The header's product version states documentation scope only; dated
qualification records remain pinned to their actual source. The 30-day
verification-age setting retains the existing warning behavior.

On November 24 UTC, fresh exact-`a7ef0001` qualification completed all six
unchanged canonical modes. API units pass 220 suites/6,274 tests for each
backend; InMemory HTTP passes 2,575 with 45 known backend skips; PostgreSQL
HTTP passes 2,620 with zero skips; web unit and coverage each pass 126
files/1,664 tests. Coverage is 85.74% lines, 75.86% branches, 75.53%
functions and 83.06% statements. The original outer verifier exited 2 on
a snapshot Git needs-update marker. Its failed receipt is preserved;
separate reconciliation verifies identical raw bytes and Git object,
empty content diff, clean final status and unchanged input hashes.
All six canonical exits are zero. No snapshot was restored or regenerated.
Exact owned database/client cleanup, both listener closures and zero
remaining worktree test processes pass. Jest forced-exit advisories remain
visible. This is new merged-source evidence, not relabeled c52 history.

The same merged source separately passes all three jobs in
[candidate CI 45299868150](https://github.com/pranems/SCIMServer/actions/runs/45299868150).
Its image digest is
`sha256:1ad5ffb6f27350f68da2262b87224897028e1a686965561edf582904bdd2874f`.
The exact digest boots, serves discovery and passes the existing
HIGH/CRITICAL-gating Trivy policy. Validation confirms API220/6274,
reduced HTTP2519/45 known skips and web126/1664. The test tag is
`test-desktop-exit-merged-a7ef0001-20261124T004621Z`; no release/latest
tag, Azure deployment or shipping admission is claimed.

The actual repaired live runner and evidence-helper hashes match complete
fresh PostgreSQL and InMemory runs, each 1,845/1,845 assertions, 169 sections
and 2,060 flow steps, with exact owned cleanup. These ran against the
accepted c52 application image on independent native WSL Engine. PostgreSQL's
original private outer timestamp-parser failure is retained with a separate
exact-target/freshness/source-hash reconciliation; InMemory outer and child
both exited zero. Earlier c52 native browser qualification covers 35 outcomes,
12 InMemory and 23 PostgreSQL. These are not new shipping-image or Azure proofs.

Performance remains open, not waived. Complete host, Windows-container and
Linux-client runs passed 13/17, 14/17 and 13/17 latency categories respectively.
Four whole-artifact p95 increases above 10% remain unaccepted; the compared
application Node patches differ. A separate instrumented request-stage
diagnostic passes only 13/17 latency categories. A later actual CPU-profiled
c52 experiment captures 7,102 samples and 368 correlated requests but passes
only 10/17 instrumented latency categories. Its 45.258 ms clock-offset
uncertainty prevents exact attribution of 10-30 ms tails. Repeated tail
positions and PostgreSQL socket/Prisma stacks motivate testing the existing
50-row log flush, not removing logging guarantees or claiming a cause.
Both experiments have exact cleanup and are not release admission.
See the [request-stage findings](CUSTOMER_UPGRADE_PERFORMANCE_RCA.md#request-stage-diagnostic-2026-11-23).

Recorded source and integration reviews are honest COMMENTED self-reviews,
not independent approvals. Actual master protection and the delivery process
require exact-tip green CI and resolved findings, not a particular external
review service. Copilot review quota exhaustion was not bypassed or retried.

Docker Desktop, the original volume inventory and protected backups remain
retained. A fresh diagnostic's original-ID retention is not a new contents
preservation check. Final shipping-image/dev validation, preservation-safe
shared-admin authorization, native gallery/WIF validation and required
operator visual acceptance remain separate. The optional global
Desktop-backed MCP gateway is retained and unmigrated; the project-native
browser alternative is separately qualified. No uninstall, Intune consent,
customer-prod promotion or automatic canary is authorized by this report.

The dated sections below retain their original failures and intermediate
results. Read this checkpoint first rather than treating an older local
correction or dashboard count as the current acceptance state.

### Merged-source PostgreSQL qualification blocker, 2026-11-20

PR #275 merged at `9ee2a72d91ad1fc9cdee00782d18f1d84e481104`.
The independent Engine route and fresh 30-migration PostgreSQL replay passed.
The complete merged-source HTTP run then returned 2,613 passes, two failures
and zero skips on PostgreSQL. Publication and dev deployment remain blocked;
no shipping image or Azure write has occurred in this execution.

The two failures were in
[Cross-endpoint database inventory](../api/test/e2e/database-inventory.e2e-spec.ts).
Its generic worker-counter names repeat across test files. PostgreSQL retains
those files' different endpoints until global teardown, whereas each InMemory
app starts fresh. Global inventory correctly found 322 Users and 33 Groups
matching the searched names, contradicting the fixture's total-one assumption.
This was a test-isolation defect, not evidence that production search ignored
its filter.

A separate uniquely named database inside the exact labelled, tmpfs-backed
qualification container reproduced the failure through real API seeding:
both unchanged tests expected one and received two. UUID-based search values
then passed four focused tests on PostgreSQL with the retained collisions and
four on InMemory. Two new controls deliberately share a name across two owned
endpoints and require both matching rows, correct values and total two.
The original total-one checks remain unchanged. Endpoint cleanup requires
successful deletion and exact-ID absence.

| Execution issue | Root cause, resolution and prevention |
|---|---|
| Test correctness, High | Endpoint-local factory counters were treated as global identifiers. Use UUID search values only in this inventory spec; preserve global search with two-endpoint User and Group controls. No production query, factory, timeout, threshold or runner change. |
| Detection-stage escape | Full real-PostgreSQL HTTP found the defect. A focused retained-collision HTTP test could have caught it when the inventory spec was introduced; isolated InMemory and an empty database cannot discriminate this condition. |
| Tooling friction, Low | Targeting ESLint directly at this E2E file exposed unsafe raw response access, including existing accesses outside the normal source lint glob. Explicit transport-body types retain runtime value/shape assertions without disabling rules. Final strict lint passes with zero errors/warnings; both final focused backend runs remain four/four GREEN. |
| Test/gate improvement | Applied: duplicate-across-endpoints controls protect against incorrectly narrowing the production search to hide fixture collisions. Full merged-source PostgreSQL qualification is still required after normal review and merge. |
| Design/architecture disposition | Accepted: the correction stays in one small inventory spec. Production search, repository seams and shared fixture factories remain unchanged; a new abstraction would be speculative. |

This is tested but unreleased correction evidence, not completed qualification.
The six-mode run, immutable shipping, actual host/container/browser lanes,
dev preservation and deployment, native gallery matrix and operator visual
acceptance remain separate gates. The detailed execution report is under
`test-results/dev-deploy-2026-11-20-150000.md`; capture-time sections below
remain historical.

### Effect security recovery, 2026-11-20

The isolated recovery branch
`vprane/scimserver/containers-desktop-exit-cve-20261120` starts at
`87fcbdc153e1e2ba2d13f4fe3af3d8adb519d559`. The original release-owner
branch received the reviewed recovery through stacked PR #276; draft PR #275
remains open. The existing unshipped 0.55.68
candidate is retained: this dependency correction completes that candidate,
not a second unreleased version.

**Confirmed blocker:** Build Test Image run 44791352333 passed validation
and Windows runtime contracts but failed Trivy on Effect 3.20.0,
CVE-2026-121707 / GHSA-7589-6fvf-x4pw, rated HIGH by that scanner.
The [maintainer advisory](https://github.com/Effect-TS/effect/security/advisories/GHSA-7589-6fvf-x4pw)
rates it Medium, affects versions <=3.22.0 and fixes it in 3.22.1.
Its stated impact is excessive backtracking when untrusted input is decoded
by a template with multiple String spans. The patch uses linear matching.
This is not a claim that SCIMServer exposes that specific upstream path.

Approved-proxy npm metadata verifies 3.22.1 publication
2026-07-30T04:29:21Z and seven-day eligibility 2026-08-06T04:29:21Z.
The [stable GitHub release](https://github.com/Effect-TS/effect/releases/tag/effect%403.22.1)
was published 2026-07-30T04:29:42Z. No quarantine exception, registry change,
ignore or security-gate weakening is needed.

| Recovery boundary | Current evidence |
|---|---|
| Permanent manifest guard | RED: expected 3.22.1, received 3.20.0 before the manifest edit. |
| Permanent graph guards | Actual lock and installed owner each reproduced 3.20.0 RED. Unchanged tests now GREEN after CI artifact import and fresh npm ci. |
| Bootstrap | Normal Fast explicit-ref push passed all 27 gates in 652.7 seconds at `712ddcc7c8a0d4e19b1b463328004ebecef99c27`: 218 API suites / 6,261 tests; reduced HTTP 2,517 passes / 42 known skips. Not final locked dependency evidence. |
| CI-generated API lock | API-only run `44800892630` SUCCESS at exact bootstrap head. Authenticated artifact `14660962893`; only Effect changed. |
| Fresh installed tree | Approved-proxy npm ci installed 660 packages and preserved CI lock bytes. Four focused suites pass 67 tests in 8.525 seconds, including full npm-tree validity and actual Effect owner resolution. |
| Final normal Validate push | PASS at `1d4e4bc294bff3f0b7bb39ff3fdc6a6eb5c4465b`, 30/30 gates: API 218/6,263; reduced HTTP 2,517/42 known skips; web 126/1,664, zero worker errors. |
| Exact recovery image | Nonshipping run [44806899588](https://github.com/pranems/SCIMServer/actions/runs/44806899588) PASS at that exact head: validate, Windows contracts, smoke and Trivy. Verified image-layer readback found actual Effect 3.22.1. No local container started. |
| Parent integration | Reviewed stacked [PR #276](https://github.com/pranems/SCIMServer/pull/276) merged into migration branch at `2c1c74cfdae84d267755cf0b4d2719d6b5303a53`; original final-tip CI and master merge remain separate gates. |

### Deployment preservation correction, 2026-11-20

Stacked [PR #277](https://github.com/pranems/SCIMServer/pull/277) corrects the
existing verifier, not the application API. Its complete 261-assertion offline
contract is now invoked by the normal runtime runner. Original helper RED
included silent failed requests, null totals, incomplete endpoint inventory
and missing requested baselines. All now fail closed; valid zero remains valid.

Real read-only qualification on deployed 0.55.67 captured and compared all
76 endpoint IDs, with equal per-endpoint stored User/Group totals summing to
1,175/428. A legitimate User-only profile caused the original Group404:
SCIM-visible collections cannot establish complete stored inventory. The
replacement uses existing admin statistics and an explicit compatible count
basis, never 404-to-zero. This measures endpoint IDs and stored totals only,
not resource IDs/content, memberships or a transactional database snapshot.
See [architecture, coverage and execution RCA](DEPLOYMENT_PRESERVATION_VERIFIER.md).

The original isolated `67789d16` passed all 27 normal Fast gates, including the
261 assertions, API 218/6,259 and reduced HTTP 2,517/42 known skips. The current
branch merges the already-reviewed Effect target and requires its own normal
push/CI before merge. Bridge remains offline; no source or image is deployed.
Test/gate disposition: applied through executable negative and positive
controls. Design disposition: accepted; reuse the existing statistics API
and cohesive verifier rather than introduce a generic framework.

### Effect execution RCA and historical bootstrap checkpoints

The following checkpoints retain the evidence available during repair.
The successful final-hook/image and reviewed-integration rows above supersede
their then-pending status without deleting the original failures.

**Execution RCA (security, HIGH):** the frozen exact override for Effect
remained 3.20.0, so normal resolution could not float to the newly required
patch. This repeats the already documented frozen-pin pattern, not a new
application architecture defect. Trivy caught it at image validation before
merge/deployment. The earliest deterministic regression boundary is the pin
test; the existing scheduled advisory watcher remains the earlier discovery
control. Updating the existing override and verifying actual locked, installed
and imaged packages removes that dependency version, rather than hiding it.

**Confirmed dependency fix:** public-registry CI lock run
[44800892630](https://github.com/pranems/SCIMServer/actions/runs/44800892630)
used exact bootstrap source `712ddcc7c8a0d4e19b1b463328004ebecef99c27`
and unchanged workflow/API-only input. Artifact `14660962893` ZIP SHA-256
`8e1c96c56606757d37a821c176464f9ada6433517eed246891b6c87b928ba8f2`
matched GitHub's authenticated digest before extraction.
Structural comparison across the complete package union proves exactly one
changed entry, `node_modules/effect`: version, public URL and SHA-512 change;
its dependencies and all other package/root metadata remain identical.
All 684 API package entries retain public provenance/SHA-512; root and web
locks remain unchanged. CI publication-age evidence records
2026-07-30T04:29:21.637Z, 113.617 days old at regeneration.
Imported API lock SHA-256 is
`8539d1cd316ee2f8e9315bb60e02c2cf4075c40a35666a2e819abb2317a1abf2`,
unchanged after fresh npm ci. Actual ownership is
`prisma@7.8.0 -> @prisma/config@7.8.0 -> effect@3.22.1 overridden`.
The restored exact graph-test drafts and all existing actual-consumer
contracts pass together (4 suites / 67 tests). This resolves the version
and bootstrap failures without admitting unrelated package drift.
Image security verification remains a separate required claim.

**Execution friction (tooling, LOW):** fresh checkout Jest/Vitest were absent,
confirmed by the first focused validation commands. Owned baseline npm ci
is the approved bootstrap prerequisite. One attempted log redirection used
an invalid absolute destination and failed before installation; the corrected
explicit session-artifact destination worked. No shared checkout was mutated.
Both issues were caught at their first command, with no detection escape.

**Bootstrap prerequisite (tooling, HIGH false-green risk):** the existing full-tree npm guard
correctly rejects old installed Effect 3.20.0 after the manifest becomes
3.22.1. The historical old-install bootstrap recipe predates this guard.
No test was disabled or changed. An owned `npm install --no-save
--package-lock=false --ignore-scripts --no-audit --no-fund`, with a seven-day
`--before` cutoff and exact Effect 3.22.1 through the approved proxy, attempted
the bootstrap without writing any tracked lock. It re-resolved the temporary
installation (74 added, 46 removed, 605 changed), so it is explicitly not
final graph evidence. Both existing pin and complete-tree suites then pass
40 tests, but that was insufficient: the normal Fast push rejected the wider
graph. All 25 static gates passed; API units reported 215 passing suites and
3 failing suites, 6,256 passed / 5 failed of 6,261 tests, in 35.191 seconds.
The entire blocked hook took 542.6 seconds and did not run the subsequent
HTTP gate. Unrelated Prisma advanced 7.8.0 -> 7.10.1, the superagent qs owner
range changed ^6.14.1 -> ^6.17.1, and the full tree contained invalid
mime-types 3.0.2. No branch was published.

The next clean npm ci with the new manifest stopped at EUSAGE:
`Invalid: lock file's effect@3.20.0 does not satisfy effect@3.22.1`.
The local attempted bootstrap commit is
`67d20333711c825400f455d70625dd080da4d9c2`.
The temporary installation was discarded by owned npm ci against the
temporarily restored original manifest; the intended 3.22.1 manifest was
then reinstated. Baseline Prisma 7.8.0 and Effect 3.20.0 are installed, and
all three tracked locks remain unchanged. Permanent actual-lock and
installed-owner tests each now fail explicitly on 3.20.0 (2 failed,
2 passed Effect cases; other cases intentionally unselected).

**Observed circularity:** publishing the changed manifest requires a valid owned
graph, but the sanctioned CI lock workflow requires that manifest to have
been normally published first. The historical bootstrap recipe predates the
complete-tree guard. An approved bootstrap prerequisite is needed; changing
the guard, filtering these failures, editing a lock locally or directly
writing the remote ref is not an acceptable resolution. The first full
unit gate caught the drift. The earliest possible gate was the complete
advisory-consumer/Prisma-parent focused set, not just the two initially
selected pin/context suites. Include that set in bootstrap preflight.
Final acceptance still requires the minimal CI lock artifact, clean owned
npm ci, complete normal Validate and fresh nonshipping image Trivy evidence.

**Authorized distinct prerequisite:** the parent explicitly allowed moving
only this worktree's existing API lock outside npm resolution scope and
restoring it byte-identically. The manifest-only command
`npm install --package-lock=false --ignore-scripts --no-audit --no-fund`,
retaining the seven-day `--before` cutoff and the approved proxy, changed
one package in 22 seconds. No explicit package argument was supplied.
The restored API lock SHA-256 is
`e1d38857578890934d3c19db56d672633ae8d362c55f7d99056e5e927844bb57`.
Actual Prisma remains 7.8.0 and Effect becomes 3.22.1; no direct Effect
dependency was added. The unchanged complete-tree, API advisory-consumer and
Hono-parent specs pass all 34 tests across three suites in 6.621 seconds.
This verifies the owned bootstrap prerequisite, not the final CI lock.
The earlier command's existing-lock influence is not proven: it also supplied
an explicit Effect package argument, so the two attempts differ in both respects.

**Test/gate self-improvement: applied.** Add permanent advisory-boundary,
exact manifest and actual graph regressions in the existing pin spec, without
disabling a failing test during bootstrap. The rejected bootstrap demonstrates
why existing actual-consumer guards must run together before another full
hook attempt. **Design disposition: accepted.**
The existing exact override, watcher and CI artifact route are sufficient;
another dependency abstraction would be speculative.

**Staged test delivery:** the exact manifest regression is committed and
active during bootstrap, as are all previously committed complete-tree and
consumer guards. Two prematurely authored, uncommitted graph-test drafts
already produced exact 3.20.0 RED receipts. They are retained unchanged with
that output for the final CI-artifact stage, not used to certify bootstrap.
No existing guard, hook selector or configuration changes. The final change
must reapply both tests, import the authenticated lock and freshly restore
the installation before any locked/installed dependency GREEN claim.

| Evidence boundary | Date | Meaning |
|---|---|---|
| Initial closing addendum | Earlier November 18 trial | Historical receipt, not the current readiness decision. |
| Completed local runtime qualification | November 18 | Engine and Podman functional runs, browser matrix, preservation and cold-start evidence. |
| Readiness corrections below | November 19 | New source changes, tested locally but not yet released or deployed. |
| Consolidated pipeline and Azure dev | Pending | Must validate the final source/image, not borrow an older green run. |
| Desktop uninstall / Intune consent | Not performed | Requires a deliberate final handoff after readiness acceptance. |
| Customer production | Not authorized | Dev permission is not production permission. |

```mermaid
flowchart LR
  H["Dated historical trials"] --> L["November 18 local qualification"]
  L --> F["November 19 readiness corrections"]
  F --> G["Final source and release gates"]
  G --> D["Azure dev: exact immutable image"]
  D --> A["Operator acceptance and removal handoff"]
  A --> R["Desktop removal: separate deliberate action"]
```

The sequence shows why a historical FAIL or NOT RUN remains useful evidence
without overruling a later test. Equally, a November 18 pass does not prove a
November 19 application correction or a new Azure deployment.

## 2. Dated acceptance dashboard and current qualification boundaries

| Requirement | State | Evidence / next action |
|---|---|---|
| Independent Engine and Windows clients | PASS for measured scopes | Native Unix-socket Engine qualification rechecked November 23 with fresh private client configuration and exact daemon identity. Independent Windows/SSH/GUI operations retain their November 19-20 evidence; no new bridge or reboot claim. No Desktop executable used. |
| Mermaid environment | PASS, November 19 | Doctor reports exactly one built-in renderer and no blockers. |
| Original data preservation | PASS, November 18 | Both cold VHD copies/configuration hashes; all 40 volume fingerprints; isolated primary recovery and 20-to-30 migration replay. |
| Complete Engine browser suite | PASS, November 24 executed 28f/merged-equivalent 82e | Each native InMemory and actual Compose Prisma run: 353 passed, zero failures/skips/flakes/unhandled errors, actual exit 0; 13 pixel comparisons and eight token tests pass. Earlier 352/one-failure runs remain FAIL. No baseline replacement or operator acceptance. |
| API/backend/web matrix | Composed six-mode acceptance at f8 | Units 220/6,274 each; full HTTP 2,620 Prisma / 2,575 InMemory with 45 known skips; web 126/1,664. Original canonical exit 1 and partial coverage FAIL remain preserved; only unchanged failed coverage lane was retried. Historical a7/c52 runs retain their own identities. |
| Native in-memory inventory | CORRECTED, local source | Actual-module and HTTP regressions reproduced zero rows before the fix. EndpointModule import restores endpoint enumeration. |
| Active log-stream shutdown | CORRECTED, local source | Real open HTTP stream blocked the three-second deadline before the fix; lifecycle cleanup now closes it without client-first disconnect. |
| Actual container active-stream shutdown | PASS, consolidation source 45885140 | A genuinely connected SSE client ends without client-first disconnect when Docker sends SIGTERM. Stop completes in 1,035 ms with exit 0 and no OOM kill; the final correlated request has one durable database log row. Restart preserves the original user ID/value. Owned endpoint deletion/status/absence and exact full-container-ID cleanup pass. This is a local nonshipping image, not Azure dev evidence. |
| Neighboring native unit coverage | PASS, November 19 | Four suites, 103 tests including inventory wiring and stream cleanup. |
| Focused native HTTP coverage | PASS, November 19 | Two suites, three tests: user/group inventory and active-stream application close. |
| API compilation | PASS, November 19 | `npm run build`. |
| Changed API lint | PASS, November 19 | Zero errors; one warning on an unchanged pre-existing assertion. No unrelated lint cleanup. |
| Packaged migration/configuration | PASS, focused November 19 qualification | Four launchers select the packaged Prisma 7 configuration and stop on migration failure. The actual Prisma package applies all 30 migrations to a fresh owned Engine database, starts successfully, passes 1,845 live checks and the user/group browser roundtrip. Failure-path contracts have 54 assertions. |
| Clean standalone installation | PASS, November 19 consolidation | Actual builder installs 660 API and 256 production packages, builds the current web application and produces a 445.9 MB package. Both source lockfile hashes remain unchanged. The clean package applies all 30 migrations to a new uniquely labelled tmpfs Engine database on an assigned loopback port, passes 1,845 reported live checks and the owned user/group browser roundtrip. The package still identifies the 0.55.67 pre-version-bump source; this is clean-install proof, not a published 0.55.68 artifact. |
| Current packaged browser | PASS, Prisma and in-memory | Each mode passes the user/group inventory, reload, actual displayed row values and original SCIM-ID readback regression. This is not a new complete 353-case run. |
| Graphical management | PASS for measured scope, November 20 | Actual image/OCI-label inspection, all 49 volume names and read-only metadata, individual lifecycle/logs, exact independent emitted executable, real-repository reload, and new Windows-created Compose Start/healthy, Logs/ready, Stop/refreshed Exited(0) pass. All GUI fixtures and the isolated GUI/CDP process were removed. Historical Linux-created group commands remain a documented Windows-cwd limitation; generic GUI Up/build/watch and registry publication are not qualified. |
| Image metadata and retention | CORRECTED, local source | Ten metadata/caller checks pass after reproducing the dispatch-publisher omission and absent automatic contract execution. The pre-consolidation inventory had five records; the added nonshipping local qualification image is retained. No repository needed pruning. New authoritative publication/label/digest readback remains pending. |
| Automatic offline runtime gate | PASS, combined d3e5cec5 | Normal Fast push passes all 29 gates, including the common runtime contracts. Exact-tip Windows/Node 24 CI runtime contracts also pass in workflow 45287233922. This is not a fresh GUI/reboot or shipping-image claim. |
| Normal startup/reconnect workflow | PASS for measured transport/GUI scope | Actual cold transport starts from verified listener absence and failed GUI tree; the real startup task restores the exact repository and same daemon/image. Owned GUI task/listener/GUI/CDP cleanup passes. Not a WSL/Engine reboot; explicit operator visual acceptance remains open. |
| Documentation | PASS, focused November 19 | Freshness/coupling: all 27 docs; infrastructure: all 13 elements covered; 55 literal JSON blocks parse; links/style pass. New report diagrams render in strict light/dark Chromium. |
| Final ordered pipeline | BLOCKED | Local qualification is complete within the November 24 scope; ordered Azure pipeline still needs existing approved active ACR mirror and actual permission evidence. No funding approval or new resource authorized. |
| Azure dev | OPEN | No new deployment; performance, gallery/directory flows and operator visual acceptance remain separate. Do not reuse an older account/session check as current authorization. |

The November 19 raw native in-memory and both packaged-backend runs each report 1,845
passes and zero failures, including four added inventory-envelope/row checks.
These counts still include four retired-API placeholders; they are not 1,845
independently exercised HTTP cases.
Functional timings were measured under different workloads and are not a
comparative performance benchmark. Existing Jest forced-exit warnings are
not represented as clean-process proof.

## 3. Selected architecture and operating boundaries

```mermaid
flowchart LR
  P["Windows PowerShell: independent clients"] --> S["Pinned SSH on loopback"]
  V["VS Code Container Tools: selected local GUI"] --> S
  S --> E["Docker Engine in Ubuntu WSL"]
  E --> A["SCIMServer application"]
  A --> B["Independent PostgreSQL working volumes"]
  O["Original Desktop disks: retained"] --> C["Verified cold preservation"]
  O -.-> F["40 preserved Engine volume copies"]
```

The GUI and terminal must address the same Engine and return the same image
and container IDs. A running GUI is not itself proof of correct selection.
Preserved original volumes are not working databases: clone one before
writable recovery. Never use blanket volume prune or `down --volumes`
against carried projects.

The current startup bridge is foreground and process-scoped. It must remain
open while the Windows SSH route is in use. Persistent startup and any change
to other windows' defaults are separate behavior changes, not implied by
installing the independent client.

See the [existing activation/startup runbook](CONTAINER_RUNTIME_MIGRATION_ASSESSMENT.md#operator-workflow-for-the-installed-windows-route).

## 4. Graphical management comparison

| Option | Engine/WSL SSH route | Podman route | Decision |
|---|---|---|---|
| Microsoft VS Code Container Tools | Documented Docker CLI/SSH support; inspect image JSON, labels, tags, containers, logs, volumes and registries | Native Podman client supported; qualify the selected connection | Primary candidate: already installed; avoids adding a privileged web service. |
| Podman Desktop | Released Docker provider skips SSH/TCP contexts; Unix sockets and named pipes are different supported transports | Strong fit for its independent rootless Podman machine | Best native Podman GUI candidate, not the primary Docker-over-SSH GUI. |
| Portainer Community Edition | Connect inside WSL through the Docker socket, not the Windows Docker context | Rootless Podman not officially supported | Standalone dashboard fallback; adds daemon-level socket privileges and authentication/TLS obligations. |
| Dockge | Primarily Compose-stack management with socket access | Podman listed; rootless equivalence not proven | Not the best fit for image-label and publication inspection. |

All four have no-cost open-source editions/licenses; this is not a claim
that an internal corporate approval body has independently approved every GUI.
VS Code Container Tools is already installed on this device. A GUI does not
migrate image stores between Docker and rootless Podman.

Sources checked November 19, 2026:

- [Microsoft: connect Container Explorer over SSH](https://code.visualstudio.com/docs/containers/ssh).
- [Microsoft: Container Tools overview](https://code.visualstudio.com/docs/containers/overview).
- [Podman Desktop remote connections](https://podman-desktop.io/docs/podman/podman-remote).
- [Podman Desktop released Docker context implementation](https://github.com/podman-desktop/podman-desktop/blob/v1.30.7/extensions/docker/packages/extension/src/docker-context-handler.ts).
- [Portainer Docker connection methods](https://docs.portainer.io/admin/environments/add/docker).
- [Portainer Podman support boundary](https://docs.portainer.io/start/install-ce/server/podman/linux).
- [Dockge scope and deployment](https://github.com/louislam/dockge).

### GUI acceptance, not just installation

The dedicated local workspace is
`%LOCALAPPDATA%\SCIMServer\SCIMServer-Independent-Engine.code-workspace`.
It was opened in a new VS Code window. Its `containers.environment` and
terminal environment name the independent Windows Docker client directory,
the independent Docker configuration, and `ssh://scimserver-engine-wsl-trial`.
`DOCKER_CONTEXT` is cleared so a context cannot override that endpoint.
Its Azure configuration directory is resolved from the active estate registry,
not copied from an old tenant. No global setting or original checkout setting
was changed. This generated machine-specific file is intentionally not committed.

**Actual acceptance finding:** environment PATH is insufficient. The installed
Container Tools 2.5.3 rendered the independent Engine tree and fetched real
logs, but its generated View Logs task invoked the executable under Docker
Desktop. Uninstalling Desktop would break that action. Container Tools 2.5.3
requires BOTH `containers.containerCommand` and `containers.composeCommand`
to contain only the full independent `docker.exe` path. Do not put additional
quotes, `--config`, `--host`, or a `compose` suffix inside either setting.
The flags were treated as part of the executable and produced ENOENT; the
Compose suffix triggered the extension's unsupported Compose V1 error.
Keep `DOCKER_HOST`, `DOCKER_CONFIG`, empty `DOCKER_CONTEXT` and PATH in BOTH
`containers.environment` and `terminal.integrated.env.windows`.

The shared runtime helper now exports `Get-IndependentContainerToolsSettings`.
First activate the existing qualified client/profile/host with
`Enable-IndependentContainerRuntime`, supplying the same approved daemon-side
`BindSourceRoot` and `LogDirectory` used for Compose. Then generate the settings
below. The generator reruns the shared runtime/plugin/credential preflight,
pins both bare command paths and carries the activated Compose mount variables
to both environments. It neither starts the bridge nor changes global settings.

```powershell
. .\scripts\independent-container-runtime.ps1
Enable-IndependentContainerRuntime @qualifiedRuntimeParameters | Out-Null
$settings = Get-IndependentContainerToolsSettings
$workspacePath = Join-Path $env:LOCALAPPDATA 'SCIMServer\SCIMServer-Independent-Engine.code-workspace'
$workspace = Get-Content -LiteralPath $workspacePath -Raw |
  ConvertFrom-Json -AsHashtable
if (-not $workspace.Contains('settings')) {
  $workspace.settings = @{}
}
foreach ($entry in $settings.GetEnumerator()) {
  $workspace.settings[$entry.Key] = $entry.Value
}
$workspace | ConvertTo-Json -Depth 20 |
  Set-Content -LiteralPath $workspacePath -Encoding utf8
```

`qualifiedRuntimeParameters` is the previously verified activation hashtable,
not an alternative preflight. Preserve the existing workspace folders, startup
task and registry-resolved Azure profile. Do not copy this machine-specific
workspace into the repository.

Actual GUI Start and View Logs now pass with a fresh owned fixture. The captured
terminal command names the independent LocalAppData executable and exact full
fixture ID `dc47d605d27c17336df539a4cdbe30c592931b77a15c6517a8c74cd61f98c1ba`;
see `test-results/ui-screenshots/container-tools-independent-command.txt` and
`container-tools-terminal-command-proof.*`. These are real GUI command proofs,
not CLI substitutes. Final parent-owned reload/Compose/volume/cleanup receipts now pass within the
bounded scope below. They do not establish cold bridge startup or operator
visual acceptance.

The later coordinated cold-transport test below supersedes only the earlier
cold-start hold. Explicit operator visual acceptance remains open.

### Actual GUI completion and host-path boundary, November 20

| Measured outcome | Result and evidence |
|---|---|
| Carried release image | GUI inspector shows revision `b87412b0ad5edac47bf19aaca92bb233c12304ed`, source repository and actual version label `master`. This is not a new patch-release label. |
| Volume inventory and metadata | All 49 GUI names exactly match the stable Engine inventory; read-only inspection confirms the selected volume Name and driver `local`. No preserved volume was mounted writable. |
| Individual lifecycle/logs | Owned isolated tmpfs PostgreSQL reaches healthy, exposes actual ready text and independent terminal command, then stops with exit zero. |
| Reload reconnect | After real window reload, require the exact `scimserver-exit` repository and reject connection-warning placeholders. Presence of any tree item alone is insufficient. |
| Windows-created Compose group | Actual GUI Start plus healthy row, Logs plus ready text, and Stop plus refreshed `Exited (0)` row pass. Command scrollback proves independent `docker.exe compose`, the Windows fixture path and exact owned project. Closing only the log-follow terminal leaves the service healthy. |
| Historical Linux-created Compose group | Group Logs fails before client launch because its Linux working-directory/configuration labels are not Windows paths. Preserve the project; use native CLI or individual-container operations. Do not rewrite labels, recreate originals or add a compatibility junction. |
| Cleanup | All three owned networkless/tmpfs fixture instances are removed after ID/label/isolation/stopped/exit checks. GUI PID 89160 is absent and loopback CDP 19333 is closed. The shared SSH bridge remains available for release work. |

Primary local receipts are under `test-results/ui-screenshots`:
`container-tools-verify-release-labels.*`,
`container-tools-verified-volume-names.json`, `container-tools-volumes.*`,
`container-tools-reload-window.*`,
`container-tools-independent-compose-command.txt`,
`container-tools-compose-fixture-start.*`,
`container-tools-compose-fixture-logs-proof.*`,
`container-tools-compose-fixture-stop.*` and
`container-tools-owned-fixture-cleanup.json`.
Screenshots are ignored qualification artifacts, not new committed UI baselines.

The Windows-created fixture proves that Compose Start/Logs/Stop command path,
not generic SCIM Compose Up/build/watch. Continue to activate the project
runtime preflight and approved daemon-side source/log roots for the application.
The read-only settings-generation receipt used the existing workspace without
mount overrides; it is not evidence that GUI application bind mounts work.
Registry authentication/publication, final release/dev and
explicit operator visual acceptance remain separate gates.

In that window use **Terminal > Run Task > SCIMServer: start independent
Engine bridge**, then open the **Containers** view. The task runs the existing
foreground startup helper in a dedicated terminal, permits only one instance,
and does not install an autostart/system-wide service. Keep that terminal open
while using the SSH route. Actual Explorer/reload acceptance above passes.

### Actual cold-transport startup, November 20, 01:55-02:02 UTC

During a coordinated container-work pause, the parent stopped only its old
bridge and proved loopback 22222 absent. Isolated GUI 91852 then displayed a
real failed-connect tree. Actual Tasks: Run Task selected the existing
`SCIMServer: start independent Engine bridge` task. Its terminal reported
listening on 127.0.0.1:22222 and the Images view recovered the exact
`scimserver-exit` repository without a failure placeholder.

Independent readback retained daemon
`68f34f63-05bc-488a-b093-402808b594b2`, Ubuntu 24.04.5/Engine 29.1.3 and image
`sha256:e5b02bc608cd6caca71577d344e56ce71f026e44d737823c34c925b47dbdfe52`.
The verified GUI-owned task was closed through terminal UI, its listener was
proved absent, and GUI 91852/CDP 19333 were verified closed. The parent restored
its separately owned attached bridge for release work; coordinate before
stopping it. This proves cold transport/GUI, not cold WSL/Engine reboot or a
SCIM application restart. No original project/container/data changed.

Receipts include `container-tools-bridge-offline.*`,
`container-tools-bridge-task-start.*`, `container-tools-bridge-reconnect.*` and
`container-tools-bridge-task-stop.*` under the ignored screenshot directory,
the private `readiness-gui-cold-bridge.json`, and
`test-results/readiness-post-cold-gui-bridge.txt`.

The earlier owned `scim-readiness-pg` comparison container was stopped cleanly
after qualification; its volume is retained. New GUI acceptance used fresh
networkless/tmpfs fixtures and removed only their verified full IDs. Reuse
that isolated-fixture pattern for later checks; do not mutate a preserved
original or target its volume for cleanup. Compare the fixture image ID with
the terminal, then use **Inspect** for actual image/configuration JSON.
The next checklist is not marked passed merely because settings/tasks exist.

1. Select the independent endpoint and compare Engine, image and container IDs
   with the terminal.
2. Inspect an image's actual `Config.Labels`, tags, architecture and digest.
3. Inspect a container's configured image, actual health state and recent logs.
   Inspect the generated terminal command too: its executable must name the
   independent client, with profile/host supplied by the qualified environments,
   never a Desktop installation or arguments embedded in the command setting.
4. Confirm volume names without opening preserved originals writable.
5. Inspect a published registry reference separately. A Buildx `--push` image
   is not necessarily loaded into the local image store.
6. Reconnect after a normal runtime restart without requiring Desktop.
   Reload the editor and repeat an actual terminal-backed action to prove the
   executable override persists; a healthy Explorer tree alone is insufficient.

## 5. Image retention and publication

Retain the newest five distinct image versions per repository/type by default,
not five aliases for the same image. Also retain images used by retained
containers, the current verified release/rollback image and any explicitly
needed database-major recovery image. Record each exception and remove only
explicitly identified image IDs. Never treat a volume as an image-cleanup target.

Before consolidation, the independent Engine had five image records in total: the source
SCIMServer image, a carried release image, Node 24 and two PostgreSQL records.
Consolidation adds a nonshipping `scimserver-exit:local-45885140` validation
image with explicit source/version labels. This does not create an over-five
version family requiring deletion. The full cold
Desktop disk backup is a deliberate recovery artifact, not an active image
cache. Selectively changing it would invalidate the preservation receipt.

Image tags, image configuration labels and manifest/index annotations are
different metadata. The GUI must show what is really present, not infer
publication from a tag name. Existing metadata-action publishing paths and
the separate dispatch publisher need to agree.

The carried release image has real `org.opencontainers.image.*` labels,
including its source, revision, created time and version. The original local
source-built trial image has **no configuration labels**. A local tag does
not repair that absence and does not prove GHCR publication.
The dispatch publisher now reuses the same pinned `docker/metadata-action`
as the other two build workflows and passes its labels to Buildx. It also
passes the explicit application image tag into the existing Dockerfile
build argument. Semantic-version and full-source-SHA tags, the expected-SHA
guard and optional `latest` behavior remain unchanged. Actual corrected
registry-label/digest readback remains a post-publication gate.

### Worked example: reading the existing release correctly

| What the independent Engine actually reports | Interpretation |
|---|---|
| Carried SCIMServer image ID `302c85387b6e`, no local tag | It was carried by immutable digest, not loaded with a semantic-version alias. |
| OCI revision `b87412b0ad5edac47bf19aaca92bb233c12304ed` | Compare this with the reviewed source identity, not with a friendly container name. |
| OCI version `master` | This older branch-build label is not the application's package version, 0.55.67. |
| Source trial `scimserver-exit:engine`, ID `e5b02bc608cd`, labels absent | Its local tag proves neither OCI label injection nor GHCR publication. |
| Owned database `scim-readiness-pg`, container `dac00ef36978`, image `58b1ad1807d8` | This is a safe live GUI-comparison target, not one of the preserved original databases. |

Use the Containers tree to select the database, inspect its configured image,
then select that image in Images and inspect its actual labels. Use the
Registry view or Buildx digest inspection separately for publication. The IDs
above are dated local observations, not IDs future machines should hardcode.

No old image was deleted: no active independent repository exceeds five
distinct versions. The verified cold Desktop snapshots intentionally still
contain their old image caches. Keeping those complete snapshots until
removal acceptance is the recovery exception, not a recommendation to copy
every old image into the new active runtime.

## 6. Azure dev and final release sequence

```mermaid
sequenceDiagram
  participant T as Local source and tests
  participant P as Reviewed PR and exact-tip CI
  participant I as Immutable merged-source image
  participant D as Azure dev
  T->>T: Focused RED, minimal fix, GREEN
  T->>P: Consolidate one coherent release unit
  P->>I: Build and scan reviewed merged source
  I->>D: Deploy the same digest, preserving data
  D->>D: Live SCIM, browser, IDs and data comparisons
  D-->>T: Record every gate and remaining acceptance item
```

Use the established deployment pipeline and estate registry. Do not copy an
old tenant/FQDN from a historical report. Existing Azure authorization has
been checked against the active registry-selected dev tenant, but that is
not deployment evidence. Do not bypass the shipping-ref check to deploy
unreviewed dirty source. No customer production promotion is authorized.

## 7. Execution issues and root-cause ledger

| ID | Type / severity | Symptom and root cause | Fix, verification and earliest prevention |
|---|---|---|---|
| R1 | Renderer lifecycle / Low | CLI uninstall left the obsolete extension directory on disk; the doctor still detected its preview scripts. | Verified the exact already-uninstalled directory, removed only it, then doctor passed. Gate: doctor after removal, not uninstall exit status alone. |
| R2 | Module wiring / High | Native in-memory inventory returned zero rows because DatabaseModule did not import the module exporting EndpointService; optional injection silently returned an empty endpoint list. | Import EndpointModule. Two actual-module unit regressions and two real HTTP user/group cases pass after observed zero-row RED. Earliest gate: real-module integration, not manually supplied service mocks. |
| R3 | Application lifecycle / High | Active SSE responses were cleaned only on client disconnect, so server close waited indefinitely. | Track each stream cleanup; close subscriptions, timer and response before HTTP server close; reject new streams during shutdown. Unit and real open-stream HTTP RED/GREEN pass. Earliest gate: shutdown with an active client. |
| R4 | Unit harness / Low | Importing the real EndpointModule exposed its ConfigService requirement, absent from the isolated test. | Add the standard global ConfigModule with environment-file loading disabled; four nearby suites/103 tests pass. No production workaround. Earliest gate: module fixture dependency parity. |
| R5 | HTTP harness / Low | The new shutdown spec called listen twice because createTestApp already binds an ephemeral server. | Reuse that owned listener; genuine three-second shutdown RED then GREEN. Earliest gate: inspect shared test bootstrap before adding a second listener. |
| R6 | Packaged runtime / High | The standalone migration launchers omitted Prisma 7 configuration and could start the application after a failed migration. | Package and explicitly select prisma.config.ts; invoke the packaged CLI and check native exit status in all four launchers. Negative real-Prisma tests stop at P1001 before startup; 54 contract assertions pass. Positive owned-PostgreSQL replay applies 30 migrations, then 1,845 live checks and browser readback pass. Earliest gate: packaged success and failure paths, not repository CLI success. |
| R7 | Windows native failure handling / High | The initial batch correction used if errorlevel 1, which tests for a positive threshold, not every nonzero native failure. A negative Windows exit code bypassed it and could start the application after failed migrations. | Compare native exit status with zero instead; normalize signed/unsigned spelling in assertions without weakening the nonzero requirement. Real launcher fixtures cover positive and negative failure codes, startup suppression and bundled-database cleanup. Earliest gate: signed native-process failure fixture before accepting a failure-closed claim. |
| R8 | Validation target / Medium | The raw compiled API served the legacy api/public UI; the new Operations browser test could not find the current inventory flow. The inspected screenshot confirmed the old navigation. | Qualify the current standalone package, whose static tree is SHA-256-equal to current web/dist, instead of modifying legacy files or replacing visual baselines. Both package backends now pass actual user/group browser readback. For native development use the current Vite frontend with the API, or the assembled package. Earliest gate: verify the actual served SPA asset identity before UI acceptance. |
| R9 | Browser fixture/cache expectation / Medium | Creating a group through HTTP after the page had already prefetched groups left its cached empty result; selecting the tab did not promise another GET. The inspected screenshot showed that empty cached view. | Navigate freshly to /operations?tab=groups before expecting a new response, then verify the visible row, original resource ID and reload. Both real package backends pass. No production cache policy or pixel baseline changed. Earliest gate: align network waits with actual query lifecycle. |
| R10 | Readiness probe / Low | A hand-written probe used /health rather than the documented /scim/health route and retried a wrong route after startup. | Use the established health path and verify its JSON before browser qualification, matching the existing Playwright preflight. Distinguish initial connection refusal from a non-retryable route error. Earliest gate: reuse the repository health contract. |
| R11 | Publishing metadata / Medium | The dispatch GHCR publisher did not propagate the OCI labels used by the other build workflows, weakening GUI/source identification. | Reuse the pinned metadata action, propagate labels and set the existing IMAGE_TAG build argument. Observed missing-label RED then passing contracts preserve version/SHA tags and the expected-SHA guard. Actual registry readback awaits publication. Earliest gate: test every shipping workflow, not a single sibling. |
| R12 | Gate reachability / High | The new offline contracts existed but the standard pre-push, dev pipeline and CI did not invoke them; manual trial success alone would not protect later changes. | Reproduce absent caller wiring as RED; add one common seven-suite runner called by all three delivery surfaces. All 118 assertions pass through that actual entry point. Windows CI selects Node 24 and gates its image job on the contract job. Earliest gate: caller execution plus assertion outcome, not test-file presence. |
| R13 | Documentation coupling / Low | The freshness gate found three logging/diagnostics guides that had not been updated with the stream-shutdown behavior. | Update the three bound user-facing guides with explicit unreleased behavior, reconnect guidance and the current evidence link. The same F4 gate passes for all 27 documents; infrastructure coverage also passes. Earliest gate: consult manifest bindings while planning the source change. |
| R14 | Tool invocation / Low | The customization contract rejected an invented Worktree selector; its supported inputs are Index and Head. | Stage only the owned deployment-skill file and run the supported Index contract. All assertions pass against that actual proposed file. Earliest gate: inspect the parameter contract before invoking it. No unrelated file was staged. |
| R15 | Research source churn / Low | Three guessed Podman Desktop documentation paths returned HTTP 404. | Use verified current official pages and the released provider's versioned source; the GUI comparison cites working evidence rather than treating a missing page as missing functionality. Earliest gate: verify documentation URLs before using them as evidence. |
| R16 | Test discovery / Low | The native editor test tool did not discover tests in the separate task worktree. | Use the repository's existing Jest runner from the correct API directory; observed RED and final 103 unit/three HTTP outcomes replace an empty discovery result. No package installation was needed. Earliest gate: verify the tool's workspace scope and require actual test counts. |
| R17 | Read-only navigation / Low | One file-scoped search timed out, an assumed line range exceeded a file, and an obsolete prompt path did not exist after the repository's skill migration. | Use bounded actual-file reads and the current deployment skill referenced by the script. These were navigation/tooling misses, not missing application functionality. Earliest gate: discover current paths and line bounds instead of relying on old names or guessed offsets. |
| R18 | Dependency fixture fidelity / Low | A copied-package probe withheld @prisma/config and failed before datasource loading; that removal did not model a normal production installation. | Restore the production optional-peer closure. npm ls --omit=dev confirms @prisma/client -> optional prisma -> @prisma/config; the fixture removes only dev:true entries, retaining devOptional. All four real-CLI negative trials and both positive package workflows pass. This does not claim a fresh production install. Earliest gate: verify the actual dependency graph before simulating pruning. |
| R19 | JSON tooling / Low | Default ConvertFrom-Json rejected the standard lockfile root-package key, an empty string. | Parse it with -AsHashtable instead of a PowerShell object. Dependency classification and corrected package qualification then pass. Earliest gate: choose a parser representation that supports the lockfile's actual keys. |

### Distribution and detection-stage escape analysis

```mermaid
pie showData
  title "Readiness execution issues by severity"
  "High: false-green or application correctness" : 5
  "Medium: validation or metadata mismatch" : 3
  "Low: local tooling and documentation friction" : 11
```

The chart counts execution issues, not remaining vulnerabilities or deployment
failures. All 19 local corrections are recorded; downstream acceptance is
tracked separately in the main dashboard.

| Issue family | Entries | Count |
|---|---|---|
| Test/tooling/query-lifecycle harness | R4, R5, R9, R10, R14, R16, R17, R18, R19 | 9 |
| Application/module/packaging correctness | R2, R3, R6, R7 | 4 |
| Delivery metadata and gate reachability | R11, R12 | 2 |
| Renderer lifecycle | R1 | 1 |
| Wrong validation artifact | R8 | 1 |
| Documentation coupling | R13 | 1 |
| Research source churn | R15 | 1 |

```mermaid
pie showData
  title "Readiness execution issues by type"
  "Harness and tooling" : 9
  "Application and packaging" : 4
  "Delivery metadata and gates" : 2
  "Renderer lifecycle" : 1
  "Validation artifact" : 1
  "Documentation coupling" : 1
  "Research source churn" : 1
```

The type chart makes the main prevention opportunity visible: qualifying the
assembled test and delivery workflow matters as much as the runtime installation.

| Entries | Actual detection | Earliest useful gate | Escape lesson |
|---|---|---|---|
| R1 | Doctor after extension uninstall | Same post-uninstall doctor | CLI success is not filesystem/viewer state. |
| R2, R3 | Real native inventory and active-stream workflow | Actual-module unit and active-client HTTP shutdown | Service mocks/idle-server shutdown missed the assembled behavior; new regressions close the earlier stage. |
| R4, R5, R9, R10, R14, R16, R17, R18, R19 | Focused test/tool execution | Existing fixture, route, workspace, dependency-graph and parameter contracts | Most are one-stage harness friction, not application regressions. |
| R6 | Generated standalone migration launch | Generated-launcher failure contract plus real package success | Repository migrations did not qualify packaged migration behavior. |
| R7 | Negative native-exit regression after the first batch correction | Positive and negative exit-code cases together | A positive-only native guard is not failure-closed. |
| R8 | Browser navigation after API health passed | Served-SPA asset identity | A healthy backend can serve the wrong frontend. |
| R11 | Actual image metadata and publisher comparison | All shipping-workflow contracts | One correctly labelled sibling did not prove dispatch publication. |
| R12 | Delivery-caller inspection after manual contracts passed | Caller registration when adding the tests | A test not invoked by delivery is not a lasting gate. |
| R13 | F4 documentation-coupling check | Manifest-bound documentation planning | The existing structural gate caught the omission before consolidation. |
| R15 | Official-page HTTP 404 | Verify a cited page or released implementation | A guessed URL is not product evidence. |

```mermaid
flowchart LR
  E["Renderer and research: R1/R15, two"] --> N["Native fixtures and lifecycle: R2-R5/R16, five"]
  N --> P["Packaging and served artifacts: R6-R10/R18-R19, seven"]
  P --> G["Metadata and automatic gates: R11-R12, two"]
  G --> D["Documentation and navigation: R13-R14/R17, three"]
```

This grouping shows where execution friction accumulated, not exact chronology, elapsed time or
service latency. No commit SHA is attached because these corrections are still
uncommitted local source.

### Consolidation execution ledger

The preceding charts describe the historical local-correction boundary of
19 issues. The following entries belong to the separate consolidation context.
They do not change the earlier receipt or imply that release/dev gates passed.

| ID | Type / severity | Symptom and root cause | Fix, verification and earliest prevention |
|---|---|---|---|
| R20 | Packaging / High | The real builder could retry failed npm ci with npm install, potentially rewriting lockfiles locally, and did not check Prisma generation, web installation/build or production-install status. A failed stage could therefore produce a success-shaped package. | Five new assertions first fail, then pass after removing the fallback and guarding every native stage. The actual clean builder succeeds with 660 API and 256 production packages, current web build and unchanged source lockfile hashes. Earliest gate: failure-closed checks for the real builder as well as generated launchers. |
| R21 | Build environment / Low | The first clean build stopped at PrismaConfigEnvError because Prisma 7 evaluates DATABASE_URL even for generate, which never connects. Earlier assembled artifacts had hidden this prerequisite. | Supply a deliberately nonconnecting, build-only loopback datasource for generation, matching the existing Dockerfile convention. The complete clean builder then succeeds; runtime migrations separately apply all 30 migrations to the owned real database. Earliest gate: explicit build environment before invoking the clean builder. No production connection string or authentication is needed. |
| R22 | Fixture ownership / Medium | The new runtime browser case created a unique name but had not proved that its returned endpoint ID was absent before assigning a teardown target. A unique name alone is not ownership evidence. | Reuse the established createFixtureEndpoint pre-create inventory guard before seeding, and retain API-request cleanup with successful status and exact-ID absence assertions. The real clean-package browser case passes user/group values, reload and original-ID readback. Earliest gate: fixture ownership review before running against carried dev data. |
| R23 | Release metadata / Low | The first normal Validate pre-push stopped at content check C13: the version-header fixer does not update the README version badge, which still said 0.55.67. | Update the badge to the target 0.55.68; the same content gate passes for all 27 documents. The blocked push is retained, not bypassed. Earliest gate: verify badges with content audit after header repair; header freshness alone is not complete version-reference evidence. |
| R24 | Integration harness / Low | The first container proof passed active-client SIGTERM, exit 0 and durable logging, then its added restart probe timed out because it reused the old automatically assigned host port. Docker reassigned that port on restart. | Read the actual published port again after start. The unchanged image then passes stream end, 1,035 ms clean stop, durable log, original-ID/value readback, owned endpoint cleanup and exact container removal. The initial failed receipt remains archived. Earliest gate: treat an assigned endpoint as lifecycle-local, not permanent across stop/start. |
| R25 | Validation environment / Low, diagnosis bounded | The next normal pre-push passed static/contracts but stopped in the real installed-tree unit: its child Node npm ls process exceeded the unchanged 60-second timeout. The remaining 6,258 tests passed. | The unchanged focused file passes all nine tests, and the next owning-hook API unit run passes all 6,259 tests in 218 suites. No timeout or assertion changed. Resource contention is plausible but not established as the sole cause. That hook later stops in web worker startup, so it is not an overall green push. Earliest gate: preserve the causal timeout and distinguish focused/unit recovery from a complete green run. |
| R26 | GUI executable provenance / High, corrected | Actual Container Tools View Logs selected Desktop despite an independent Engine tree/PATH. Provisional command-string flags caused ENOENT; a Compose suffix caused an unsupported V1 error. | Both overrides are bare independent docker.exe paths; host/config/context and Compose roots belong in both environments. The generator has six RED/GREEN contracts. Actual GUI commands, reload and Windows-created Compose lifecycle pass with separate receipts. Cold startup/operator acceptance remain open. Earliest gate: inspect generated GUI tasks, not just daemon identity. |
| R27 | Test-worker environment / Low, full recovery pending | Default concurrency left 65 fork-worker startup errors and only 60 files/525 tests executed. A two-worker hook improved to 118 files/1,370 tests but still had seven startup errors. | Two-worker focused three-file/209-test success was insufficient. All seven exact unstarted files pass sequentially, 292 tests. Next run uses supported VITEST_MAX_WORKERS=1 for the complete unchanged hook. The fixed 60-second worker bootstrap limit and every test/assertion/threshold remain unchanged. Contention during startup/import is consistent with the results, not a fully established OS-level cause. Earliest gate: require complete file/test inventory and zero worker errors. |
| R28 | Shell transport / Low, bounded diagnosis | Some terminal invocations returned empty exit-0 output; one health probe printed its response before the shell exited -1073740791. | The OS/harness cause is not established. Reliable Node-owned runners persist subprocess status, complete logs and semantic receipts with explicit sentinels. An empty exit 0 is not evidence; subsequent real build/live/browser receipts establish their own outcomes. Earliest gate: check persisted outcome and process status separately. |
| R29 | Diagnostic tooling / Low | Optional-path discovery yielded exit 1; two searches timed out; a requested view range and an assumed test path were invalid. | Correct the exact path/range or narrow the search and inspect the bounded result. These are discovery/argument failures, not failing application assertions. Do not retry through alternate access routes after a policy denial; none occurred here. Earliest gate: distinguish a tool error from a searched-for defect. |
| R30 | Cross-chat routing / Low, delivery unverified | The requested parent session URI was rejected as unknown. | Session discovery exposed a different available migration-chat URI, which accepted queued milestones. Queuing is not verified receipt by the originally named parent. Parent updates arriving as user turns remain authoritative. Earliest gate: record the actual route/result and never claim delivery from a rejected request. |
| R31 | Reconciliation harness / Low | The first private transcript scanner assumed every tool completion had a result and threw on matchAll. The rejected message instead carried an error envelope. | Scan result OR error, explicitly inventory unavailable envelopes and require zero unexplained omissions. The corrected two-pass scan covers all tool types and assistant narration. Earliest gate: validate heterogeneous transcript envelopes before claiming completeness. |
| R32 | Evidence harness / Low | A generic process receipt reused the semantic GUI-settings receipt filename and replaced its richer evidence. | Use distinct process and semantic filenames, rerun the small read-only check, and retain both artifacts. Real Engine generation passes without writing the workspace. Earliest gate: give evidence producers unique output identities rather than inferring semantic proof from exit status. |
| R33 | Outer orchestration / Low | The private runner killed Git at its arbitrary 30-minute orchestration deadline while the unchanged child hook was still running. The hook later failed its seven web startups after 1,853.7 seconds. | Waited for the existing child hook to finish and retained both process-timeout and late failed-hook receipts; no overlapping suite or successful push was claimed. Increase only the private whole-push budget to two hours. No repository gate, individual test deadline or Vitest's fixed bootstrap timeout changes. Earliest gate: budget the aggregate owning command separately from its component test deadlines. |
| R34 | Cleanup harness / Low | A valid tmpfs destination had an empty option string; a truthiness guard incorrectly rejected it before deletion. | Check key presence with Object.hasOwn while retaining exact full ID, both task/run labels, no persistent mounts and post-removal absence. Exact owned PostgreSQL stopped at exit zero and was removed. Earliest detection was the fail-closed pre-delete guard; no destructive escape occurred. Receipt: release-owned-pg-cleanup.json. |
| R35 | Worker startup / Medium, recovered | Complete one-worker hook passed 124 files/1,572 tests but one fork never started its 90 tests within the unchanged handshake limit. Exact OS cause is not established. | Supported Node 24 compile cache was explicitly activated; the focused 90 pass, then the complete normal hook passes all 125 files/1,662 tests with zero unhandled errors. No deadline, isolation, selector or threshold changed. Earliest prevention: require complete inventory and zero worker errors, never sum partial runs. Disable compile cache for precise V8 coverage. |
| R36 | Harness environment / Low | Empty NODE_DISABLE_COMPILE_CACHE still disabled activation; the pre-test probe refused to run. | Omit the disabling variable and require getCompileCacheDir to return the owned cache directory. Focused 90 and complete hook pass. Earliest gate: explicit activation before claiming an optimization; absent and empty environment values are not interchangeable. |
| R37 | Validation interruption / Medium, focused recovery only | The bbcd6791 hook log jumps from 03:05:25.749 to 11:54:24.265 UTC (31,738.516 seconds). The first subsequent failure is endpoint cleanup expecting 204 but receiving 401 with bearer_oauth_expired; that suite accounts for all 31 failed tests. The outer Git runner also timed out. The OS-level cause, including possible sleep, is not established. | Preserve release-push-1795143190717.txt/json and the late failed-hook summary. Verify no owned test workers remain before retry. The unchanged exact query-semantics suite passes all 42 tests with process status 0 in release-query-recovery-1795180255034.json. This proves focused recovery, not a successful final push. No token lifetime, test deadline, selector or threshold changed. Detection: owning HTTP hook; earliest useful check: distinguish a wall-clock discontinuity from application execution time before modifying code. |
| R38 | Editor tool transport / Low | Tool discovery for parent messaging and the focused editor test request each returned no response after 1,800 seconds. Neither result proves delivery or test execution. | Do not claim a parent milestone was delivered. A process scan confirmed no worktree Node test workers before a receipt-producing native Node runner executed the exact suite successfully. No repeated editor request or overlapping test run was started. This extends R28's requirement to verify semantic receipts and process completion rather than infer success from unavailable tool output. |
| R40 | Documentation coverage / Medium, applied | The README-linked current readiness guide retained its earlier source while the freshness gate passed all 28 registered documents. This guide was absent from the manifest, and its Product source label was not an F1 version marker. | Permanent actual-header/registration controls first failed three assertions. Register the guide and use the recognized Product version documentation-scope marker: all 30 self-test assertions and all 29 document audits pass. Existing documentation CI already invokes the self-test; no auditor or workflow change was needed. Dated evidence stays pinned, and the 30-day age setting remains a warning. Detection: source-document consolidation; earliest prevention: manifest admission plus actual-marker stale/current controls when the guide became the current acceptance record. |
| R41 | Private diagnostic test correctness / Medium | The CPU-observer positive contract acknowledged installation but could not find the owned symbol through the host VM sandbox. Negative cleanup assertions using that same proxy could also pass without checking the actual context global. | Read and delete the symbol inside vm.runInContext. The nine neighboring contracts pass, and the final four focused CPU lifecycle contracts pass after adding stop-failure cleanup. This is mock/driver preparation, not a real CPU-profile or performance pass. Earliest detection: positive persistence plus actual-context negative cleanup before runtime instrumentation. |
| R42 | Private fixture admission / Low, applied | Both created and running PostgreSQL fixtures omitted tmpfs entries from Docker Mounts even though HostConfig.Tmpfs declared the intended storage. The private guard refused both attempts before the matrix. | Preserve both failed receipts. Admit exact configured tmpfs, reject persistent mounts, then verify the running filesystem with stat. The actual filesystem is tmpfs; no repository guard or runner changed. Detection and earliest prevention: storage admission before the canonical matrix. |
| R43 | Private verifier / Git metadata / Low, reconciled | All six canonical modes exited zero, but the outer verifier exited 2 on a snapshot needs-update marker while content diff was empty. The exact OS/index-cache trigger is not established. | Preserve the failed outer receipt. Separate reconciliation verifies identical raw snapshot bytes and Git object, unchanged input hashes and clean final status without restoring/editing source. Verify content and metadata separately before declaring drift. Detection: final wrapper; earliest useful check: distinguish content drift from stat-only markers immediately after a snapshot-capable test. |
| R44 | CI dispatch / Low, applied | Dispatching the merged commit as a workflow ref returned HTTP 422 No ref found and created no run. | Verify named master before dispatch; identify the single new run from pre/post IDs and verify its immutable head. Cancel a mismatch rather than admitting it. Exact-a7 run45299868150 completes successfully with unchanged workflow/gates and no latest/release tag. Detection: dispatch API; earliest prevention: distinguish supported named refs from commit identity, then require head admission. |
| R45 | Documentation consistency / Low, applied | Newly allocated issue R39 collided with an existing narrative R39 outside the main table. | Preserve the existing narrative identifier; assign new entries R40 onward and check that range across all table/narrative definitions. An initial overly broad check conflated unrelated historical low-ID tables; scoped R39-R45 validation now passes. Detection: final scoped documentation check; earliest prevention: scan every issue-definition form before allocating an append-only ID. No historical issue or failed receipt is deleted. |

November 20 interruption disposition: the failed full run remains blocked
despite the unchanged focused recovery. The self-improvement applied here is
an explicit timestamp-gap/first-cause check and separate focused-versus-complete
status. Design disposition: accepted; no production change or new abstraction
is justified by this execution interruption. The next normal complete hook
owns the final source tip; PR, exact-tip CI and merged-source dev remain open.

R35 recurrence, November 20 14:06 UTC: the normal 9ca103f2 hook passed every
static gate, 218 API suites/6,259 tests and the reduced HTTP lane (2,517 passes,
42 skips), but three fork handshakes failed. Only 122 web files/1,458 tests ran.
The exact missing user-facing-copy, LogsPage and DiscoveryExplorerPage files
then passed unchanged: three files/204 tests, exit zero, receipt
release-web-workers-recurrence-1795183750583.json. This is not a complete web
pass or proof the cache prevents recurrence. A post-run aggregate sample had
28,140 MiB free RAM and 32 percent CPU load, which cannot explain historical
handshake latency or prove a cause. No owned workers remained. Retain the full
release-push-1795180429087.txt/json failure; another normal owning hook is
required. Existing complete-inventory/zero-worker-error enforcement caught
the recurrence and remains unchanged. Design disposition: accepted; changing
pool isolation, deadlines or gate orchestration is not justified by these data.

R35 subsequent recurrence, November 20 15:20 UTC: the normal 75aa9555 hook
again passed static/API gates but failed eight fork startups. The web result
was 117 files/1,474 passes and eight errors, not a complete pass. The causal
receipt is release-push-1795183855482.txt/json. No owned worktree Node workers
remained afterward. The exact eight unstarted files then passed unchanged
under both supported explicit pools with one worker and compile cache
disabled: 188 tests each, exit zero. Receipts are
release-web-threads-diagnostic-1795188041536.json and
release-web-forks-diagnostic-1795188209202.json. These bounded comparisons
do not establish a pool, cache or operating-system root cause and cannot
replace a complete gate. Blind complete retries stopped. A Windows-only
supported thread-pool proposal needs an explicit scope decision before any
repository configuration change; Linux CI, isolation, deadlines, complete
inventory and coverage thresholds must not be weakened. Self-improvement:
applied the bounded identical-input comparison and stopped the unproductive
retry loop. Design disposition: accepted pending that decision; no speculative
runner abstraction or application change was made.

R35 runner mitigation, November 20 15:28 UTC: after the operator explicitly
directed autonomous continuation, choose the supported thread pool only on
Windows and retain forks on other platforms. Explicitly keep isolation true.
Two new policy assertions were observed failing before the config edit and
passing afterward. No deadline, test selector, assertion or coverage threshold
was relaxed. Both preceding focused pool comparisons passed, so this is not
proof that threads address the underlying OS-level cause. The next normal
complete hook owns the mitigation and must execute 126 files/1,664 tests with
zero worker errors; until then recovery remains pending. The standalone type
check has 66 existing errors, below the 96 hook ceiling, with no error in the
changed test/config. The editor test tool discovered no tests; direct Vitest
execution supplied the actual RED/GREEN evidence. Self-improvement: applied
an executable pool/isolation policy check rather than a private runner shim.
Design disposition: accepted; two config properties use the existing runner
and avoid a new abstraction, hook bypass or dependency change.

R35 complete-run outcome, November 20 16:14:35 UTC: the normal complete
Validate hook and push at 1f0daafa5bc4dc395378a96059e13dea21917d8f PASS.
All 126 web files/1,664 tests execute with zero worker errors. Static gates,
218 API suites/6,259 tests and the reduced HTTP lane's 2,517 passes/42 known
skips also pass. Git exits zero and the remote exact ref/upstream are
independently verified. Receipt: release-push-1795188745675.txt/json.
The web gate took 1,626.5 seconds. This is a complete observed recovery
under the Windows thread-pool mitigation with cache disabled, not proof
of the underlying OS cause or a permanent guarantee. Preserve all failed
runs. Linux forks and the full merged-source matrix require their own
evidence. Documentation-only receipt consolidation uses the ordinary
default Fast hook; the unchanged full suite is not manually repeated.

R39, test harness / Low: directly importing the Vite config from the new
source-tree policy test pulled tooling-only imports into the application
TypeScript project. The first check had 68 errors, including two new
module-resolution errors in the imported config. Replace that import with
an anchored source-declaration contract for this static policy. The final
focused run passes both tests and type-check returns to 66 existing errors,
zero in the changed files. This fixes the test boundary, not application
types. Earliest and actual detection: focused type-check before commit.
The first summary of zero changed-file errors was corrected against the
actual output before consolidation; a count below the legacy ceiling alone
is not sufficient for a newly added file.

Consolidation transcript reconciliation now includes the full 5,521-event
boundary: 305 signal/narration candidates, zero missing result envelopes.
The prior 4,792-event reconciliation is retained; all 46 subsequent candidates
are classified as R35 recurrence/diagnostics, expected policy RED, editor
test-discovery failure, type-check evidence or source/search/narration echoes.
The PostgreSQL cleanup warning explicitly says fixture parameter cleanup
failure and is followed by its passing regression; it is not an unclassified
live cleanup. R39 was subsequently captured at its confirmed focused repair.
Later hook/deployment events will need a new boundary before final signoff.

Parent bridge cleanup is now separately verified: only the owned attached
bridge shell was stopped after exact ownership checks. TCP port 22222 closed
at 15:27:37.518 UTC and both recorded processes were absent at
15:27:38.158 UTC. A bounded 19-probe wait took 4,661 ms; this is observed
cleanup waiting, not an isolated relay-component latency. Engine, WSL,
project containers, images, volumes and Desktop were not shut down or changed.
The transport endpoint is intentionally offline until coordinated restart.

### Actual GUI execution issues and prevention

These are the parent's separately reconciled GUI issues, not additional
unclassified application defects. G1/G2 also explain R26 above.

| ID | Type / severity | Observed cause and correction | Detection and prevention |
|---|---|---|---|
| G1 | Runtime independence / High | Correct Engine inventory concealed Desktop task auto-detection. Pin both base executable settings and inspect actual emitted commands. | Actual GUI Logs caught it; six source settings contracts and emitted-command evidence now cover the separate boundary. |
| G2 | Version-specific configuration / Medium | Stale descriptions suggested command strings. Flags caused ENOENT and a compose suffix triggered the V1 rejection. Use base path only in 2.5.3. | Actual command execution, not configuration prose, is authoritative; exact bare-path assertions prevent recurrence. |
| G3 | Cross-host paths / Medium | Linux-created Compose working-directory/configuration labels cannot serve a Windows GUI task. | Actual group Logs caught the unsupported combination. Preserve history and use native CLI/individual operations; qualify Windows-created projects separately. |
| G4 | Harness correctness / High | A presence-only reconnect check accepted a connection-warning placeholder. | Require the real repository and absence of connection errors after reload; strengthened assertion passes. |
| G5 | Harness interaction / Low | Focus, stale overlays, collapsed sections and virtualized rows selected wrong or absent actions. | Control the owned window/overlays/expansion and visible row bounds; do not misclassify locator failures as runtime defects. |
| G6 | Picker model / Low | Grouped container selection, checkbox roles and recent-command suffixes differed from assumptions. | Capture the actual picker and constrain group/checkbox selection to the exact owned fixture. |
| G7 | Metadata/editor model / Low | The inspector omitted empty Labels and used Monaco EditContext rather than an assumed textarea. | Assert actual JSON/editor behavior with whole-document Find; do not invent a null property. |
| G8 | Terminal model / Low | Accessibility exposes the viewport, with line-wrapped commands/readiness text. | Scroll through real GUI history and join visual wraps before matching full command/ready text. |
| G9 | Tool UX / Low | A second Compose Logs action met the still-running follow task's terminate picker. | Observe/close only the owned log-follow terminal; separately prove the service remains healthy. |
| G10 | Acceptance strength / Medium | Backend exit zero preceded a stale healthy GUI row. | Await refreshed healthy/Exited(0) GUI outcomes; repeat with a fresh isolated fixture and inspect the final screenshot. |
| G11 | Tool transport / Low | Complex shell calls sometimes returned empty exit zero; cause remains unknown. | Existing Node driver plus explicit sentinels/receipts; do not invent a transport root cause. |
| G12 | Coordination/lookup / Low | Wrong host-chat URI, accumulated milestones, an incorrect failure suffix and a broad glob obscured evidence. | Use the actual returned URI, one consolidated handoff and deterministic capture paths; cancel only owned pending messages. |
| G13 | Teardown timing / Low | Two immediate port probes raced asynchronous relay teardown after GUI-task termination. | Private harness now waits boundedly for the unchanged real listener-absence criterion. Actual closure passes. The delaying component and latency were not isolated or measured; do not infer synchronous cleanup from a kill request. |

Parent GUI provenance: the final machine-readable full-event reconciliation
contains 10,072 events, 70 GUI-driver attempts, 27 execution signals and one
narration signal, all classified across G1-G13 or explicit non-issues.
Earlier 9,560/64/22 and detailed 10,044-event snapshots are dated boundaries,
not the final counts. G5 also covers cold view activation; G8 covers a
scrolled-away bridge-task header. These are attempts/signals, not passed
requirements or independent defect counts. Actual
successful-looking output/captures were also reviewed for G1/G2/G4/G10 because
an error-word scan cannot catch those false greens. Source/history/search
echoes, line-wrapped readiness and initial inventory lag are explicitly
classified rather than counted as new Engine defects.

Later parent machine-local closure extends that historical GUI boundary:
10,733 full transcript events, 70 GUI attempts, 30 execution signals and one
narration signal, all classified. G14 records reuse of a private cleanup
receipt key; separate original-GUI and final-shared-bridge checkpoints were
restored from exact earlier evidence. G15 records a private timestamp
comparison false failure corrected with string-preserving JSON date parsing.
G16 records an optional-null probe false failure. G17 records an unexplained
inline command-discovery rejection/empty diagnostic, replaced by explicit
Windows where.exe receipts. These are private evidence-tool issues, not
application, runtime or credential-protocol failures.

The metadata-only preservation recheck passes ten file records, eight
protected ACL paths and exactly 40 original volume identities across the
existing offline inventory/fingerprints. Original and verified-backup VHD
lengths and the Desktop executable length match original metadata; config
and protected backup existence was checked without content reads. The
unverified early backup candidate remains explicitly unverified. No current
hashing, remount, restore or fresh integrity claim is made; prior cryptographic
verification remains 2026-11-19T02:13:57.6478005Z.

Static helper resolution passes in both generated workspace environments,
including probe-process PATHs with two Desktop entries removed. Independent
Docker, wincred, native Windows OpenSSH and PowerShell remain resolvable;
Compose/Buildx are ordinary independent profile-local files. The independent
wincred helper is an ordinary 2,964,992-byte file and resolves first in both
workspace scopes. An unactivated shell still resolves Desktop. No helper
protocol, credential-store operation, registry sign-in, global PATH change
or actual post-uninstall runtime acceptance was exercised.

Optional assistant MCP gateway remains an explicit Desktop dependency:
global Copilot configuration declares bare docker plus mcp gateway, while
the independent profile has no docker-mcp.exe. The standard plugin is a
48,361,904-byte NTFS hardlink to Desktop's plugin. Neither gateway startup nor
independent migration is qualified. This does not invalidate the separately
tested SCIMServer/Container Tools route, but all machine developer tooling
must not be described as Desktop-free. No gateway configuration or credential
operation was changed as part of this evidence.

Consolidation receipts are `test-results/release-clean-standalone-build-green.txt`,
`release-clean-package-health.json`, `release-clean-package-live.txt` and
`release-clean-package-playwright.json`. The live result is 1,845 reported
passes and zero failures, still including the four historical placeholders.
The browser result is one passed case, not a complete browser matrix.
The disposable database receipt records a new full container ID, task/run
labels, tmpfs storage and Docker-assigned loopback port. No original Desktop
artifact, volume or cold backup is a validation database.
`release-container-active-sse-shutdown.json` captures the actual container
signal, stream end, exit state, final durable request log, restarted original-ID
readback and exact cleanup. The failed first restart receipt is retained
separately rather than rewritten as a pass.

The GUI settings generator has observed RED for the missing executable pin,
then GREEN for 34 existing runtime and six new settings contracts. The latter
assert exact bare commands (including a path with spaces), both complete
environments and rejection after missing activation, context drift, Desktop
selection, unreachable Engine or broken Compose. Real independent-Engine
generation also passes read-only; its semantic receipt is
`test-results/release-container-tools-settings-live-evidence.json`, separate
from the runner's process receipt. This does not substitute for GUI acceptance.

The two-worker Validate push was explicitly cancelled when the new GUI source
correction became necessary. It is an interrupted run, not a successful push
or final-source suite. The next complete normal hook owns updated-tip evidence.
That hook on 17ac92ef again passes 6,259 units/218 suites and the existing
reduced HTTP lane's 2,517 tests/42 skips. Its web result is 118 files/1,370
tests plus seven bootstrap errors, not a complete pass. All seven exact files
then pass sequentially, 292 tests; complete single-worker hook evidence is
still required. An E2E worker forced-exit warning is retained rather than
misrepresented as proof of clean test-worker teardown.

The later complete normal Validate push at
`2cea026769d74153d555d6d0bb39de8fd3bc6a0b` passes every gate: API 218 suites/
6,259 tests; existing reduced HTTP lane 2,517 passes/42 skips; web all 125 files/
1,662 tests and zero unhandled errors. Receipt
`test-results/release-push-1795140499130.txt` ends All gates GREEN and process
status zero. Explicit remote task-ref/upstream readback matches that SHA.
Private one-worker/cache activation changes no repository test settings.

CI-only [lockfile generation 44663499790](https://github.com/pranems/SCIMServer/actions/runs/44663499790)
completed successfully on that exact head. Download provenance, public-registry/
sha512 checks, empty dependency/publication-age delta and deep version-only
comparison pass before importing both 0.55.68 lockfiles. No local generation.
This subsequent lock/doc commit requires its own normal hook and exact-tip CI.
Reviewed PR/merge, immutable publication and Azure dev remain open.

The disposable qualification PostgreSQL full ID
`781a3a24d2555fc7aa3e9bb5015eb020efe73033f31ed2312c446a2ed8a295d0`
was verified owned/tmpfs, stopped at exit zero, removed by exact ID and proved
absent. No original data or bridge was removed.

Cross-chat coordination is now verified through the actual parent route and
steering acknowledgments. Earlier accepted queued messages did not establish
timely delivery; obsolete owned pending messages were cancelled. Retain the
queue-versus-active-steering distinction rather than repeatedly enqueueing
milestones behind a running turn.

Independent read-only source review of 17ac92ef against master
3bee7a3c22992af9a08fde8e36fc398fc37b2b48 reports no significant findings.
It inspected the changed runtime/build/publisher/test surfaces, did not run
tests and does not replace exact-tip CI or the merged-source matrix.

**Interim consolidation transcript reconciliation:** the full available
1,780-event transcript was scanned with error/signal and diagnosis-narration
passes, yielding 86 candidate events. Every candidate was reviewed against
R20-R32 or dismissed as source/patch/historical text, expected RED/negative
controls, normal before-start connection refusal, repeated status output or
the scanner's own echo. No tool-result/error envelope was omitted. The private
candidate index preserves event numbers and bounded excerpts. Later GUI,
push, CI and deployment events still require their own final reconciliation;
this is not a claim that the release is complete.

**Extended consolidation reconciliation:** the full available 4,114-event
transcript was scanned in both signal and narration passes; all 212 candidates
were reviewed through this boundary, with zero missing result/error envelopes.
New causal results map to R34-R36; source/dependency reads, prior-report echoes,
expected negative controls, retained test diagnostics and self-search output
are dismissed explicitly rather than counted as new failures. The full
successful hook is a separate receipt, not a relabelled partial run. Later
commit/CI/deployment events still need reconciliation before final signoff.

**Test/gate self-improvement: applied.** The clean builder now fails at the
actual failing native stage without silently regenerating a lockfile; the
browser regression uses the existing ownership-checking fixture creator.
The GUI settings function also reuses that runtime's existing activation and
preflight, with exact executable/environment regression assertions.
**Design disposition: accepted.** Keep the builder linear and reuse the
existing fixture. The small read-only settings projection stays beside the
owning runtime helper; no packaging framework, second runtime selector or
second ownership abstraction is justified.

### Provenance and completeness at the local-correction boundary

The local-correction ledger was reconciled against the complete available
session transcript, not only the conversation summary: 7,081 events and 956
tool completions at capture. An error/signal frequency pass and a separate
diagnosis-narration pass identified 38 candidates after the readiness request.
Each maps to R1-R19 or an explicitly reviewed non-issue. The earlier C1-C36
ledger remains the separately reconciled November 18 boundary.

Verified and dismissed: deliberately unreachable synthetic-database P1001
trials, intentional REDs after mapping them to their actual fixes, initial
database/application startup probes that later passed bounded readiness and
full checks, quoted historical HEALTHCHECK output, repeated agent summaries,
and the reconciliation command's own quoted error output. None is counted as
a new production defect. The negative signed-exit failure was a real batch
launcher bug, not merely a display mismatch.

Later consolidation, clean packaging, GUI acceptance and deployment execution
must extend and reconcile their own new evidence. This note does not claim
that the overall migration/release is finished.

**Test/gate self-improvement: applied.** Actual module wiring and active-client
shutdown are now executable outcomes rather than presence/health proxies.
**Design disposition: accepted.** Reuse the existing module export and keep
stream cleanup with the controller that owns the streams; no new speculative
runtime framework or unrelated data-layer refactor.
