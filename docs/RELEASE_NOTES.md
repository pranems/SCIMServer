# SCIMServer release notes

> **Status:** User-facing reference - **Last verified:** 2026-10-23 - **Product version:** `0.55.65`

These curated notes explain what changes for operators and integrators, how to
upgrade, and what remains limited. The [engineering changelog](../CHANGELOG.md)
retains implementation and validation history. The [documentation index](INDEX.md)
links to the current task-oriented guides.

The project already follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). These notes are its
user-facing companion, not a second independent version ledger or a raw commit
log. Versions remain in the pre-1.0 development series; inspect compatibility
notes rather than assuming that a patch label makes every rollback lossless.

## Unreleased

### 0.55.65 preserved performance-source integration

This draft candidate now integrates the preserved performance-qualification
history with reviewed master `cffc64c8`, after #259, #260 and #261 merged.
It preserves their web/API dependency fixes, request-body security patches,
logging test-fixture corrections and every constituent commit. It adds no new
serving behavior. New-head gates and review remain required.
See the [local diagnostic checkpoint](MEMBERSHIP_HISTORY_DIAGNOSTIC.md).

The original frozen performance run remains FAILED: populated-read p99 ratio
1.23928982 exceeds the unchanged 1.10 limit. Source consolidation, ordinary CI
and version reservation do not qualify performance or admit a release artifact.
The formerly independent complete-inventory correction is now inherited
through normally merged #260, not copied from an unreviewed draft.

### Historical source consolidation preparation: 0.55.64

Reviewed web #259 and API inventory #260 are merged, most recently at
`287ea671`. The proposed 0.55.64 advisory patch now integrates that master,
retaining both fixes and every constituent commit. Its new-head validation,
review and CI remain separate requirements. Historical preparation notes
below remain provenance, not claims about the current merged/deployed state.
The Hono and final-artifact qualification boundaries remain unchanged.

### Stacked API advisory preparation: 0.55.64

The [actual-consumer compatibility report](API_ADVISORY_CONSUMER_COMPATIBILITY.md)
records proposed qs 6.16.1 and fast-uri 4.2.3 pins, stacked on unmerged
draft #260. Five assessed API advisory records are targeted. The Prisma
development adapter advisory remains blocked pending actual-parent lifecycle
qualification; this is not full advisory clearance or a deployed release.
No API response contract, migration or operator configuration changes.

### 0.55.62 web Seroval and Undici security dependency patch

This proposed patch updates exact web overrides from Seroval 1.6.3 to
1.6.11 and Undici 7.29.1 to 7.30.1. These minimal compatible patches address
the five Seroval and eight Undici advisory records listed in
[issue #256](https://github.com/pranems/SCIMServer/issues/256).
Both patches exceed the seven-day quarantine minimum. The existing API
request-body security correction remains intact; six separate API advisory
records remain open. See [ownership, scope and validation](WEB_SEROVAL_UNDICI_SECURITY_REMEDIATION.md).
CI-generated locks now contain only the two intended package updates; the
restored web dependency inventory and all focused pin/owner tests pass.
Final protected validation and hosted review remain required.
No UI behavior, deployment, browser
exploitability assessment or overall release approval is included.

### 0.55.61 request-body security dependency patch

This draft patch pins body-parser to 2.4.0 and multer to 2.5.0 for the two
High request-body advisories tracked by
[issue #256](https://github.com/pranems/SCIMServer/issues/256).
A single exact iconv-lite 0.7.3 override gives its three compatible API owners
one shared npm override context. This corrects an actual dependency inventory
failure without changing the already-patched package versions.
All selected patches meet the seven-day quarantine minimum.
See [scope, ownership and validation](REQUEST_BODY_SECURITY_REMEDIATION.md).
This is not a deployment or release-admission claim; independent release
prerequisites remain open.

### 0.55.60 web dependency override correction

This proposed patch changes only the web ip-address override to exact 10.7.4
for [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5),
which fixes quadratic IPv6 zone-identifier parsing. The current dependency
graph does not contain ip-address, so this is preventive override hygiene,
not evidence of a vulnerable browser bundle or a newly installed parser.
The patch is older than the seven-day quarantine minimum. The withdrawn
duplicate GHSA-p3hm-x653-5rc6 is not another active flaw.
See [scope and validation](WEB_IP_ADDRESS_SECURITY_REMEDIATION.md).
No application, UI, API contract or deployment change is included.
Existing performance and customer verification holds remain unchanged.

### 0.55.59 Hono security dependency patch

This pending patch pins transitive Hono to exactly 4.13.11 for
[GHSA-5r4p-p66f-jhc7](https://github.com/advisories/GHSA-5r4p-p66f-jhc7)
([issue #248](https://github.com/pranems/SCIMServer/issues/248)).
The Medium advisory affects Hono >=4.12.4 and <4.13.11: `serveStatic` can
decode a routed path again and bypass middleware protecting a static prefix.
It is not traversal outside the configured root.

The existing frozen 0.55.58 image demonstrably includes Hono 4.13.7 through
Prisma tooling, despite `devOptional` lockfile classification. No direct
application import was found, but that does not prove unreachability.
The eligible patch uses the existing CI-only lockfile process; bootstrap
checks against the old installation are not patch validation.
There is no application/UI change, deployment, new image qualification or
performance admission claim. Existing release holds remain unchanged.
The historical non-UTC nested-Jest timeout was corrected in separate,
normally merged prerequisite #252 without changing either deadline. The
Hono branch preserves all four original commits and merges master normally.
Its protected bootstrap passes, then exact-source CI regeneration
`39965730441` produces only the Hono patch and coordinated version metadata,
with public-registry URLs, sha512 and a verified publication age over 24 days.
The actual restored private dependency tree and lockfile both contain 4.13.11;
42 focused pin/freshness tests pass. This is not a deployed release or new
performance qualification. Final protected publication, exact-tip CI and
hosted Hono review remain separate checks.

Fresh API dependency audit reports zero vulnerabilities. The unchanged web
dependency graph reports three Moderate affected Vitest packages, zero
High/Critical, from GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp. This patch
does not silently upgrade that unrelated toolchain or claim its audit is
clean; separate triage is tracked in the
[supply-chain policy](strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md).

### 0.55.58 correction, validated privately and awaiting reviewed merge

The pending correction preserves the merged 0.55.57 endpoint token-lifetime
controls while reducing avoidable endpoint/profile and Group persistence work.
Computed writes retain scoped resource-version checks, profile/uniqueness
locks and responses from their own commit. An additive database-owned endpoint
revision supports compact freshness checks; it is not an event bus or a
cross-request resource cache.

The combined source passes 1,327 focused units and 303 PostgreSQL integration
tests, including lifetime issuance and write safety. API lint is zero errors /
512 warnings; Web build/size pass and the existing 66-diagnostic type baseline
is unchanged. These initial preparation checks are superseded by the complete
pre-merge checkpoint below, not by the older private performance receipt.
The earlier private 0.55.56 performance pass is not a receipt for this version.
See [the current integration and limitations](ENDPOINT_SNAPSHOT_REVISION.md#16-reconciliation-with-merged-token-lifetime-master-2026-10-21).

The subsequent normal protected push passes all 28 gates, including
6,208 API units, 2,511 InMemory HTTP cases (42 database-only pending)
and 1,655 Web tests. Existing hook log-suite exclusions remain, so this is
not a complete deployment matrix. Public CI produces version-only 0.55.58
lock metadata with unchanged dependency graphs and verified provenance.
Later publication and current-image proof are recorded below; review and
merged-master deployment remain separate.

**Current pre-merge checkpoint:** PR #250 publishes 0.55.58 at `4bf55093`
with seven passing exact-tip checks. Complete HTTP now passes 2,609 cases
on PostgreSQL and 2,567 on InMemory, with 42 genuine database-only exclusions.
Both full Web unit and coverage inventories pass 1,655 tests. The failed
fork-worker startup run is retained separately from the successful complete
thread-pool unit run; no assertions, timeouts or coverage floors are relaxed.
The actual immutable CI image passes all 12 matched latency limits against
0.55.20. Calls decrease 4.10% and application CPU 8.02%; removal p99 is
+9.07% and SQL execution +37.14%, so capacity review is still explicit.
Actual-image entrypoint contracts pass 24 cases, all 30 migrations apply,
and complete Docker/native live suites each pass 1,819 assertions. The final
real Chromium run passes all 328 cases in 50 files, zero skips/failures/flakes,
all mutation/shape/pixel opt-ins enabled. Six seeded endpoint IDs remain and
owned cleanup/redaction pass. The first 321/7 browser result stays failed;
test-only fixes address fixture aging, stale-read setup and OAuth input.
The one inspected Windows pixel-baseline correction masks the visible
scroll panel, with separate real row/column/viewport measurements.
No application layout or runtime behavior changes in that follow-up.
Copilot returns a billing error rather than substantive review; there is
no merge or cloud deployment.

Fresh Web audit on 2026-10-21 reports three Moderate findings in
Vitest/coverage/mocker and zero High/Critical. This supersedes the earlier
zero-finding snapshot below; no major dependency upgrade or quarantine
exception is silently applied. The 0.55.58 version-only lock updates came
from public-registry CI, not local regeneration.

### Historical Vite prerequisite receipt

Build-tooling security preparation pins Vite to patched 8.1.6, addressing
the launch-editor advisories affecting 8.0.0-8.1.5. This patch is older than
the seven-day quarantine. It does not change the SCIM contract or deployed
version. The exact-patch CI lockfile has been verified and restored privately;
the fresh web dependency audit now reports zero vulnerabilities. Prerequisite
PR #247 merged after substantive automated review and green exact-tip CI,
not the audit alone. See the
[supply-chain receipt](strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md#2026-10-21-vite-security-prerequisite).

The documentation checkpoint below records actual publication/dev evidence and
the customer hold. It introduces no further runtime or version change.

## 0.55.57 - 2026-10-21, merged source with separate deployment gates

PR #249 is now merged as `5841f724`. The local receipts below describe its
pre-merge validation, not a new cloud deployment or the later 0.55.58
performance combination.

Endpoint-scoped OAuth client tokens and WIF tokens can be configured from
60 seconds to 604800 seconds, inclusive, in whole seconds. The default is
3600 seconds. Connect, Settings and the WIF trust form offer common-value
dropdowns alongside editable inputs, including custom values such as 61.
Clearing an endpoint override restores inheritance.

A WIF trust override takes precedence over the endpoint WIF setting.
The verified assertion's remaining validity still caps the issued token, so a
short-lived assertion can correctly produce a token shorter than 60 seconds.
Existing tokens are not revoked or rewritten. Global OAuth lifetime, static
credential retention and authentication-method enablement are unchanged.

All six local matrix modes pass. The versioned Docker candidate passes
1811 live assertions, 24 shipping-entrypoint contracts and all 327 browser
cases without skips or flakes; local Node independently passes 1811 live
assertions. Both report 0.55.57. The preserved original stash and separate
validation resources keep the parallel release cycle untouched.

This version is not deployed by this consolidation work. Normal publication,
reviewed exact-tip CI and merge are PR-controlled release boundaries, not
inferred from local passes. Existing deployed 0.55.56 receipts below are not
evidence for a 0.55.57 deployment. Operator visual verification remains a
later deployment requirement.
See the [active validation handoff](auth/ENDPOINT_TOKEN_LIFETIME_TDD_HANDOFF.md#authorized-release-consolidation-2026-10-21).

## 0.55.56 - 2026-10-17

### Fixed

Container startup no longer prints the database connection string. It reports
only whether the setting is configured. This affects output before the normal
application logger initializes; its redaction cannot protect shell startup.
Prisma startup also stops embedding the URI in application messages and
fallback warnings. Structured-data redaction does not sanitize a URI already
interpolated into a message. The separate OAuth 0.55.55 delivery retains its
own release identity.
No API, UI, authentication, database migration or resource-ID contract changes.
The exact merged-master image is published and deployed to dev. Its version,
full-SHA and latest aliases match one immutable digest. Full deployed Chromium
passed 324 cases without skips; additional headed actual-data geometry passed
six sets. Docker/dev live checks each passed 1,797 assertions; native Entra
passed 50 checks with all 15 cleanups successful.

Customer production remains on 0.55.20. The protected-copy worker exited zero,
but its structured migration measurements were not captured, so the rehearsal
is not certified. All receipt-owned temporary resources are deleted; the final
provider-managed-group check needs authorized read access. Measured migration,
customer performance, actual human visual observation and normal canary/customer
promotion checks remain open. See [the evidence and limits](STARTUP_DATABASE_CONFIGURATION_REDACTION.md#merged-master-dev-checkpoint).

If an older container has started with a password-bearing connection string,
treat its startup logs as potentially sensitive. Restrict access and review
retention. After deploying the corrected image, rotate the affected database
credential through a coordinated update of its consumers. This patch prevents
new startup disclosure; it does not erase retained logs or rotate credentials.

## 0.55.55 - 2026-10-17

### Fixed

- OAuth token responses now retain `application/json`, as required by OAuth
  2.0. Previously the SCIM response interceptor replaced it with
  `application/scim+json` on token routes under `/scim`. Global and per-endpoint
  token contents, credential rules and cache headers are unchanged; actual SCIM
  resources still use their SCIM media type. No database migration is needed.
  Included in the subsequent 0.55.56 dev delivery and its three-mode native
  Entra validation. This does not certify a customer-production upgrade.

### Changed

- Prior 0.55.54 documentation-only closeout added release-note navigation,
  current behavior descriptions and upgrade guidance. Those documentation
  changes did not alter runtime, package versions, lockfiles, deployed quotas
  or the immutable image; the runtime fixes above are separate changes.

## 0.55.54 - 2026-10-16

### Changed

- **Endpoints:** the results table uses the available window height rather than
  a fixed 420-pixel region. Search and filters stay outside the results scroll
  owner; names are left-aligned and long values remain bounded.
- **Dashboard:** the bounded five-endpoint summary uses compact horizontal rows
  with left-aligned names and resource information, plus **Browse all endpoints**.
  It is not a favorite/recent ranking.
- **Date/time and identity, included from 0.55.50:** absolute timestamps show both
  date and time, milliseconds and an explicit UTC timezone across tables, cards,
  tabs, drawers and diagnostics. Copy preserves the source value. Relative ages
  and elapsed durations remain relative. Operations endpoint names are plain
  links, with separate copy and new-tab actions rather than outlined badges.
  Invalid or timezone-free expiry input is not shown as a valid expiry.
- **Inventory and Discovery:** compact searchable endpoint selection, persistent
  URL-owned filters, and the Schemas, ResourceTypes, ServiceProviderConfig tab
  order are included. Operations is current cross-endpoint resource state;
  Logs is request history; `/Me` resolves the authenticated OAuth subject.

### Fixed

- **Minimal imported Group schemas, 0.55.52:** a value-only member is valid when
  the effective schema declares `members.value` but not `display` or `type`.
  Internally materialized `undefined` properties are absent values, not
  client-supplied attributes. Keep `StrictSchemaValidation` enabled: genuinely
  supplied undeclared fields still fail without a partial write.
- **Member references, 0.55.53:** an accepted `members.$ref` retains its exact
  value through POST, PUT, ordered PATCH, both persistence backends and readback.
  Existing mutability, returned/projection and membership policy rules still
  apply. References are not fetched or rewritten.
- **Profile/runtime identity:** legacy profile normalization no longer creates
  a false revision conflict. Genuine concurrent profile edits still fail safely.
- **Endpoint-list work, 0.55.51:** unchanged persisted profiles are fingerprinted
  before repeated conversion, cloning and hashing.

### Upgrade and rollback

1. Review the effective `/Schemas`, `/ResourceTypes` and endpoint settings.
   A historical mapping failure is not permission to widen a schema or disable
   strict validation.
2. Back up the database and follow the existing deployment/migration procedure.
   Migration `20261016094245_add_group_member_reference` adds nullable
   `ResourceMember.reference` TEXT. It does not backfill or change membership IDs.
   All 29 migrations replayed on a fresh database; populated legacy membership
   fields were checked unchanged after upgrade.
3. Verify value-only and reference-bearing membership through independent GET
   readback, including add/remove, duplicates and rejection atomicity under your
   effective policies.
4. Prefer roll-forward after reference-bearing writes. Older binaries may erase
   accepted references when replacing membership rows: an old-binary rollback
   is not lossless. Retain the additive column and backup, and suspend affected
   writes if an emergency rollback is necessary.
5. Database-copy tooling must preserve nullable member references. Verify source,
   target and tool schema compatibility before mirroring an older database.
   Do not run destructive fixtures against active provisioning workloads.

See [deployment options](../DEPLOYMENT.md),
[member-reference migration and compatibility](GROUP_MEMBER_REFERENCE_PRESERVATION.md)
and [mirroring safeguards](PROD_TO_DEV_MIRRORING_AND_FIXTURES.md).

### Validation and deployment status

- Dev and the same-tenant canary received the same immutable artifact,
  `sha256:42613fe093bcb770c8eec849f2ac8840afa1b0ca85a1b8baf98efa33665745f9`.
  Customer production was not promoted by this delivery.
- The successful outer pipeline recorded **40 PASS / 0 FAIL / 0 SKIPPED /
  9 reviewer PENDING** in 6,349 seconds. Later scoped review dispositions are
  separate; the original pending rows were not rewritten.
- The full six-mode selection passed 6,060 API units in each backend mode,
  2,516 InMemory HTTP tests plus four PostgreSQL-specific exclusions, 2,520
  PostgreSQL HTTP tests, and 1,624 Web tests. Default protected CI/pre-push uses
  a narrower 2,460-pass HTTP selection plus the same four exclusions.
- Native Entra provisioning passed 50 checks across three authentication modes,
  including actual Group add/remove readback; all 15 exact cleanup entries
  succeeded. Authoritative dev browser evidence is 324 expected passes with
  zero skipped, unexpected or flaky cases.
- Docker, dev and each canary live verification passed 1,795 registered
  assertions. The 66-assertion minimal membership section includes 14
  error-oracle and two state-oracle self-checks, not 66 distinct HTTP journeys.
  Canary browser checks passed 289 cases with 11 separately disclosed
  mutation-opt-in exclusions per run.
- Dev retained 74 original endpoint IDs; canary retained 64 endpoints. Existing
  test/lint debt and small-quota performance tails remain disclosed.

### Known limits

- The nested Docker validation uses `-SkipLocal`; a later separate full
  compiled-node live run closes that independent claim with 1,795 PASS /
  0 FAIL, empty pre/post inventory and the helper stopped. The earlier receipt
  is not rewritten.
- [Supplemental release assurance](evidence/RELEASE_05554_ASSURANCE_20261016.json)
  records the exact deployed-digest Trivy gate passing and fresh headed
  Chromium geometry on actual dev/canary content. Both estates retain their
  original endpoint IDs. The existing full dev browser run is 324 PASS with
  zero skips; the canary opt-in exclusions remain unexecuted without exclusive
  mutation ownership.
- The image was published from merged `c3ef1f0d` and reused after runtime-input
  equality checks at later shipping checkouts. It was not freshly rebuilt from
  each later documentation commit. A GitHub Release page/version Git tag has
  not been published: the existing `v*` tag workflow would rebuild the image
  and can overwrite the version tag. GHCR release/source/latest tags exist.
- Matched 0.5-CPU measurements retain over-10% membership tail increases.
  A 2-CPU diagnostic improved latency quantiles but did not change deployed
  quotas or establish a production latency guarantee.
- Positive provisional visual feedback was received, but its target/version
  was not confirmed. It is not customer-production promotion approval.
- Discovery comparison is an inspection aid, not a complete recursive or
  symmetric conformance certificate. Native Entra WIF proof does not establish
  every first-party/sovereign acquisition-mode claim.
- Historical Google User mapping errors and cleanup-related 404s were not
  reclassified as current defects or repaired by changing credentials/mappings.

See [minimal Group membership evidence](GOOGLE_MINIMAL_GROUP_MEMBERSHIP.md),
[responsive UI, immutable receipts and performance limits](RESPONSIVE_ENDPOINT_INVENTORY.md)
and [SCIM/Entra compatibility](SCIM_ENTRA_COMPATIBILITY.md).

## Upgrading from 0.55.20: cumulative highlights

This is a curated outcome summary, not a claim that every intervening commit
is a feature. The [source comparison](https://github.com/pranems/SCIMServer/compare/6785200f...a262e27e)
and [engineering history](../CHANGELOG.md) retain implementation detail.

| Area | What is included in 0.55.54 | Current guide |
|---|---|---|
| Credentials and WIF | Keyed/legacy visibility, lifecycle controls, bounded trust lookup/cache and effective configuration provenance | [Authentication](AUTHENTICATION_GUIDE.md) |
| Profile-driven provisioning | User, Group and custom-resource forms, live-profile authority and executable Workbench requests | [Resource forms](PROFILE_DRIVEN_RESOURCE_FORMS_AND_CUSTOM_RESOURCES.md), [UI guide](UI_GUIDE.md) |
| SCIM correctness | Typed ordered PATCH, atomic/conditional writes, uniqueness, Group transactions, schema characteristics, search/query and lifecycle contracts | [API](COMPLETE_API_REFERENCE.md), [PATCH](PATCH_OPERATIONS_COMPLETE_GUIDE.md), [characteristics](SCIM_CHARACTERISTIC_RECONCILIATION.md) |
| Imported Group schemas | Strict value-only membership and exact accepted reference persistence | [Schema customization](SCHEMA_CUSTOMIZATION_GUIDE.md), [member references](GROUP_MEMBER_REFERENCE_PRESERVATION.md) |
| UI workflows | Context-preserving navigation, compact selection, full absolute timestamps, plain endpoint links and responsive inventory | [UI](UI_GUIDE.md), [navigation](GLOBAL_NAVIGATION_AND_WORKFLOW_CONTEXT.md) |
| Performance and observability | Dashboard/activity caching and query improvements, RequestLog indexing and endpoint identity preservation | [Observability](OBSERVABILITY_TRACEABILITY_AND_DIAGNOSTICS.md), [logging](LOGGING_AND_OBSERVABILITY.md) |
| Delivery assurance | Owned backend/Docker fixtures, native Entra proof, zero-skip authoritative dev browser evidence and immutable publication provenance | [Current evidence](RESPONSIVE_ENDPOINT_INVENTORY.md#deployed-release-closeout) |

## Maintaining these notes

1. Add a concise operator-facing bullet under **Unreleased** in the same change
   as a user-visible behavior, and update its task-oriented guide. A new internal
   implementation document alone is not sufficient.
2. At a release cut, move the relevant bullets to a dated version entry. Use
   **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed** and **Security**
   where applicable; do not invent a security finding or an empty category.
3. Include compatibility, migration/rollback, operator steps and known limits.
   Separate tests, assertions, suites and deployment targets; do not aggregate
   repeated selections into a unique test total.
4. Keep [CHANGELOG.md](../CHANGELOG.md) for engineering details and link exact
   evidence. Preserve failed receipts and historical captures rather than
   restamping them as fresh deployment proof.
   At closeout, also inspect current user guides for obsolete local/unreleased/
   not-deployed claims: a current version header alone does not prove that the
   behavioral explanation was updated. Change those labels only with actual
   delivery evidence, and leave explicitly historical receipts unchanged.
5. The [documentation manifest](.doc-manifest.json) binds these notes to both
   package manifests. The existing F4 freshness check therefore requires a
   release-note update when a package version changes. Use CI-only lockfile
   regeneration under the existing supply-chain policy.
6. Documentation-only corrections do not create a runtime version or deployment.
   If GitHub Releases are published, mirror this curated entry; do not treat
   container tags or automatically generated commit lists as a second set of
   user-facing release facts.
