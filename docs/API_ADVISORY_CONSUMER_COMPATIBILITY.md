# API advisory pins: consumer compatibility and execution RCA

**Last verified:** 2026-10-29

## Executive summary

Proposed product 0.55.64 is stacked on draft PR #260 at
`6eb1b59cb1a8ea324bb1a32b17355fabc605279d`. It changes only qs 6.16.0 to
6.16.1 and fast-uri 4.1.5 to 4.2.3. Neither this patch nor its parent is
merged. PR #259 and #251 remain separate. No deployed version changes.

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

CI-only lock generation, authenticated digest verification, approved-feed byte
verification, clean restore, final GREEN and normal protected Validate
publication are required before this draft can claim patch qualification.
Bootstrap publication, if needed to dispatch the unchanged lock workflow,
is not final dependency qualification. No hosted PR-to-master matrix is
inferred when the draft uses a stacked base.

## Execution issues and root-cause analysis

| ID / type / severity | Symptom and mechanism | Correction and prevention | Detection / earliest possible |
|---|---|---|---|
| AC-1 / test correctness / Low | Initial Superagent fixture called its private query finalizer before the real request builder serializes queued objects. URL stayed unchanged. | Use the actual public form serializer, assert complete values, and retain corrected RED before manifests change. No network request is needed. | First focused RED / same |
| AC-2 / tooling / Low | Comparing Hono v1.19.15 to v2.1.3 returned HTTP 404 because that comparison ref is unavailable. | Read authenticated public v2 release notes and patch release plus actual installed parent bundle. Do not equate failed lookup with compatibility. | Assessment / same |

Provenance: this bounded execution retains raw command logs and public metadata
in the ignored evidence directory. Final handoff reconciles tool failures,
assertions and publication receipts; no full-transcript reconciliation is
claimed unless the complete transcript is available.

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
