# Profile-Authoritative Resource UI Execution Issues and RCA

> **Status:** In consolidation - **Last verified:** 2026-09-23 - **Product version:** `0.55.28`

## Dashboard

| ID | Type | Severity | Symptom | Root cause | Prevention |
|---|---|---:|---|---|---|
| PAUI-1 | UI contract | High | Request body was copy-only and could not drive the generated form. | Form values were the sole state owner and the JSON block was a read-only projection. | One shared bidirectional body editor plus component and browser outcome tests. |
| PAUI-2 | Fixture correctness | Medium | Device platform rendered as a dropdown although the intended attribute was unconstrained. | The fixture itself published a canonical values list. | Fixture self-test asserts the list is absent; browser asserts a text input and no combobox. |
| PAUI-3 | Cache correctness | High | Runtime ResourceType changes could leave discovery and custom lists stale for five minutes. | Endpoint invalidation covered detail/overview but not all profile-derived queries. | Mutation and SSE tests require Schemas, discovery, and custom-resource prefix invalidation. |
| PAUI-4 | Navigation | Medium | A removed selected ResourceType could leave its stale route mounted. | Tab visibility and route validity were evaluated independently. | Layout redirects removed resource routes to Resource types; browser removes Device and deep-links the stale URL. |
| PAUI-5 | Discovery UX | Medium | Endpoint detail had no Service Provider Config tab. | SPC existed only in the global comparison-oriented Discovery page. | Endpoint route and component tests cover capabilities, limits, schemes, raw JSON, click, and deep-link. |
| PAUI-6 | Test correctness | Low | `toHaveValue(stringContaining(...))` failed on a correct textarea value. | The DOM matcher expects a concrete value. | Read `inputValue` or the element value before substring assertions. |
| PAUI-7 | Browser harness | Low | Cross-client removal did not refresh against an older reused local API. | The test depended on an SSE producer outside the exact branch under test. | Exercise the branch-owned Resource Types mutation, then verify stale-route fallback; cross-tab SSE remains a deployment check. |
| PAUI-8 | Cache correctness | High | Profile updates invalidated custom lists but could leave User and Group lists stale. | The first invalidation set treated built-in and generic resource caches separately. | Mutation and SSE tests require User, Group, and custom prefixes together. |
| PAUI-9 | Form correctness | Medium | A profile-aware edit drawer could Save with an empty required field or invalid structured value. | The drawer did not consume `ProfileResourceForm` validity. | Drawer regression test clears required userName and requires Save disabled. |

## Self-Improvement Dispositions

- **Test/gate:** Applied. Body/form synchronization, empty canonical values, complete User/Group/custom profile invalidation, edit validity, SPC content, AIAgent controls, and removal fallback now have focused tests.
- **Design/architecture:** Applied. JSON and controls share one state boundary; no second form engine or SPC data model was introduced.
- **Security:** Accepted. The editor changes request composition only; stored Authorization remains protected by the shared request sanitizer.
- **Performance:** Accepted. Existing five-minute discovery caches remain, with precise invalidation on profile mutation instead of polling.

## Provenance

Issues were recorded when their RED checks or browser failures were observed. The final ledger is reconciled during consolidation against the unit-1 session interval before merge.