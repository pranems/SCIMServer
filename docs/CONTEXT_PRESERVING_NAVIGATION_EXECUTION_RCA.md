# Context-preserving navigation execution issues and RCA

> **Status:** Reconciled - **Last verified:** 2026-09-24 - **Product version:** `0.55.31`

## Issue dashboard

| ID | Type | Severity | Symptom | Root cause | Resolution | Detection stage | Earliest possible stage |
|---|---|---:|---|---|---|---|---|
| BN-01 | Test correctness | Medium | Playwright could not click the endpoint Edit button while the user drawer was open. | The drawer is a modal overlay and correctly intercepts pointer events over the page behind it. | Inspected the failure screenshot and dispatched the real Edit button click handler without pointer hit-testing, preserving the intended SPA transition and drawer URL history. | Focused Playwright | Browser RED |
| BN-02 | Test harness | Medium | Cancel returned to endpoint overview instead of the compound Users URL after the test used `page.goto()` to enter Edit. | A full document navigation starts a fresh TanStack router history index, so `useCanGoBack()` correctly chose the direct-link fallback. | Triggered the real SPA Edit handler so the compound Users URL remained the preceding router entry. | Focused Playwright | Router-aware component test |
| BN-03 | Runtime routing | Medium | A direct Discovery URL with `compare=true` rendered the route error boundary. | TanStack parsed the search value to boolean `true` before Zod, while the new schema accepted only string literals. | Added an explicit union accepting booleans and `"true"`/`"false"`; avoided truthy coercion; added unit and browser locks. | Focused Playwright screenshot | Search-schema unit with boolean input |
| BN-04 | Test correctness | Low | Operations Back restored all state but the exact-URL assertion failed because `userPage=1` appeared. | The typed route canonicalized both independent page defaults into the URL. | Asserted the canonical shareable URL emitted by the router. | Focused Playwright | Route normalization unit test |
| BN-05 | Test harness | Medium | 107 existing page tests failed after components began reading `useSearch()`. | The suites mocked `useNavigate()` but mounted route-aware pages without a RouterProvider or search store. | Upgraded each router mock to a small stateful URL store; existing click tests now exercise search updates instead of bypassing them. | Focused Vitest | First route-aware page test |
| BN-06 | Tooling friction | Low | A read-only PowerShell source audit entered continuation mode. | Nested quote characters made the ad hoc regex string shell-unsafe. | Terminated the command and used workspace search tools instead. | Source audit | Use workspace search directly |
| BN-07 | Type correctness | Medium | Full web typecheck reported five diagnostics in touched files after URL-state wiring. | Optional search values were not explicitly narrowed; a Griffel shorthand was unsupported; the diff adapter relied on structural compatibility that its index signature prevented; one matcher overload was invalid. | Narrowed the optional Connect method, used a supported border declaration, projected discovery attributes to plain diff objects, and separated role/name assertions. Touched-file diagnostics are now zero. | Static gate | Focused touched-file typecheck after each URL-state edit |
| BN-08 | Repository hygiene | Low | Full coverage marked the visual snapshot file modified although no visual baseline was intentionally changed. | Line-ending/stat metadata changed while file content remained identical. | Compared Git blob hashes; worktree and index are byte-identical, so the snapshot is excluded from the commit. | Diff review | Staged snapshot hash check |

## Prevention

- Browser tests must respect modal locality; never force a pointer click through an overlay.
- Test SPA history with SPA navigation, not full document navigation.
- Search schemas must accept the value types the router actually supplies, with negative controls for boolean strings.
- Route-aware unit tests need a RouterProvider or a stateful search mock.
- Exact URL assertions must target the router's canonical serialization.
- Touched-file diagnostics must be zero even when the repository carries a known broader baseline.
- A visual snapshot marker must be classified by blob hash or inspected diff before staging.

## Design and architecture disposition

Applied: one shared Back primitive and hook serve two real consumers, while URL state follows the existing typed-schema pattern. This removes duplicated return logic without introducing a navigation policy framework.

## Self-improvement disposition

Applied: component and browser tests now assert restored values and visible drawer/subtab outcomes, not only URL presence.

## Provenance and completeness

Reconciled against the full uncompacted session transcript from Unit 4A start through consolidation. The scan covered browser FAILs, screenshots, router/schema errors, continuation-mode tooling, typecheck diagnostics, and canonical-URL mismatches. Search echoes and deliberate RED failures were discarded. Verified non-issues: the visual snapshot blob is byte-identical; the full typecheck still exits on documented pre-existing test errors but reports zero touched-file diagnostics; API behavior is unchanged and the complete live gate remains 1,516/1,516.
