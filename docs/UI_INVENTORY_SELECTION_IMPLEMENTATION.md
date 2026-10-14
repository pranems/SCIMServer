# Compact endpoint inventory and comparison selection

**Last verified:** 2026-10-14

## Executive summary

UI-03, UI-04, UI-06, UI-07 and UI-08 are implemented locally on
`fix/ui-inventory-selection-20261014`, based on readability checkpoint
`a5c1c603`. The original analysis checkout, parent readability worktree,
runtime PR #215, deployments and shared directory configuration are untouched.
This is not a release or an operator visual approval.

## Outcomes and boundaries

| Item | Local outcome | Evidence |
|---|---|---|
| UI-03 | Dashboard shows at most five endpoints in existing inventory order, resource counts and an explicit complete-inventory action. It does not invent recent/favorite ranking. | Zero, one and 80 endpoint fixtures at three widths; exact count, resource values and navigation. |
| UI-04 | Endpoint table exposes identity, copyable ID/base path/profile schema names and status. Search retains existing `q` URL ownership. | Name, ID, schema summary, inactive and zero-result filters; reset, Back/Forward, keyboard open and clipping measurements. |
| UI-05, first application | Endpoint filters sit outside the 420 px vertically/horizontally scrollable results region. | Scroll exceeds 500 px without moving the filter; mobile overflow stays in the panel. Broader surfaces are not claimed. |
| UI-06 | Discovery reuses the endpoint context combobox with searchable name/ID/profile/status options and a bounded 280 px popup. | Large-inventory narrowing and pointer/keyboard primary/secondary selection. |
| UI-07 | Selection has a branded border/background, checkmark, role text, full copyable identity and a pressed selected button. Inactive endpoints remain inspectable in Discovery, not action targets elsewhere. | Exact selected IDs, `aria-pressed=true`, inactive secondary selection and 208 px identity bounds. |
| UI-08 | Schemas, ResourceTypes, ServiceProviderConfig order; Schemas is the default. Explicit existing tab deep links still work. | Tab order, selected tab on Back/Forward, advertised schema/type values and exact Workbench GET prefill. |

Data flow remains: cached endpoint response -> shared identity matcher ->
URL-owned inventory filter or selected endpoint ID -> existing detail/discovery
queries. No API contract, persistence behavior, version or dependency changes
are part of this checkpoint.

Profile search means the **published profile summary** schema names and
ResourceType names, not an invented preset label. A missing summary is
explicitly displayed as `No profile summary`.

## Finite measured matrix

The new `web/e2e/endpoint-inventory-selection.spec.ts` runs 15 Chromium cases:
five scenarios at 1440, 900 and 390 px. Fixtures supply 80 endpoints, including
a long name and inactive target, without changing a deployment.

| Width | Inventory table | Name column | Five-item Dashboard height | Selected identity height |
|---|---:|---:|---:|---:|
| 1440 | 1149 px | 448.38 px | 504 px | 208 px |
| 900 | 640 px | 245.33 px | 520 px | 208 px |
| 390 | 640 px, panel scrolling | 245.33 px | 536 px | 208 px |

Every page width equals its viewport width. Tests measure actual clipping,
column bounds, result counts and values rather than CSS property presence.
JSON receipts, screenshots and logs live under gitignored `test-results/`.
These are controlled UI-data tests, not proof of deployed API behavior.

Focused component/URL units pass 63 tests in five files. Web production build
and all existing size budgets pass. Type checking reports 66 diagnostics,
all in unchanged pre-existing test files; no changed production file has a
diagnostic. Full consolidation, live deployment checks, canonical visual
baseline review and operator visual signoff are intentionally not performed
in this implementation lane.

## Execution issues and root causes

| ID | Type / severity | Symptom and mechanism | Resolution and why it works | Detection / earliest detection |
|---|---|---|---|---|
| IS-I01 | Environment / Low | Vite and tsc missing in a new worktree. Dependencies are not copied by Git. | After each missing-tool failure, junction matching release-worktree dependencies. Lockfile comparison differs only in root product version. No package install or lock rewrite. | First dev/build invocation / same |
| IS-I02 | Generated output / Low | API build reports missing Prisma members: generated client files are not in Git. Generation initially requires `DATABASE_URL` just to load config. | Generate into this worktree with a non-secret localhost URL, then build. Generation makes no DB connection and changes no shared generated output. | API build / generation before build |
| IS-I03 | Tooling / Low | Playwright finds no tests when given a Windows path as its regex selector. | Select the unique filename stem; filesystem commands still use Windows paths. | Browser launch / same |
| IS-I04 | Implementation / Medium | Initial truncation renders no text and tsc rejects `children`. Existing primitive requires `text`. | Use its actual typed contract; no new primitive or cast. Build and value assertions protect against empty labels. | Type/browser check / type check |
| IS-I05 | Test correctness / Low | Fluent SearchBox test ID belongs to the input itself, and Tab text includes a hidden sizing duplicate. | Address search by accessible role/name; assert ordered tab IDs and selected semantics rather than duplicated DOM text. | Browser check / same |
| IS-I06 | Interaction / Medium | Programmatic search changes the query but Fluent does not automatically open its popup. | Explicitly open on input and reset the transient query on popup close/selection; IDs remain URL-owned. Browser pointer and keyboard assertions now exercise this boundary. | Browser check / same |
| IS-I07 | Layout / Medium | Five-item summary measured 600/616 px and selected mobile identity measured 236 px, exceeding declared bounds. | Reduce card gaps and use a small, concise selected marker while keeping full accessible identity. Final geometry is 504/520/536 and 208 px. No threshold relaxation. | Browser geometry / same |
| IS-I08 | Coverage migration / Medium | Existing Discovery units target removed cards; live browser selectors and card-click smoke paths would become stale. | Migrate to combobox options and pressed selected summaries, explicit navigation buttons, and Schemas default. Preserve all existing tests and fixture ownership. | Targeted units plus source search / same |

Fix SHAs are assigned by the containing logical commits, not fabricated before
commit creation. Raw-event reconciliation remains required at final handoff.

## Self-improvement and design disposition

Test/gate improvement **applied**: finite large-inventory geometry, exact
filter counts, full selected IDs, keyboard navigation and URL-history checks
now make the operator's reported class executable. A green presence assertion
cannot substitute for any of these outcomes.

Design disposition **accepted**: reuse one context selector and extract a
small identity matcher plus a scroll-ownership panel. The matcher has two
real consumers; the panel is shared by inventory and the next Operations
application. No backend abstraction, policy language or global layout
rewrite is justified. Dashboard retains summary responsibility; Endpoints
retains management; Discovery retains contract comparison.
