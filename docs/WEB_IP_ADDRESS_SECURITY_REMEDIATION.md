# Web ip-address override security correction

**Last verified:** 2026-10-23
**Status:** CI lockfiles verified and restored; final protected push and hosted review pending. Unmerged, not deployed.

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

### Verified regeneration and restored inventory

| Check | Result |
|---|---|
| Sanctioned run | [39980968858](https://github.com/pranems/SCIMServer/actions/runs/39980968858), SUCCESS, exact bootstrap source `d6e95717591aed8c8b3a09f1e429ebe44b51f7fb` |
| Authenticated artifact | `regenerated-lockfiles`, ID `12513751137`; downloaded ZIP SHA-256 `714cc0d18f35dcb1c61e600b17843f5765d79b721532681c782c17f7da093b15` matches GitHub digest |
| All package changes | Zero. Both locks change only top-level and root-package version metadata from 0.55.59 to 0.55.60; every non-root package entry is byte-equivalent as parsed |
| Provenance | All 684 API and 395 web non-root entries checked for public registry URLs and sha512; CI publish-age report checked at 2026-10-23T15:45:22.541Z has zero package rows, correctly reflecting zero changed packages |
| API lock SHA-256 | `ba189af63651aab01697d4e9ec2ed4ca68643ef89c2c256147bef94b6f02b3db` |
| Web lock SHA-256 | `38022ee29a31f483602e4fbb8c0cb103a391832b8dfaea603a82ec9a3405940f` |
| Restore | `npm ci --no-audit --no-fund` in web: PASS; web lock hash unchanged before/after |
| Installed and locked parser | Exact manifest override 10.7.4; zero locked occurrences and no installed `web/node_modules/ip-address/package.json`. No patched parser is installed because none is required |
| Final focused GREEN | `npm test -- --runInBand --runTestsByPath src/scripts/check-dependency-pins.spec.ts` in API: 23/23 PASS after artifact import and web restore |
| Scanner | `npm run check:pins` in API: API 26 pins / zero findings, web 8 pins / zero findings; unchecked zero |
| Web npm audit | Three Moderate affected packages (`vitest`, `@vitest/mocker`, `@vitest/coverage-v8`), zero High/Critical. Existing Vitest advisories are separate from ip-address and outside this minimal pin scope; no full-audit-clean claim |
| Bootstrap protected push | Ordinary Fast hook at bootstrap source: 25/25 PASS, 619.4 seconds; units 6,214/213 suites, HTTP 2,514/118 suites with 42 tests and two suites skipped for existing backend exclusions |

Receipts are retained under `test-results/ip-address-security-20261023/`,
including `regen-run.json`, `regen-artifacts.json`, `lock-comparison.json`,
`artifact/publish-ages.json`, `web-ci.log`, `green-final.log`,
`pin-report.log`, `web-audit.json` and `bootstrap-push.log`.
Bootstrap units increased by the two new regressions (6,212 -> 6,214).
No API dependency graph changed, so an unnecessary API reinstall is avoided.
The final Validate hook owns the web tests and production build; it is not
replaced by these focused receipts.

## Execution issues, self-improvement and design

**Observation, not an error:** the initial installed dependency lookup returned
no match. Reading the actual locks confirmed that this is a dormant override,
not an installation failure. A synthetic requirement to install ip-address
would add an unrelated dependency and misrepresent the security outcome.
Detection: pre-change dependency inventory, the earliest applicable stage.

**Low, tooling friction:** an inline Node command containing nested escaped
quotes failed before writing anything. A PowerShell single-quoted here-string
passed the same bounded inventory script without cross-shell quote rewriting.
The immediate shell error caught it before source changes; no dependency
absence conclusion relies on that failed invocation.

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
