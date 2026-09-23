# Profile-Driven Resource Forms Execution Issues and RCA

> **Status:** Consolidated and extended - **Last verified:** 2026-09-23 - **Product version:** `0.55.27`

## Dashboard

| ID | Type | Severity | Symptom | Detection | Resolution |
|---|---|---:|---|---|---|
| RF-1 | Test correctness | Medium | Dialog typing retained only the first character in one composed test. | Focused component test | Locked realistic typing at `EditableField`; kept dialog payload test focused on controlled submission. |
| RF-2 | Test harness | Low | Combined tests could not replace a getter-only `navigator.clipboard`. | Focused combined Vitest run | Replaced assignment with configurable `defineProperty`. |
| RF-3 | Environment drift | Medium | Fresh worktree API exited because generated Prisma client was absent. | Local browser setup | Reused the generated client artifact and rebuilt; no dependency resolution. |
| RF-4 | Environment drift | Medium | Browser fixture received 502 and later a route error boundary with `Failed to fetch`. | Playwright plus screenshot | Aligned Vite with its checked-in port-3000 proxy and removed the stale cross-origin `VITE_API_BASE`. |
| RF-5 | Environment drift | Medium | Local auth rejected both documented test tokens. | API startup log | Set explicit SCIM and OAuth test secrets; defaults had auto-generated ephemeral values. |
| RF-6 | API correctness | High | Every custom-resource edit opened a false conflict dialog. | Playwright outcome assertion plus screenshot | Generic responses now emit `W/"vN"`, matching `enforceIfMatch()`. |
| RF-7 | Cache correctness | Medium | A cross-tab custom-resource list stayed stale after an SSE resource event. | Change-scoped consolidation audit | Resource events invalidate the endpoint-wide generic resource query prefix. |
| RF-8 | UI correctness | Medium | A custom extension column displayed `-` although the value existed under its URN block. | Change-scoped consolidation audit | Generic list cells resolve values with the shared extension-aware accessor. |
| RF-9 | Profile correctness | High | Registering the first custom type could persist only that type and remove implicit User/Group. | Final code review | First registration starts from the effective fail-open inventory. |
| RF-10 | HTTP contract | High | A successful custom-resource DELETE returned 204, then the client rejected while parsing empty JSON. | Final code review | `fetchWithAuth()` returns `undefined` for 204 without invoking `json()`. |
| RF-11 | UI state ownership | Medium | Endpoint selection read the prior endpoint's ResourceType data inside the click handler. | Final code review | Selection clears on endpoint change and is derived only from the new discovery result. |
| RF-12 | Tooling friction | Low | Mermaid doctor reported built-in renderer version `0.0.0` and suggested an invalid downgrade. | Documentation gate | Kept pinned 11.15.0; 708 diagrams rendered in Chromium in both themes. |

## Issue Details

### RF-1 - Controlled Input Composition

- **Symptom:** A character-by-character dialog test submitted `serialNumber: "S"` instead of `"SN-200"`.
- **Root cause:** The composed dialog test held a stale input reference across validity-driven rerenders. The owning `EditableField` retained full browser-like typing correctly when tested directly.
- **Fix:** Added a character-by-character regression test at `EditableField`. The dialog test now uses one controlled change event and remains responsible for payload assembly and submission.
- **Why it works:** Interaction semantics are locked at the component that owns input history, while the dialog test no longer duplicates that responsibility.
- **Prevention:** Keep primitive behavior tests at the primitive boundary and browser typing in Playwright.
- **Escape analysis:** Detected in focused component validation. Earliest possible gate was the same focused test. Escape delta: 0.

### RF-2 - Clipboard Mock Order Dependence

- **Symptom:** `Object.assign(navigator, { clipboard: ... })` failed when another suite had installed a getter-only property.
- **Root cause:** The mock assumed a writable browser property and became order-dependent in combined runs.
- **Fix:** Install the mock through `Object.defineProperty(..., configurable: true)`.
- **Why it works:** The property descriptor is replaced deterministically regardless of prior suite order.
- **Prevention:** Browser API mocks that may be getter-backed must use explicit configurable descriptors.
- **Escape analysis:** Detected in focused combined Vitest consolidation. Earliest possible gate was the combined run. Escape delta: 0.

### RF-3 - Generated Prisma Client Missing in a Fresh Worktree

- **Symptom:** `node api/dist/main.js` failed with `Cannot find module '../../generated/prisma/client'`.
- **Root cause:** Source imports a generated Prisma client that is ignored by Git. The linked worktree had dependencies but not the generated artifact.
- **Fix:** Reused the existing generated client from the primary worktree and rebuilt the API.
- **Why it works:** TypeScript emits the same generated client into `dist/generated` without package installation or lockfile mutation.
- **Prevention:** Fresh-worktree local-server setup must verify both `node_modules` and `api/src/generated/prisma/client.ts` before build.
- **Escape analysis:** Detected before Playwright execution. Earliest possible gate was local server startup. Escape delta: 0.

### RF-4 - Split Browser API Paths

- **Symptom:** Fixture setup first returned 502; after the API started, the route rendered `Something went wrong - Failed to fetch`.
- **Root cause:** Vite proxies same-origin `/scim` calls to port 3000, while a stale `VITE_API_BASE=http://localhost:6000` made `fetchWithAuth` bypass the proxy. Fixture calls and application calls therefore used different transports.
- **Fix:** Started the browser API on port 3000 and restarted Vite without `VITE_API_BASE`.
- **Why it works:** Fixture and application requests now share one same-origin proxy path and one auth/runtime instance.
- **Prevention:** Local Playwright must use the checked-in proxy topology unless the Vite config itself supports an override.
- **Escape analysis:** The 502 was detected at fixture creation; the direct-fetch variant was detected by screenshot at the first UI outcome. Earliest possible gate was browser smoke. Escape delta: 0.

### RF-5 - Ephemeral Local Secrets

- **Symptom:** Fixture endpoint creation and OAuth bootstrap returned `401 Invalid bearer token` / `invalid_client` despite standard fallback values.
- **Root cause:** Development startup auto-generates secrets when the environment variables are absent. The generated values are intentionally not predictable.
- **Fix:** Restarted local APIs with explicit `SCIM_SHARED_SECRET=changeme-scim` and `OAUTH_CLIENT_SECRET=changeme-oauth`.
- **Why it works:** Browser and live harnesses now use credentials that match the running process.
- **Prevention:** Local validation launch commands must always set both secrets explicitly.
- **Escape analysis:** Detected before product assertions in Playwright/live bootstrap. Earliest possible gate was authenticated smoke. Escape delta: 0.

### RF-6 - Generic ETag Could Not Round-Trip

- **Symptom:** Editing `serialNumber` opened the conflict dialog although no concurrent writer existed. The dialog showed pending `SN-200`, server `SN-100`, and ETag `1`.
- **Root cause:** `EndpointScimGenericService.toScimResponse()` emitted `W/"1"`; shared `enforceIfMatch()` compared against `W/"v1"`. The server rejected its own returned validator.
- **Fix:** Generic resources now emit `W/"v${record.version}"`. The existing unit expectation was corrected first and confirmed RED (`W/"v5"` expected, `W/"5"` received), then the mapper changed.
- **Why it works:** Read and write sides now use the same canonical version-based ETag format already used by Users and Groups.
- **Prevention:** The 68-test generic service suite locks the wire format. Live section `9z-CN` creates a Device, replays the returned ETag on PATCH, checks `W/"v2"`, rereads the value, and cleans up.
- **Escape analysis:** Unit tests contained a polluted expected value, so only the browser outcome detected the mismatch. The earliest capable gate was the service unit contract once corrected. Escape delta: Playwright to unit. The missing live assertion was closed in-place.

### RF-7 - Generic SSE Cache Was Not Invalidated

- **Symptom:** The new generic query cache had direct mutation invalidation but no invalidation from `scim.resource.*` SSE events.
- **Root cause:** The pre-existing resource channel updated stats and overview only because no generic list query existed when the mapping was written.
- **Fix:** Added an endpoint-wide `['resources', endpointId]` prefix and emitted it for generic resource events.
- **Why it works:** TanStack Query prefix matching invalidates every custom ResourceType and pagination variant for the affected endpoint.
- **Prevention:** `useSSE.test.ts` asserts the endpoint-wide generic prefix.
- **Escape analysis:** Found by the change-scoped cache audit before PR. Earliest capable gate was the focused unit map. Escape delta: 0.

### RF-8 - Custom Extension Value Read from the Wrong Parent

- **Symptom:** A custom Device extension `location: "Seattle"` rendered as absent in the list.
- **Root cause:** List cells read `resource[field.name]`, which is correct only for core attributes. Extension fields live under `resource[field.schemaUrn]`.
- **Fix:** Reused the shared `valueForField()` accessor already used by the edit drawer.
- **Why it works:** Core and extension reads now follow the same descriptor contract as create and PATCH payload generation.
- **Prevention:** `GenericResourcesTab.test.tsx` renders an extension-backed column from its URN block.
- **Escape analysis:** Found by the change-scoped effective-shape audit before PR. Earliest capable gate was the focused component test. Escape delta: 0.

### RF-9 - First Custom Type Removed Implicit Built-ins

- **Symptom:** On a fail-open profile with no explicit `resourceTypes`, registering Device produced `[Device]` rather than `[User, Group, Device]`.
- **Root cause:** The UI displayed `DEFAULT_BUILTIN_RTS` as the effective inventory but built the persisted merge from the empty raw array.
- **Fix:** Build the first registration from `inventory`, which is raw declarations when present and the two effective built-ins otherwise.
- **Why it works:** Persistence now preserves the same effective resource set the operator saw before adding Device.
- **Prevention:** `ResourceTypesTab.test.tsx` locks the empty-profile transition.
- **Escape analysis:** Found in final code review and reproduced by a RED component test. Earliest capable gate was the Resource Types unit suite. Escape delta: review to unit.

### RF-10 - Successful 204 Parsed as JSON

- **Symptom:** Custom delete could remove the server resource and still surface a client error from an empty response body.
- **Root cause:** The generic controller correctly returns 204, while `fetchWithAuth()` unconditionally called `res.json()` for every successful response.
- **Fix:** Return `undefined` for status 204 before JSON parsing.
- **Why it works:** No Content is represented as no value, while all JSON-bearing success responses retain their existing contract.
- **Prevention:** `queries.test.ts` proves `json()` is not called, and Playwright deletes Device then requires the empty-state outcome.
- **Escape analysis:** Found in final code review before PR. Earliest capable gate was the base fetch unit suite. Escape delta: review to unit/browser.

### RF-11 - Endpoint Switch Reused Prior Selection Input

- **Symptom:** The endpoint selection handler read `resourceTypesQuery.data` from the previous endpoint while changing the query key.
- **Root cause:** Selection ownership was split between the click handler and the discovery-result effect.
- **Fix:** Clear `resourceTypeId` in the handler; the effect selects the first type only from the newly resolved endpoint result.
- **Why it works:** There is one owner for resource-type defaulting and no previous-endpoint data dependency.
- **Prevention:** `ManualProvisionPage.test.tsx` switches Device-only endpoint A to Group-only endpoint B and asserts the new tab/form.
- **Escape analysis:** Found in final code review. The outcome test was already green because React Query did not retain prior data, but the ambiguous ownership was removed before PR.

### RF-12 - Built-in Mermaid Metadata False Warning

- **Symptom:** The doctor read the built-in renderer package version as `0.0.0` and recommended pinning Mermaid to that non-release.
- **Root cause:** Current VS Code built-in extension metadata does not expose the bundled Mermaid version in the shape the doctor expects.
- **Fix:** Did not modify dependencies. Used the authoritative real-browser render gate instead.
- **Why it works:** All 708 source blocks parsed and rendered under strict security in both themes, directly proving content health.
- **Prevention:** Treat `0.0.0` as unresolved metadata, never as an install target; retain render output as the content authority.
- **Escape analysis:** Detected at the documentation gate. Earliest possible gate was the doctor itself. Escape delta: 0.

## Self-Improvement Dispositions

- **Test/gate:** Applied. Added realistic primitive typing, deterministic clipboard setup, outcome-level Playwright, and active live ETag round-trip coverage.
- **Design/architecture:** Accepted. One shared schema-to-form/payload module, one form, one create dialog, one drawer, and one generic API adapter reduce duplication across three real resource classes. Further splitting would be speculative.
- **Security:** No new auth or secret surface. Local secrets are explicit only in process environment and are not written to source.

## Provenance and Completeness

This ledger was captured as issues were resolved and reconciled against the full session transcript using an error/signal pass and a diagnosis-phrase pass. Repeated command output, expected RED failures, and pre-existing TypeScript baseline errors were reviewed and dismissed as non-issues. No issue in this rollback unit remains without a resolution or prevention.
