# Phase L1 - Endpoint CRUD UI + Preset Picker

> **Date:** 2026-05-13 - **Version:** 0.50.0-alpha.1 - **Predecessor:** v0.49.0 stable (Phase K Foundation Hardening complete)
> **Origin:** [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md](UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md) S4.1
> **Scope:** Frontend-first. Adds ONE backend test (E2E key-allowlist contract) + ONE live SCIM section (`9z-AA`); the actual Endpoint CRUD HTTP surface (`POST/PATCH/DELETE /admin/endpoints` + `GET /admin/endpoints/presets`) shipped in v0.30.0 and is already locked at unit + E2E + live layers.

---

## 1. Why this exists

[docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md](UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md) S4.1 marks Endpoint CRUD as the highest-leverage **Tier 1 Operational Completeness** gap. Today an operator cannot:

- Create a new endpoint from the UI - every onboarding requires shell access + a hand-crafted POST body against [endpoint.controller.ts:42](../api/src/modules/endpoint/controllers/endpoint.controller.ts#L42)
- Browse the available presets ([endpoint.controller.ts:66](../api/src/modules/endpoint/controllers/endpoint.controller.ts#L66) ships `entra-id`, `rfc-standard`, `minimal`, `user-only`, plus more) before commit
- Preview what a preset locks in (schemas, settings, `/ServiceProviderConfig`, `/ResourceTypes`) before taking the side-effect of POSTing
- Delete an endpoint with a safety net - Settings tab today has no DELETE control because the only available form factor would be a one-click trap

This single gap defeats the "self-service admin tool" framing of the redesign. L1 closes it.

---

## 2. Architecture

```mermaid
flowchart LR
    subgraph API["API (unchanged - shipped v0.30.0)"]
        POST[POST /admin/endpoints<br/>name + preset OR profile]
        DELETE[DELETE /admin/endpoints/:id<br/>cascade users/groups/logs]
        PATCH[PATCH /admin/endpoints/:id<br/>displayName/description/active/profile]
        PRESETS[GET /admin/endpoints/presets<br/>5+ built-in profiles w/ summary]
        PRESET_DETAIL[GET /admin/endpoints/presets/:name<br/>full profile]
    end

    subgraph FE["Frontend (Phase L1)"]
        QK[queryKeys.presets.all<br/>queryKeys.presets.detail name]
        PO[presetsQueryOptions<br/>presetDetailQueryOptions name]
        UCE[useCreateEndpoint<br/>onSettled: invalidate endpoints.all]
        UDE[useDeleteEndpoint<br/>onSettled: invalidate endpoints.all + remove detail/overview]
        UP[usePresets, usePresetDetail<br/>thin useQuery wrappers]

        WIZ[/endpoints/new<br/>4-step Wizard]
        EDIT[/endpoints/$id/edit<br/>Form]
        DEL[DeleteEndpointDialog<br/>type-name-to-confirm safety]
        DETAIL[EndpointDetailPage header<br/>Edit + Delete buttons]

        QK --> PO --> UP
        UCE --> POST
        UDE --> DELETE
        UP --> PRESETS
        UP --> PRESET_DETAIL
        WIZ -->|Step 1 select preset| UP
        WIZ -->|Step 4 commit| UCE
        EDIT -->|Save| PATCH
        DETAIL --> DEL
        DEL --> UDE
    end

    style API fill:#e0f0ff,stroke:#369
    style FE fill:#e0ffe0,stroke:#393
```

### 2.1 Wizard step layout

| Step | Title | Inputs | Validation | Outbound |
|------|-------|--------|------------|----------|
| 1 | Identity & Preset | `name` (required, `[a-zA-Z0-9_-]+`), `displayName` (optional), `description` (optional), preset Combobox (required, sourced from `usePresets`) | Disable Next until name is non-empty + preset is picked | none |
| 2 | Preview | Read-only display of `usePresetDetail(picked)`: schemas list (count + names), settings table (every flag w/ default value), `serviceProviderConfig` summary (bulk / sort / etag / patch booleans), resourceTypes list | none (informational) | none |
| 3 | Override (optional) | Reuses the SettingsTab `BOOLEAN_FLAGS` Switch grid seeded from preset defaults; operator may flip any flag before commit | none | none |
| 4 | Confirm | Read-only summary of all 4 steps + Create button | none | `POST /admin/endpoints { name, displayName?, description?, profilePreset, profile?: { settings: { ...overrides } } }` |

On success: navigate to `/endpoints/$newId` with a transient success toast ("Endpoint <name> created").

### 2.2 Delete safety modal

Reuse [FormDialog](../web/src/components/primitives/FormDialog.tsx) primitive. Modal opens from the EndpointDetail header **Delete** button. Body contains:

- Warning MessageBar: "This deletes the endpoint, all SCIM users + groups under it, all per-endpoint credentials, and all RequestLog rows. This cannot be undone."
- Echo of the endpoint name in monospace
- Single `<Input>` labeled "Type the endpoint name to confirm"
- `Delete` button is disabled until the input value matches the endpoint name **case-sensitively** (one character drift = abort; mirrors GitHub's repo-delete UX)

On submit fires `useDeleteEndpoint` mutation. On success navigates to `/endpoints` with a transient toast. On error shows `<ScimErrorMessage>` (Phase K3 primitive) inside the dialog.

### 2.3 Files added / changed

| File | Change | LoC |
|------|--------|-----|
| [web/src/api/queries.ts](../web/src/api/queries.ts) | EXTENDED - `queryKeys.presets`, `presetsQueryOptions`, `presetDetailQueryOptions`, `usePresets`, `usePresetDetail`, `useCreateEndpoint`, `useDeleteEndpoint` | ~120 |
| [web/src/api/queries.test.ts](../web/src/api/queries.test.ts) | EXTENDED - 7 new tests covering both mutation hooks + presets queries (RED first) | ~140 |
| [web/src/pages/CreateEndpointWizard.tsx](../web/src/pages/CreateEndpointWizard.tsx) | NEW - 4-step Wizard + presets preview | ~280 |
| [web/src/pages/CreateEndpointWizard.test.tsx](../web/src/pages/CreateEndpointWizard.test.tsx) | NEW - 8 tests covering happy path + every step's gate logic | ~210 |
| [web/src/pages/EditEndpointPage.tsx](../web/src/pages/EditEndpointPage.tsx) | NEW - simple form for displayName/description/active | ~95 |
| [web/src/pages/EditEndpointPage.test.tsx](../web/src/pages/EditEndpointPage.test.tsx) | NEW - 3 tests covering load + save | ~80 |
| [web/src/components/endpoint/DeleteEndpointDialog.tsx](../web/src/components/endpoint/DeleteEndpointDialog.tsx) | NEW - type-name-to-confirm modal | ~110 |
| [web/src/components/endpoint/DeleteEndpointDialog.test.tsx](../web/src/components/endpoint/DeleteEndpointDialog.test.tsx) | NEW - 4 tests covering disabled-by-default + match enables + mismatch keeps disabled + submit fires mutation | ~110 |
| [web/src/pages/EndpointDetailPage.tsx](../web/src/pages/EndpointDetailPage.tsx) | EXTENDED - Edit + Delete buttons in header, opens DeleteEndpointDialog | +35 |
| [web/src/pages/EndpointsPage.tsx](../web/src/pages/EndpointsPage.tsx) | EXTENDED - Header gains a `+ Create endpoint` button linking to `/endpoints/new` | +15 |
| [web/src/routes/endpoints.new.tsx](../web/src/routes/endpoints.new.tsx) | NEW - TanStack route registration with presets loader | ~25 |
| [web/src/routes/endpoints.$endpointId.edit.tsx](../web/src/routes/endpoints.$endpointId.edit.tsx) | NEW - TanStack route registration | ~25 |
| [api/test/e2e/admin-endpoints-create.e2e-spec.ts](../api/test/e2e/admin-endpoints-create.e2e-spec.ts) | NEW - response-key allowlist contract for `POST /admin/endpoints` (locks the surface UI consumes) + duplicate-name rejection contract | ~95 |
| [scripts/live-test.ps1](../scripts/live-test.ps1) | EXTENDED - new SECTION `9z-AA` Endpoint CRUD wizard contract: list presets, create with preset, create with override, duplicate name -> 400, full PATCH then DELETE round-trip | ~120 |

### 2.4 Mutation lifecycle (post-L1)

```mermaid
sequenceDiagram
    participant U as Operator
    participant W as CreateEndpointWizard
    participant H as useCreateEndpoint
    participant API as POST /admin/endpoints
    participant QC as TanStack Query cache
    participant R as Router

    U->>W: Step 4 - click Create
    W->>H: mutateAsync({ name, profilePreset, profile? })
    H->>API: POST + JSON body
    alt happy path
        API-->>H: 201 EndpointResponse
        H->>QC: invalidate queryKeys.endpoints.all
        H-->>W: resolved with new EndpointResponse
        W->>R: navigate to /endpoints/{newId}
        W->>U: success toast (Endpoint X created)
    else 400 duplicate name
        API-->>H: 400 BadRequest (uniqueness)
        H-->>W: ScimApiError(400)
        W->>U: <ScimErrorMessage> in Step 4 panel; user goes back to Step 1
    end
```

---

## 3. Definition of Done (per-sub-phase quality gate)

| # | Gate | Status |
|---|------|:------:|
| 1 | TDD RED state confirmed for new mutation hooks | [ ] |
| 2 | TDD GREEN state - new mutation hook tests all pass | [ ] |
| 3 | TDD RED state confirmed for wizard + delete dialog UI | [ ] |
| 4 | TDD GREEN state - wizard + delete dialog tests all pass | [ ] |
| 5 | apiContractVerification - new E2E key-allowlist test passes | [ ] |
| 6 | error-handling-verification - 400 duplicate name -> ScimApiError -> ScimErrorMessage chain locked | [ ] |
| 7 | logging-verification - admin-create / admin-delete audit-trail rows verified by section 9z-I (regression check) | [ ] |
| 8 | auditAgainstRFC - delete-cascade behavior matches RFC 7644 S4 (no orphan resources after parent endpoint deletion) | [ ] |
| 9 | securityAudit - DELETE requires admin token (already locked at controller layer); plaintext credential never returned in any L1 response (audited via existing 9z-V hash sweep) | [ ] |
| 10 | performanceBenchmark - bundle still under all 16 size-limit budgets | [ ] |
| 11 | auditAndUpdateDocs - INDEX.md, CHANGELOG.md, Session_starter.md, analysis-doc S4.1 all updated | [ ] |
| 12 | fullValidationPipeline - api unit + e2e + web vitest + size + lockfiles regenerated in node:25-alpine | [ ] |
| 13 | Live SCIM gate on dev: 939+ pass (was 933, +6 from new section 9z-AA) | [ ] |
| 14 | Prod promotion: NOT triggered (standing rule) | [ ] |

---

## 4. Estimated test deltas

| Layer | Pre-L1 | Post-L1 (target) | Delta |
|-------|-------:|-----------------:|------:|
| API unit | 3,720 | 3,720 | 0 |
| API E2E | 1,184 | 1,186 | +2 (new admin-endpoints-create.e2e-spec.ts: key-allowlist + duplicate-name) |
| Web vitest | 590 | 612 | +22 (7 queries + 8 wizard + 3 edit + 4 delete-dialog) |
| Live SCIM | 933 | 939 | +6 (new section 9z-AA) |
| PowerShell contract | 14 | 14 | 0 |
| **Total** | 6,441 | **6,469** | **+28** |

---

## 5. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| L1-R1 | Operator deletes a production endpoint by mistake | Low | Critical | Type-name-to-confirm safety modal (case-sensitive); Delete is the only L1 button that closes a modal-with-input rather than firing on click |
| L1-R2 | Wizard race - operator submits Step 4 twice fast, creates 2 endpoints with collision on second | Low | Medium | Submit button disabled while mutation pending (busy state from useMutation); 2nd POST will hit 400 duplicate-name and ScimErrorMessage explains |
| L1-R3 | Preset preview shows stale data (preset shipped in a new image while wizard was open) | Very low | Low | `usePresetDetail` has `staleTime: 5 minutes`; Wizard re-fetches on open; risk only materializes if operator keeps wizard open across deploy |
| L1-R4 | Backend duplicate-name semantics drift from 400 to 409 in a future release | Low | Low | E2E spec asserts `[400, 409].includes(status)` not exact 400, so future RFC-aligned tightening doesn't red-fail |
| L1-R5 | Bundle size regression from new wizard primitives | Medium | Low | size-limit gate (Phase H6); main entry must stay under 200 KB gzipped |

---

## 6. Out of scope

- **Inline profile editor** - L1 ships preset+settings overrides only. Editing the full schema list / resourceTypes inline is deferred to Phase O4 (WASM profile editor).
- **Move endpoint between presets after creation** - L1 only allows preset selection at create time (mirrors backend, where the chosen preset is materialized at create and not stored as a "preset reference").
- **Bulk endpoint operations** (clone, export, etc.) - deferred to Phase L6 (Operations cross-endpoint view).

---

## 7. Per-step quality gate sequence (chronological)

1. Create this doc with DoD checklist (this file)
2. Discover backend contract (DONE - see [endpoint.controller.ts](../api/src/modules/endpoint/controllers/endpoint.controller.ts), [create-endpoint.dto.ts](../api/src/modules/endpoint/dto/create-endpoint.dto.ts))
3. RED: write failing tests for `useCreateEndpoint`, `useDeleteEndpoint`, `usePresets`, `usePresetDetail` in [queries.test.ts](../web/src/api/queries.test.ts)
4. GREEN: implement the four hooks + types + queryKeys
5. RED: write failing tests for `<DeleteEndpointDialog />` (type-name-to-confirm + button gate)
6. GREEN: implement the dialog
7. RED: write failing tests for `<CreateEndpointWizard />` (4 steps + Next gates + Step 4 commit)
8. GREEN: implement the wizard + new route + EditEndpointPage
9. Wire EndpointDetailPage header (Edit + Delete buttons + dialog mount)
10. Wire EndpointsPage header (`+ Create endpoint` button)
11. Add new E2E spec [admin-endpoints-create.e2e-spec.ts](../api/test/e2e/admin-endpoints-create.e2e-spec.ts) (key-allowlist + duplicate-name)
12. Add new live section `9z-AA` to [scripts/live-test.ps1](../scripts/live-test.ps1)
13. Bundle check: `vite build && size-limit` - all 16 budgets green
14. Update [docs/INDEX.md](INDEX.md) + [CHANGELOG.md](../CHANGELOG.md) + [Session_starter.md](../Session_starter.md) + close S4.1 in [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md](UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md)
15. Bump versions lockstep `0.49.0` -> `0.50.0-alpha.1` in `api/package.json` + `web/package.json`
16. Regenerate lockfiles in `node:25-alpine` Docker
17. Commit + push (no em-dashes anywhere)
18. Trigger publish workflow `gh workflow run 233403154 --ref feat/ui -f version=0.50.0-alpha.1`
19. Deploy to dev via [scripts/deploy-dev.ps1](../scripts/deploy-dev.ps1)
20. **Live SCIM gate: 939+ pass on dev** (gate 13 of 14 in this DoD)
21. Mark DoD complete; PROD promotion NOT triggered per standing rule
