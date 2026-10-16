# SCIMServer release notes

> **Status:** User-facing reference - **Last verified:** 2026-10-16 - **Product version:** `0.55.54`

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

### Changed

- Documentation-only release-note navigation, current behavior descriptions and
  upgrade guidance. No runtime, package version, lockfile, deployed quota or
  immutable image changed.

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

- The nested Docker validation uses `-SkipLocal`. Its passing outer gate is
  not proof of a full standalone compiled-local-node live run; focused
  compiled-node membership evidence and full InMemory Jest evidence are
  separate claims.
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
