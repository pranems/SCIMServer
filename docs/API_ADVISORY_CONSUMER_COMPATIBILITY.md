# API advisory pins: consumer compatibility and execution RCA

**Last verified:** 2026-10-29

## Executive summary

**Current source reconciliation (2026-10-30):** Hono #262 merged normally at
`eb733f61`, master 0.55.66. The proposed 0.55.67 performance reconciliation
preserves its qualified API graph and both histories. New-tip validation
and authoritative clean-CI lock confirmation remain pending; no performance
failure or release hold is waived.

**Integration RCA AC-10:** advancing master created 32 strictly current-version
conflict hunks and six narrative unions. The guarded resolver preflights the
exact parents and hunk counts, preserves both narratives, and changes only
differing current-version tokens to 0.55.67. An explicit historical-token
control preserves identical 0.55.66 references; a meaningful-content control
rejects non-version changes. No local npm regeneration occurs. New-tip
graph proof and clean-CI lock bytes remain independent required gates.

**Historical 0.55.64 checkpoint:** the 0.55.64 correction merged normally as
`cffc64c8a188a721fabb85c37a80243d5e65a74f`, after 28/28 protected gates,
seven exact-head checks, independent review and clean-CI confirmation.
That is merged source, not a deployed release or full advisory clearance.
The following preparation receipts describe its pre-merge state.

Proposed product 0.55.64 normally integrated reviewed master

**Current source boundary (2026-10-30):** the 0.55.64 advisory correction
merged normally as `cffc64c8`. Separate Hono #262 now integrates that reviewed
master at proposed 0.55.66, preserving its actual-parent qualification and
both historical accounts below. New-head verification, review and CI remain
required. No deployment, full advisory clearance or performance admission.
The earlier Hono blocker below describes the 0.55.64 rollback unit, not an
assertion that this separate Hono proposal lacks actual-parent evidence.

### Historical independent advisory preparation

**Follow-up, separate rollback unit:** [actual Prisma parent qualification](HONO_PRISMA_PARENT_QUALIFICATION.md)
records the proposed 0.55.66 adapter correction stacked on this draft.
The 0.55.64 blocker below is preserved as the earlier evidence boundary,
not rewritten as if this draft had already qualified the adapter.

Proposed product 0.55.64 is stacked on draft PR #260 at
`6eb1b59cb1a8ea324bb1a32b17355fabc605279d`. It changes only qs 6.16.0 to
6.16.1 and fast-uri 4.1.5 to 4.2.3. Neither this patch nor its parent is
merged. PR #259 and #251 remain separate. No deployed version changes.

### Historical reviewed-master advisory integration

Proposed product 0.55.64 now normally integrates reviewed master
`287ea671abf1619d7b172c495310769078bd685b`, after #259 and #260 merged.
It preserves original advisory head `f4fcfe3c` and every constituent commit.
Its bounded package changes remain qs 6.16.0 to 6.16.1 and fast-uri 4.1.5
to 4.2.3, alongside the inherited web and inventory corrections. This
integration is not yet merged or deployed. PR #251 and #262 remain separate.
Historical independent-branch receipts below do not qualify the new head.

The integrated manifests and complete locks match the intended parent union:
API equals original `f4fcfe3c`, web equals merged `287ea671`, with only
coordinated 0.55.64 root metadata. There is zero non-root drift. Clean API
restore passes with both lock hashes unchanged; the physically unchanged
web graph is retained. Both complete `npm ls --all --json` inventories
exit 0. Clean-CI byte confirmation and new-head gates are still pending.

Parent #260 passed all 28 protected Validate gates and seven exact-head
hosted checks, with separately executed technical review. This integration
still requires its own installed-graph checks, coordinated clean-CI lock
confirmation, protected Validate, refreshed review and exact-head hosted CI.
No new test/gate improvement is identified: the existing actual-owner,
complete-inventory and graph-union assertions cover this ordinary merge.
Design disposition: **accepted**, existing flat pins and preserved histories;
no speculative abstraction or new application responsibility.

The six-record assessment consists of one qs advisory, four fast-uri
advisories and one Hono adapter advisory. Five records can be corrected
with bounded consumer evidence. The Hono adapter remains blocked, not
suppressed. No finding is dismissed because a package is development-only.

## Actual owners and compatibility boundaries

| Dependency | Locked and installed owners | Assessment |
|---|---|---|
| qs 6.16.1 | body-parser 2.4.0 requires `^6.16.1`; Express 5.2.1 requires `^6.14.0`; Superagent 10.3.0 requires `^6.14.1` | All three ranges accept the patch. The previous override suppressed body-parser's published minimum. |
| fast-uri 4.2.3 | The only owner is Ajv 8.20.0 nested under `@prisma/streams-local`, requiring `^3.0.1` | This range does NOT accept either the old forced 4.1.5 or new 4.2.3. Compatibility is bounded behavioral evidence through the actual Ajv compiler and its own URI resolver, not semver acceptance. |
| `@hono/node-server` 1.19.15, unchanged | `@prisma/dev` 0.24.3 requires exact 1.19.11 | Patched 2.1.3 is outside the exact requirement. No compatible parent patch has been proved in this rollback unit. |

```text
Express / body-parser / Superagent -> shared qs 6.16.1
Prisma streams-local -> actual nested Ajv 8.20.0 -> fast-uri 4.2.3
Prisma dev 0.24.3 -> node-server 1.19.15 (blocked advisory remains)
```

The graph shows actual locked consumers, not a representative replacement
application. The regression enumerates every occurrence and checks installed
owner declarations and the exact module each owner resolves.

### Public upstream assessment

- [qs comparison](https://github.com/ljharb/qs/compare/v6.16.0...v6.16.1):
  comma-format serialization handles non-callable `toString`; additional
  parser, nesting-bound, encoding and strict-merge fixes require testing
  parsing as well as serialization. No major API change is claimed.
- [fast-uri comparison](https://github.com/fastify/fast-uri/compare/v4.1.5...v4.2.3):
  encoded schemes and invalid hosts are rejected; relative-reference meaning
  and suffix colons are preserved. Other changes cover IPv6 zones, mailto,
  URN dot segments and invalid references. The public type diff adds optional
  `ipv6Zone`, without removing existing resolver methods. This is not a
  promise of all-input compatibility: deliberately malformed inputs change.
- [Hono adapter v2 release](https://github.com/honojs/node-server/releases/tag/v2.0.0)
  says the public API stays the same, but replaces request/response internals
  for performance. Node >=20 is only an engine prerequisite, not proof of
  compatibility with a parent pinned to 1.x.
- [Hono patch release](https://github.com/honojs/node-server/releases/tag/v2.1.3)
  rejects remaining percent signs after static-path decoding, with an explicit
  opt-in for literal percent signs.

### Why the Hono adapter is blocked

Installed `@prisma/dev/dist/index.cjs`, `daemon.cjs` and the ESM chunk
`chunk-2O6J3K3T.js` dynamically import `serve`. The actual parent supplies
Node's HTTP `createServer`, its own constructed Hono application's `fetch`,
`overrideGlobalObjects: false` and a port, and awaits the listening callback.
It registers an `EADDRINUSE` error path. Its close operation promisifies
`server.close` and also stops the parent-managed database components.

This couples compatibility to real parent initialization, request/response
handling, errors and shutdown, not merely the existence of `serve`. A tiny
Hono fixture or a Node engine check cannot prove those claims. The actual
parent lifecycle starts its development database/server; this task forbids
starting applications or databases. No parent/runtime redesign or broad
Prisma upgrade is authorized. Therefore leave the adapter override unchanged,
retain [GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f),
and require an isolated, explicitly authorized parent lifecycle qualification
or a minimally compatible upstream Prisma patch before changing it.

## Advisory boundaries and permanent evidence

| Advisory | Boundary on selected line | New outcome |
|---|---|---|
| [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) | qs >=6.7.0, <=6.16.0 | 6.16.1 is outside |
| [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) | fast-uri >=4.0.0, <4.2.3 | 4.2.3 is outside |
| [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) | fast-uri >=4.0.0, <4.2.3 | 4.2.3 is outside |
| [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) | fast-uri >=4.0.1, <4.2.3 | 4.2.3 is outside |
| [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) | fast-uri >=4.0.0, <4.2.3 | 4.2.3 is outside |
| GHSA-rmxm-3fg6-px4f | adapter >=1.19.10, <2.1.3 | Still present, compatibility blocked |

New tests in `api/src/scripts/check-api-advisory-consumers.spec.ts` exercise
all three qs resolutions, the real Express configured parser, Superagent's
form serializer and body-parser's request-stream middleware without opening
a server. Comma-format hardening is tested through each owner's resolved qs,
not misrepresented as those parents' default options.

The actual nested Ajv compiles external, relative, fragment and recursive
schema references. Tests assert valid and invalid data plus exact validation
error locations and keywords and unresolved-reference rejection. They obtain
the URI resolver from the actual Ajv instance and check each advisory
mechanism independently. Existing complete `npm ls --all --json` acceptance
remains mandatory and unfiltered.

## RED/GREEN and validation

Before any manifest edit, the corrected actual-consumer run produced
11 real assertion failures and three passes across 14 tests. The three
compatibility paths already passed on old dependencies; exact pins, installed
versions, comma serialization and all four URI mechanisms failed as expected.
Logs are retained under `test-results/api-advisory-pins-20261029/`.

Follow-up fixture correction distinguishes `parse` returning an error from
`normalize` preserving malformed input, and tests suffix serialization with
an explicit input scheme that is omitted from output. The public advisory's
string-normalization example does not reproduce on the patch. Replaying the
real old 4.1.5 approved-feed bytes produces four URI assertion failures and
one Ajv compiler pass; restoring 4.2.3 passes all five. This is separate from
the original pre-manifest RED, not a rewritten account of it. Comma-format
serialization also asserts the full hardened output, not merely no exception.

The final regression includes five explicit published advisory boundaries,
for 19 new tests. The first complete authenticated-restore focus passed 52/52
before adding those boundary assertions, including the existing 38 regressions.
The final focus passes 57/57 in three suites. Lock provenance, documentation
freshness, documentation content and diff whitespace checks also pass.
Protected Validate totals are retained in the handoff after execution.

### Clean CI lock and restore receipts

- Unchanged regeneration workflow run
  [40923567650](https://github.com/pranems/SCIMServer/actions/runs/40923567650)
  uses exact bootstrap source `eb797fd69ef2b371e3a1812198fe6f159eeafc1c`.
- Artifact `12918583682` ZIP SHA-256:
  `bb3b81a1a4dd2eeb14f04e4838d50f6f883fae666057d0ece60e05d42ff29edf`.
  Authenticated GitHub metadata and downloaded bytes agree.
- API lock SHA-256:
  `01c0c63e29db93f5520195d3bfccf3b22fedbe20bcb1ca77effb0bccf136209e`.
  Web lock SHA-256:
  `b0c972aa28b428439e46913847b5e25ac85ae5395e5ed3ab6078c1ad33e629c9`.
- Exactly two non-root API entries change: qs and fast-uri. Zero non-root
  web entries change. Only product/root versions change otherwise.
- Approved-feed tarball bytes match both authenticated locked SHA-512 values.
  Missing SHA-512 metadata from the proxy was not treated as success.
- CI measured ages at 2026-10-29T17:40:35.970Z: qs 14.815 days,
  fast-uri 9.784 days, both above the unchanged seven-day floor.
- Physical ownership checks precede restore. Clean `npm ci` in API and web
  succeeds through the existing corporate registry, with both tracked locks
  byte-identical afterwards. The actual complete API inventory exits 0
  with no problems and empty stderr.

The normal Fast bootstrap push passes 25 gates, 6,229 API units in 214 suites
and 2,514 HTTP tests in 118 passing suites (42 existing skipped tests and two
skipped suites). This bootstrap uses provisional dependencies, not final
qualification. Hosted bootstrap Build Test Image `40923545248` correctly
fails `npm ci` on the two intentionally stale lock entries; its failure
receipt is retained. The final normal Validate push owns broad applicable
gates after the clean CI-lock restore. No PR-to-master matrix is inferred
when the draft uses a stacked base.

## Execution issues and root-cause analysis

| ID / type / severity | Symptom and mechanism | Correction and prevention | Detection / earliest possible |
|---|---|---|---|
| AC-1 / test correctness / Low | Initial Superagent fixture called its private query finalizer before the real request builder serializes queued objects. URL stayed unchanged. | Use the actual public form serializer, assert complete values, and retain corrected RED before manifests change. No network request is needed. | First focused RED / same |
| AC-2 / tooling / Low | Comparing Hono v1.19.15 to v2.1.3 returned HTTP 404 because that comparison ref is unavailable. | Read authenticated public v2 release notes and patch release plus actual installed parent bundle. Do not equate failed lookup with compatibility. | Assessment / same |
| AC-3 / test correctness / Medium | Initial URI fixtures assumed normalize throws and that a scheme-free suffix object discriminates the colon defect. The patch preserves malformed input; that object was already safe on old bytes. | Assert parse's actual error, normalization preservation and resolve's throw separately. Supply an explicit omitted output scheme for suffix serialization. Real old-byte replay fails all four mechanisms, while the actual Ajv compiler remains green. | First provisional GREEN / same |
| AC-4 / dependency tooling / Low | Bootstrap install without a lockfile write changed the provisional local tree and left one platform-related extraneous package. | Remove that owned extraneous directory, retain full inventory output, and replace the entire provisional installation with clean npm ci from authenticated CI locks. Bootstrap is never final consumer evidence. No lockfile was generated locally. | Focused inventory / same |
| AC-5 / CI bootstrap / Low | Hosted bootstrap npm ci rejects the deliberately stale qs/fast-uri entries. | Dispatch the existing regeneration workflow from the protected source, authenticate run and archive, allow only the two intended entries, then restore and publish normally. | Hosted install / expected before authenticated artifact |
| AC-6 / documentation / Low | Header freshness repair left the README badge and source-coupled release notes requiring explicit updates. A first index edit assumed the wrong heading. | Use actual headings, update badge and release narrative, then pass existing freshness and content gates. | Bootstrap static audit / same |
| AC-7 / tooling / Low | A source-snippet command had shell quoting error; one guessed documentation command/file did not exist, and gh run view rejected a path JSON field. | Use exact discovered filenames and GitHub REST run metadata for workflow path. Retain failed receipts without interpreting them as package failures. | Assessment / same |
| AC-8 / static quality / Low | The first final-push lint run exposed one new unnecessary type assertion in the request-stream fixture, raising warnings from 507 to 508 despite zero errors. | Stop the owned publication before push, remove the redundant assertion, run focused ESLint, then publish normally with the unchanged protected Validate hook. Preserve the interrupted receipt. No warning ceiling is raised. | Consolidation lint / focused new-file lint could have caught it earlier |
| AC-9 / verification tooling / Low | The first integrated clean-CI raw hash comparison stopped on a valid Windows CRLF checkout. Both complete JSON graphs and exact committed Git blobs matched CI; only physical checkout newline bytes differed. | Compare authenticated CI lock bytes with the exact source Git blobs, then separately prove the working files differ only by CRLF. Positive and changed-content negative controls pass. Archive authentication remains strict raw-byte hashing. This verifies delivered source without modifying locks, changing Git settings or repeating unchanged gates. Exact receipt: `test-results/integration-api-advisory-20261029/ci-lock-byte-confirmation.json`; fixed in verification, documented with the next coherent integration. | Artifact verification / same stage; no application defect or escaped gate failure |

Provenance: this bounded execution retains raw command logs and public metadata
in the ignored evidence directory. Tool failures, assertion failures and
publication receipts were reconciled against this execution's available
commands and retained logs. `VSCODE_TARGET_SESSION_LOG` is not present, so a
full debug-transcript reconciliation could not be performed and is not claimed.
The original assertion assumptions were corrected as AC-3, not dismissed.
Existing Jest worker/forced-exit warnings and competing-renderer diagnostics
remain inherited holds, not new runtime regressions or resolved problems.

## Self-improvement and design disposition

**Applied:** actual-parent owner enumeration, behavioral RED/GREEN, explicit
forced-major rejection and one assertion per advisory mechanism prevent an
engine check or a toy adapter fixture from becoming false compatibility proof.

**Accepted:** two flat version pins and a focused regression file introduce no
new runtime responsibility, dependency seam or response field. A generalized
resolver abstraction would duplicate existing package tooling without a
second justified implementation.

Performance, customer-data, cleanup-403, live/browser, visual/native/renderer,
latest-admission and user-stopped authentication holds remain unchanged.
No release-complete, review-approval, deployment or merge claim is made.
