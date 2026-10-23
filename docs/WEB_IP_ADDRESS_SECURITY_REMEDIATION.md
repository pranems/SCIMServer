# Web ip-address override security correction

**Last verified:** 2026-10-23
**Status:** Bootstrap implementation; unmerged, not deployed.

## Executive summary

Reserve product 0.55.60 for the minimal exact web override correction
10.7.1 -> 10.7.4 under [issue #248](https://github.com/pranems/SCIMServer/issues/248).
Fresh master is `cddeb5a569b3997000fc3c3bb38349357d83e2ed` (0.55.59).
Unlike the preceding Hono fix, the current web lockfile contains no
ip-address package or dependency edge. The installed web tree also has
no matching package. Updating this dormant override prevents a future
resolution from retaining the vulnerable pin; it does not prove parser
reachability or patched installed code.

## Evidence and scope

| Claim | Evidence |
|---|---|
| Active flaw | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5), CVE-2026-111997, Medium, affects <=10.7.3, first patch 10.7.4 |
| Mechanism | Address6 performs quadratic zone-identifier matching before applying its length limit |
| Duplicate | [GHSA-p3hm-x653-5rc6](https://github.com/advisories/GHSA-p3hm-x653-5rc6) was withdrawn 2026-10-22T16:19:28Z; its missing patch field is not a no-fix finding |
| Quarantine | Approved-registry metadata: published 2026-10-11T19:34:42Z, eligible 2026-10-18T19:34:42Z |
| Dependency chain | No ip-address entry or incoming dependency edge among the 396 current web lock entries; `npm --prefix web explain ip-address` reports no matching dependency |
| Build boundary | Root Dockerfile builds web static assets, removes web node_modules, and copies only web dist into API public; runtime dependencies come from the independent API installation |
| Browser scope | No locked web parser exists to trace into the browser. No exploitability or immutable-image absence claim is made from this fact |
| Source scope | One web override, synchronized product version metadata, regression tests and coupled documents; no checker refactor or new UI behavior |

## Validation lanes

1. Focused RED before manifests: pin regression expected 10.7.4, received
   10.7.1; 22 passed, one failed. Log:
   `test-results/ip-address-security-20261023/red.log`.
2. Bootstrap GREEN checks the manifest and unchanged dependency graph only.
   It is not installed patched-code proof.
3. The existing `regen-lockfile.yml` owns public-registry CI generation.
   Verify its exact source, authenticated artifact, all changed package
   entries, public registry URLs, sha512 and publication ages before importing.
4. Restore only after manifest changes. Confirm lock hashes unchanged by
   `npm ci`, installed absence, production build and normal protected push.
5. Require exact-tip hosted CI and Copilot review. Stop at a reviewed,
   unmerged PR; no merge, deployment or benchmark retry is authorized.

## Execution issues, self-improvement and design

**Observation, not an error:** the initial installed dependency lookup returned
no match. Reading the actual locks confirmed that this is a dormant override,
not an installation failure. A synthetic requirement to install ip-address
would add an unrelated dependency and misrepresent the security outcome.
Detection: pre-change dependency inventory, the earliest applicable stage.

**Self-improvement: applied.** A permanent regression checks the exact pin and
the deliberate absence of parser entries and incoming edges. Scanner rows
must be distinguished from distinct active flaws; withdrawn duplicates are
not new blockers. Existing classification-versus-inventory guidance applies.

**Design disposition: accepted.** The existing override and CI regeneration
seam are cohesive. No runtime responsibility or coupling changes, and no
second implementation justifies a speculative abstraction.

## Retained holds

PR #251 remains unmerged. Its identical-image 0.55.58 A/A p99 failure
40.650743 versus 50.378052 ms (ratio 1.23928982, ceiling 1.10) remains
authoritative and is not product-causality proof. No favorable retry,
threshold, quota or resource change is included. Customer actual-data and
migration receipts, capacity and operational dispositions, cleanup 403
verification and target-specific operator visual observations remain pending.
Last retained dev 0.55.56/customer 0.55.20 observations are historical, not
freshly queried. Published 0.55.59 is not deployment/performance acceptance.
