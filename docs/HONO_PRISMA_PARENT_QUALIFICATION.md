# Hono adapter: actual Prisma parent qualification

**Last verified:** 2026-10-29

## Executive summary

Proposed product 0.55.66 is a separate rollback unit stacked on unmerged
draft #261, exact base `f4fcfe3ccac83de6548ed9991ed44048ee8d660a`.
It selects `@hono/node-server` 2.1.3 only after executing the installed
Prisma parent's real lifecycle with both 1.19.15 and 2.1.3. The affected
adapter returns a synthetic protected file through the published exploit;
2.1.3 returns 404. This is bounded compatibility evidence, not acceptance
by the parent's declared dependency range.

The public parent shutdown promise resolves and every tested listener and
stateless data file is released with both adapters. Neither version's
process naturally exits in the observed window. The runner explicitly
records that state, stops its exact owned container, verifies it stopped,
and removes it. No `forceExit`, global timer patch, parent monkeypatch,
shared database, cloud resource, or host listener is used.

No review, merge, deployed-version change, performance qualification,
latest-image admission, or release completion is claimed. Product 0.55.65
and performance draft #251 remain reserved and untouched.

## What actually owns the adapter

```text
prisma 7.8.0
  -> exact @prisma/dev 0.24.3
     -> upstream exact @hono/node-server 1.19.11
        -> project override 1.19.15 before / 2.1.3 proposed

real startPrismaDevServer()
  -> primary PGlite + shadow PGlite + local Streams
  -> real Hono application + Node http.createServer + adapter serve()
  -> health / authentication error / database dump HTTP requests
  -> real close() + port-rebind and stateless-file assertions
  -> explicit isolated-container cleanup
```

This flow uses the installed parent without replacing its Hono application,
database components, or adapter call with an illustrative fixture.
The adapter's `overrideGlobalObjects: false`, listening callback, Node HTTP
server creation and the parent's public `PortNotAvailableError` remain
exercised. The occupied-port test reaches the public rejection path; it does
not claim to force the narrower race inside the adapter's `EADDRINUSE`
event handler.

## Advisory and upstream assessment

| Question | Observed evidence |
|---|---|
| Advisory | [GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f), medium, affects `>=1.19.10 <2.1.3`. |
| Mechanism | `serveStatic` decodes a routed path again. A malformed percent-encoded path can avoid prefix authentication while still resolving a protected file inside the configured root. This is not traversal outside the root. |
| First patch | 2.1.3, published at raw UTC `2026-09-29T06:10:34Z`, over seven days old at qualification. |
| Actual fix | [Commit 9821792](https://github.com/honojs/node-server/commit/982179278529d5673812116b042829f27794966f) rejects percent signs remaining in the routed path by default, before rewriting/resolving static files. `allowPercentInPath` is an explicit opt-in. |
| Major-version cost | [v2.0.0](https://github.com/honojs/node-server/releases/tag/v2.0.0) retains the public API but rewrites request/response internals. Node >=20 and unchanged signatures alone were insufficient evidence. |
| Parent patch alternative | Prisma 7.8.0 pins dev 0.24.3 exactly. Earlier same-line dev releases retain affected 1.x requirements. Metadata for later 0.24.x releases omits the direct adapter field, which is not proof of absence from their resolved graphs. No unrelated Prisma upgrade is selected. |
| Scope of exposure | The inspected actual parent uses `serve`, not `serveStatic`. The fix is still applied to the installed affected package; no development-only or reachability suppression is introduced. |

Existing qs, fast-uri, shared-context, and other security overrides remain.
This closes the final record in the prior six-record assessment, not every
possible advisory in the repository.

### Worked security example

The synthetic static server protects `/static/admin/*` with a 401 response
and then serves `/static/*`. Normal public reads still return 200. Both
`/static/admin/secret.txt` and `/static/%61dmin/secret.txt` return 401.

| Request | Adapter 1.19.15 | Adapter 2.1.3 |
|---|---|---|
| `/static/%%36%31dmin/secret.txt` | 200, synthetic protected file exposed | 404, no protected file |

The old-version HTTP assertion fails on `200 !== 404`. The permanent Jest
regression also fails on that precise assertion before manifest edits.
Neither test uses customer data.

## Real parent comparison and permanent checks

The final baseline comparison first clean-restored the exact #261 API
graph. An earlier installed performance graph had old qs/fast-uri entries;
its successful smoke is retained as preliminary evidence, not substituted
for the restored comparison.

| Claim | Actual baseline 1.19.15 | Candidate 2.1.3 |
|---|---|---|
| Real parent initialization, HTTP readiness callback | PASS | PASS |
| `GET /health`, status/content type/exact `{ name }` body | PASS | PASS |
| Unknown route, exact 404 body | PASS | PASS |
| `POST /query` without API key, 401 `Missing API Key` | PASS | PASS |
| Primary and shadow synthetic table/insert/select | PASS | PASS |
| `POST /database/dump`, 201, only `dumpPath`, nonempty file | PASS | PASS |
| Global Fetch/Request/Response identities unchanged | PASS | PASS |
| Real close promise resolves; HTTP/primary/shadow/Streams ports rebind | PASS | PASS |
| Occupied requested port rejects with public error and exact port | PASS | PASS |
| Stateless data files removed | PASS | PASS |
| Natural process exit after close | NOT PROVEN; retained process | NOT PROVEN; same retained process |
| Owned container stopped, verified stopped and removed | PASS | PASS |

The comparison ran Node 24.16.0 in existing `node:24-alpine`, network `none`,
no published ports, read-only dependency mounts and root filesystem, with
only a unique owned evidence directory writable. A read-only adapter-package
mount selected candidate bytes without changing any parent file.

Permanent regressions cover the selected pin, every locked occurrence,
public resolved URL/SHA-512, real installed Prisma/dev identity and original
constraint, actual owner resolution, adapter exports/global-object contract,
the security exploit with normal-routing controls, and the complete unfiltered
installed npm inventory. The permanent lifecycle runner is separate from the
unit suite so ordinary Jest never starts an actual Prisma development server.
The fixture refuses native invocation before loading its parent. It requires
the runner's explicit flag, a Linux container marker, and internal-only network
interfaces. The final clean-installed run passed all 12 lifecycle claims and
stopped/removed its exact owned container; the native refusal check failed
closed as expected.

```powershell
# Set DOCKER_CONFIG in this process only if the local recovery profile is needed.
pwsh -NoProfile -File scripts\qualify-prisma-hono-parent.ps1

# Before changing the pin, compare an extracted, approved-feed candidate:
pwsh -NoProfile -File scripts\qualify-prisma-hono-parent.ps1 `
  -ExpectedAdapter 1.19.15
pwsh -NoProfile -File scripts\qualify-prisma-hono-parent.ps1 `
  -ExpectedAdapter 2.1.3 `
  -AdapterPath '<owned qualification evidence directory>\package'
```

Do not treat this as all-input compatibility. Native Windows parent
listeners, real external PostgreSQL, accelerated authenticated query-engine
downloads, concurrency/load, arbitrary streaming bodies and production
traffic are not qualified here. The test deliberately needs no network and
does not download engines or contact a cloud estate.

## Lock provenance and consolidation

Only the existing clean-runner `regen-lockfile.yml` may generate source
lockfiles. Import requires exact source/ref, artifact ID, authenticated archive
SHA-256, package age, public registry resolved URLs, SHA-512 entries, an
adapter-only API graph delta, and no non-root web graph delta. Approved-feed
tarball bytes must match the imported public lock integrity. Local
`package-lock-only`, feed rewriting and quarantine exceptions are forbidden.

Clean-runner workflow `40948177653`, exact source
`38b1a781eed63905d429feef2480c899dd203161`, produced artifact `12929363808`.
The authenticated archive SHA-256 is
`bf1c5791b9cfddf1a9e22beacd71a4549835c3d37ebf32db413e0d4629048946`.
The API lock changes only the adapter outside its root record; the web lock
changes no non-root record. Both clean installs retained byte-identical locks,
Prisma client generation reported 7.8.0, and approved-feed adapter bytes match
the imported public SHA-512. The public publication timestamp remains the raw
UTC string `2026-09-29T06:10:34.512Z`.

The final permanent suite passes 6/6 in one suite, targeted ESLint passes,
and the complete unfiltered installed API npm inventory exits 0 with empty
stderr. Bootstrap protected Fast passed 25/25 gates, including 6,248 API
unit tests in 215 suites and 2,514 HTTP E2E tests (42 existing skipped).
Those bootstrap counts do not include the six permanent tests restored at
lock consolidation. Final protected Validate and exact-tip hosted runs are
separate pending publication evidence, not inferred from that earlier run.
The ignored
`test-results/hono-parent-qualification-20261029/HANDOFF.md` records their
actual commands, counts and immutable receipts after consolidation.

## Execution issues and root-cause ledger

| Issue / severity | Symptom and mechanism | Resolution and why | Detection / earliest gate |
|---|---|---|---|
| Working-tree graph mismatch / Medium | Installed performance graph retained qs 6.16.0 and fast-uri 4.1.5 although the stacked #261 manifest requires their patches. Full npm inventory returned `ELSPROBLEMS`. | Ownership helper verified private physical directories; clean `npm ci` restored the exact #261 lock before the final old/new comparison. Same installed parent identity alone does not establish a correct complete graph. | New inventory regression / ownership plus installed-graph preflight. |
| Parent process retention / Medium | Old and new parents release ports and data after real close, but keep a process alive. Preliminary containers required explicit stop; no root cause inside the parent/runtime is claimed. | Separate happy-only and public-error-path runs showed retention in both. Permanent runner records actual pre-cleanup state, then stops/verifies/removes its exact owned container. This bounds resources without modifying the parent or pretending natural exit passed. | Actual lifecycle probe / same probe. |
| Upstream comparison lookup / Low | A fresh `v1.19.15...v2.1.3` GitHub comparison returned 404. | Read the fresh security commit and published v2.0.0/v2.1.3 release records instead; npm package metadata and verified bytes remain the identity evidence. An absent tag is not an absent fix. | Metadata intake / same intake. |
| Lockless bootstrap graph drift / High | An attempted selected-package `npm install --no-package-lock --no-save` re-resolved compatible ranges: installed Prisma became 7.10.1/dev 0.24.17 instead of locked 7.8.0/dev 0.24.3. Source locks remained byte-identical. | Discarded the privately owned wrong graph, clean-restored the exact parent manifest/lock in owned scratch state, then installed only verified candidate tarball bytes into that graph. Regenerated the client at actual 7.8.0 and complete npm inventory exited 0. Final consolidation still requires clean `npm ci` from CI-generated locks. | Post-install real-parent identity check / same check before any compatibility claim. |
| Transitional source CI / Low | Bootstrap image run `40948154638` rejected the deliberately stale lock: 1.19.15 does not satisfy 2.1.3. The source must first be published for the existing CI-only lock workflow. | Exact-source regeneration run `40948177653` succeeded; imported its authenticated minimal artifact and clean-restored both workspaces. This is a transitional failed run, not final-tip success or a waived install gate. | Hosted install / source-lock consistency check; expected until artifact import. |
| Evidence replay baseline / Low | Rerunning the pre-import lock comparison after import reported zero changed records, correctly failing its expected one-record delta. Its mutable baseline was now the imported artifact itself. | Pinned the comparison to bootstrap commit `38b1a78` and separately require current source bytes to equal the authenticated artifact. Baseline identity and import identity are now independent assertions. | Local evidence replay / immutable-baseline check before reuse. |

**Completeness provenance:** this ledger was reconciled with every command
and diagnosed failure in this bounded execution, including preliminary
graph smoke, RED assertions, resource retention and lookup friction. It is
not a claim to have re-audited the parent release's historical transcript.

The bootstrap lesson is concrete: preserving a source lock does not mean
an install command used that lock. Full npm inventory validity does not
mean installed versions match the graph that was qualified. Do not repeat
lockless broad installation as a shortcut for the CI-only lock workflow.

## Self-improvement and design disposition

- **Applied:** a major transitive override now has real-owner identity,
  actual old-byte exploit RED, complete installed inventory, and a reusable
  isolated real-parent lifecycle/cleanup check. An illustrative adapter
  example alone cannot satisfy that claim.
- **Accepted:** natural process exit remains unqualified and explicit. The
  proposed adapter does not fix a pre-existing parent/runtime retention
  behavior; no unrelated parent internals or Jest worker settings change.
- **Architecture disposition - accepted:** one dependency pin plus a small
  owned-resource test runner is cohesive. No production service/controller
  responsibility or coupling changes. A strategy framework would be
  speculative.
- **Remaining holds:** actual external review; stack/order reconciliation
  before integration with #251; historical performance failure and skipped
  draft performance campaigns; operator visual verification, customer-data
  and cleanup-403 holds; native/renderer and user-stopped authentication holds;
  explicit customer-production approval.
