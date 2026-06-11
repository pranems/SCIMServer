# UI Presentation Backlog - Large-Dataset Scalability

> **Status:** Open | **Raised:** 2026-06-03 | **Priority:** High | **Type:** Dedicated UI task (not part of the doc audit)

## Origin

Surfaced by the operator while capturing documentation screenshots against the customer-facing prod (`scimserver-prod.calmsand-...`), which now holds **real customer/ISV data** (31 endpoints, 2,439 users, 91 groups) and will keep growing. The current UI was designed when datasets were small and does not degrade gracefully at scale.

## Problems Observed

| # | Surface | Problem |
|---|---------|---------|
| 1 | Operations (All Users / All Groups) | No sort, no column filtering on a grid that already shows thousands of rows. |
| 2 | Discovery endpoint grid | No sort/filter/search across the endpoint cards; hard to find a specific endpoint as the count grows. |
| 3 | Dashboard "Endpoints" grid | Same - flat grid, no ordering or search. |
| 4 | Endpoints page | Search exists but ordering/filtering by status, user count, preset, etc. is missing. |
| 5 | Cards (Discovery / Dashboard) | Clicking a card does **not** reliably navigate to the relevant detail view, even though users intuitively expect the whole card to be a click target. |

## Proposed Scope

Audit **every** list / grid / card surface across all pages and tabs (Dashboard, Endpoints, Discovery, Operations, Logs, and the endpoint-detail Users/Groups/Logs tabs) and add, where missing:

- Column sort (ascending/descending) on every data grid.
- Filter + free-text search on every collection.
- Pagination or virtualized scrolling for grids that can exceed a few hundred rows.
- Whole-card click affordance that routes to the correct detail/pre-filtered view, with a visible hover/cursor cue.

Likely a Phase-level UI effort with its own Playwright coverage per the standing "Always Add Playwright Coverage" rule.
