# UI Visual Review Backlog - 2026-10-12

> **Status:** Next-release backlog - **Last verified:** 2026-10-12 - **Product version:** `0.55.47`

## Executive summary

The operator's post-deployment review found two concrete readability problems and several broader workflow-design opportunities. None of the inspected items is a confirmed data-loss, authorization, routing, or API-contract defect, so the v0.55.47 runtime remains unchanged. The next UI release should first make activity and endpoint identity reliably readable, then simplify repeated endpoint-selection surfaces and persistent filtering.

This backlog records the supplied visual evidence without committing the original screenshots. Each item includes a measurable browser acceptance criterion so a future fix cannot pass on element presence alone.

**Local implementation checkpoint:** UI-01 and UI-02 are implemented with nine
measured Chromium cases at 1440, 900, and 390 px, including real clipping,
stable fields, readable mobile columns, and navigation. See
[readability evidence and RCA](UI_ACTIVITY_ENDPOINT_READABILITY.md).
These two items are not yet deployed or operator-approved. UI-03 through UI-10
are owned by the isolated inventory branch. UI-03/04/06/07/08 pass a finite
15-case responsive Chromium matrix locally; UI-05 has its first shared-panel
application. UI-09/10 intent verification remains in progress. See
[inventory implementation and RCA](UI_INVENTORY_SELECTION_IMPLEMENTATION.md).
The original current-release dispositions below are preserved.

## Current surface intent

| Surface | Intended job | Why it is not a duplicate |
|---|---|---|
| Dashboard | At-a-glance health, request trend, recent activity, and quick endpoint entry | It is a summary and navigation surface, not the complete endpoint-management workspace. |
| Self-service `/Me` | Exercise RFC 7644 section 3.11 for the SCIM User represented by the current OAuth token | It resolves the token subject inside one endpoint. The endpoint admin panels manage resources as an operator and do not replace token-holder self-service semantics. |
| Operations | Show current Users, Groups, and aggregate statistics across all endpoints | Operations answers "what exists now"; Logs answers "what requests happened." |
| Discovery | Inspect or compare the advertised Schemas, ResourceTypes, and ServiceProviderConfig of one or two endpoints | It compares protocol contracts rather than runtime resources or request history. |

## Observed items and disposition

| ID | Observation | Expected behavior | Why it matters | Priority | Current-release disposition |
|---|---|---|---|---|---|
| UI-01 | Dashboard Recent Activity fields do not remain visually aligned across rows with different path, endpoint, authentication, and time values. | Each semantic field occupies a stable column or grid track; long values truncate without shifting adjacent fields. | A request list that cannot be scanned row-by-row hides failures and endpoint attribution. | High | Defer to the next UI release. No incorrect data or navigation behavior was demonstrated. |
| UI-02 | Long endpoint names in Operations can wrap or crowd the endpoint column. | Endpoint identity remains readable, bounded, and non-overlapping at supported wide and narrow viewports. Full identity remains available through tooltip or copy affordance. | Endpoint provenance is the defining value of this cross-endpoint view. | High | Defer to the next UI release. Existing fixed table layout prevents columns from leaving the table, but endpoint-label presentation still needs measured refinement. |
| UI-03 | Endpoint cards on Dashboard duplicate the dedicated Endpoints section and become expensive to scan at high endpoint counts. | The Dashboard presents a bounded summary or recent/favorite endpoints with a clear path to the complete Endpoints workspace. | Seventy-plus cards push health and activity information far down the page. | Medium | Design in the next release. Do not remove quick endpoint access without usage and navigation evidence. |
| UI-04 | Endpoint browsing may work better as a compact table/list with an always-visible text filter than as an unbounded card grid. | Operators can filter by endpoint name, ID, profile, and status without losing the filter while scrolling. | Dense operational inventories need fast scanning and keyboard-friendly narrowing. | Medium | Design together with UI-03 so Dashboard and Endpoints do not gain competing inventory models. |
| UI-05 | Table and multi-item filters are not consistently persistent while content scrolls. | A common filter-toolbar primitive stays visible within the content region and preserves URL-owned filter state. | Operators should not scroll to the top repeatedly when reviewing long result sets. | Medium | Apply incrementally after defining one shared responsive and accessible pattern. |
| UI-06 | Discovery primary and secondary endpoint selection expands into long card grids. | Use a searchable compact selector that exposes endpoint name, ID, profile, and selected state without rendering the full estate as cards. | Comparison setup dominates the protocol data being compared at large endpoint counts. | High | Next-release redesign candidate. Preserve primary and secondary endpoint IDs in URL state. |
| UI-07 | Discovery selection should be more visually obvious. | Selected endpoints have redundant visual and semantic indicators: contrast, icon or marker, and `aria-pressed=true`. | The current selected class and ARIA state are structurally present, but the operator did not perceive the selection reliably. | Medium | Strengthen visual treatment as part of UI-06 rather than as an isolated color-only change. |
| UI-08 | Discovery comparison tabs are ordered ServiceProviderConfig, ResourceTypes, Schemas; requested order is Schemas, ResourceTypes, ServiceProviderConfig. | Tabs follow the requested contract-first order and preserve the selected tab in URL state. | Schemas define the attribute vocabulary consumed by ResourceTypes and capability advertisement. | Low | Safe next-release change with focused navigation and URL-state coverage. |
| UI-09 | The purpose and future direction of Operations are not immediately clear from navigation alone. | The page description and documentation clearly distinguish cross-endpoint current state from request history and endpoint-local management. | Users may treat a useful aggregation view as unexplained duplication. | Medium | Current page copy already states the distinction. Reassess information architecture with UI-03 through UI-06. |
| UI-10 | The purpose and continued need for Self-service `/Me` are unclear. | Navigation or inline help explains that `/Me` is an OAuth subject-resolution and self-service workflow, not an administrator profile. | Removing it would drop the only browser workflow for RFC 7644 section 3.11. | Low | Retain. Improve discoverability rather than merging it into endpoint administration. |

## Required Playwright acceptance checks

Future implementation is incomplete until real Chromium tests prove these outcomes at approximately 1440 px and 900 px widths:

1. Recent Activity rows expose the same ordered fields and each field's left edge stays within a small tolerance across representative rows.
2. Long request paths and endpoint names have bounded rendered widths, have `scrollWidth > clientWidth` when truncated, and never overlap the next field.
3. Operations table columns remain within table bounds; the endpoint column neither collapses nor exceeds its allocated share.
4. Endpoint identity remains discoverable in full through an accessible title, tooltip, drawer, or copy action.
5. Sticky filter toolbars remain visible after scrolling the owned results container and do not obscure the first row.
6. Discovery selectors can narrow a large endpoint inventory, show one unambiguous selected primary and optional secondary endpoint, and retain both IDs through Back and Forward.
7. Discovery tabs appear in Schemas, ResourceTypes, ServiceProviderConfig order and retain active-tab URL state.
8. Dashboard endpoint-summary behavior is tested with zero, one, and more-than-one-page endpoint inventories.

Presence-only assertions do not satisfy these checks. Layout claims must use rendered bounds, `clientWidth`, and `scrollWidth`.

## Recommended delivery sequence

1. Fix UI-01 and UI-02 as bounded readability work with RED-first Playwright layout assertions.
2. Design one reusable searchable endpoint selector and one persistent filter-toolbar pattern.
3. Apply those primitives to Discovery first, where the large card grids most directly obstruct the task.
4. Rework Dashboard endpoint summary only after deciding which endpoint signals belong on the overview.
5. Reorder Discovery tabs and strengthen selected-state styling within the same coherent Discovery change.

## Self-improvement dispositions

- **Test/gate:** applied to this backlog. Every visual complaint has an outcome-level browser acceptance check, including measured bounds for the two reported layout problems.
- **Design/architecture:** accepted for intake. No new shared primitive is introduced until at least Discovery plus one additional surface prove the abstraction has two real consumers.
