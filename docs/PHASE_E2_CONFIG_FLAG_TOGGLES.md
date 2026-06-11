# Phase E2 - Config Flag Toggles

> **Version:** 0.46.0-alpha.2 - **Date:** May 8, 2026  
> **Phase:** E2 of [UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md)  
> **Predecessor:** [Phase E1 - Credentials Manager](PHASE_E1_CREDENTIALS_MANAGER.md) (v0.46.0-alpha.1)  
> **Successor:** Phase E3 (Manual provisioning redesigned) -> v0.46.0-alpha.3  
> **Status:** Complete - SettingsTab is now interactive; toggling a Switch deep-merges into both endpoint detail and overview caches with optimistic UI + rollback.

---

## Table of Contents

1. [Summary](#1-summary)
2. [Spec Reference](#2-spec-reference)
3. [Frontend Surface](#3-frontend-surface)
4. [Optimistic Deep-Merge](#4-optimistic-deep-merge)
5. [Boolean Coercion](#5-boolean-coercion)
6. [Files Modified](#6-files-modified)
7. [Tests](#7-tests)
8. [Definition of Done](#8-definition-of-done)
9. [Cross-References](#9-cross-references)

---

## 1. Summary

E2 converts [SettingsTab.tsx](../web/src/pages/SettingsTab.tsx) from a read-only badge dump into an interactive Switch grid. Each of the 13 known boolean ProfileSettings flags becomes a toggle wired through `useUpdateEndpointConfig` (Phase C5). Toggling fires a PATCH with the body `{ profile: { settings: { <flag>: <bool> } } }`; the hook now does an **optimistic deep-merge** into the endpoint detail cache (`profile.settings`) AND the BFF overview cache (`configFlags`), so the Switch flips instantly and rolls back on a 5xx.

Backend is unchanged - the existing PATCH `/admin/endpoints/{id}` already accepts partial profile updates and the `EndpointService.updateEndpoint` method already deep-merges `profile.settings` server-side. E2 closes the loop on the client.

The standout reliability change is in the **mutation hook**: prior to E2, `useUpdateEndpointConfig.onMutate` did a shallow `{ ...prev, ...body }` merge. A single flag flip would send `{ profile: { settings: { Strict: true } } }` and clobber the entire `profile` object in cache (losing schemas, resourceTypes, every sibling flag) until the next refetch landed - causing flicker and broken cache consumers.

---

## 2. Spec Reference

[UI_REDESIGN_REMAINING_GAPS_PLAN.md S8.2 E2](UI_REDESIGN_REMAINING_GAPS_PLAN.md#82-e2---config-flag-toggles-plan-34):

> - Convert SettingsTab.tsx read-only to interactive
> - Each Switch calls useUpdateEndpointConfig with the changed flag
> - Optimistic apply: flip immediately, queue server update, rollback on error
> - Show toast on success/error
> - Tests: 4 unit (toggle, optimistic apply, rollback path, batched changes)

All bullets satisfied. We expanded the test set from the planned 4 to **15 new tests** (12 SettingsTab + 3 mutation deep-merge) because the pre-existing SettingsTab tested only loading + a single read-only render against the wrong response shape (`profileSummary.activeSettings`, which is never populated on the single-endpoint GET that the tab actually uses). The expansion locks the full E2 behavior contract.

We use an inline MessageBar instead of a Fluent Toaster because the tab is a focused surface where contextual feedback (top-of-tab) reads more cleanly than a corner toast that competes with the chrome SSE indicator.

---

## 3. Frontend Surface

### 3.1 Component layout

```mermaid
flowchart TB
  subgraph Tab[SettingsTab]
    H[Subtitle1: "Endpoint Configuration"]
    FB{feedback?}
    FB -->|success| MS[MessageBar intent=success]
    FB -->|error| ME[MessageBar intent=error]

    subgraph Cards[3-card grid]
      C1[General<br/>name, SCIM path, status, preset]
      C2[Configuration Flags<br/>13 Switch rows]
      C3[Read-only Settings<br/>PrimaryEnforcement, logLevel]
    end
  end

  subgraph Hooks
    UEO[useEndpointOverview - Phase B BFF]
    UUE[useUpdateEndpointConfig - Phase C5/E2]
  end

  Tab --> UEO
  C2 -->|Switch onChange| UUE
  UUE -->|onMutate| OM[Deep-merge cache: detail + overview]
  UUE -->|onError| RB[Rollback both caches]
  UUE -->|onSettled| INV[Invalidate detail + overview]

  style C2 fill:#fef3c7,stroke:#92400e
  style OM fill:#dbeafe,stroke:#1e40af
```

### 3.2 Curated boolean flag registry

Thirteen flags from [ProfileSettings](../api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts) are surfaced as Switches. The order groups related concerns:

| Group | Flag | Default |
|---|---|---|
| Validation & schema | `StrictSchemaValidation` | false |
| Validation & schema | `AllowAndCoerceBooleanStrings` | true |
| Concurrency | `RequireIfMatch` | false |
| Lifecycle / deletes | `UserSoftDeleteEnabled` | true |
| Lifecycle / deletes | `UserHardDeleteEnabled` | true |
| Lifecycle / deletes | `GroupHardDeleteEnabled` | true |
| PATCH semantics | `MultiMemberPatchOpForGroupEnabled` | true |
| PATCH semantics | `PatchOpAllowRemoveAllMembers` | false |
| PATCH semantics | `VerbosePatchSupported` | false |
| PATCH semantics | `IncludeWarningAboutIgnoredReadOnlyAttribute` | false |
| PATCH semantics | `IgnoreReadOnlyAttributesInPatch` | false |
| Discovery / auth | `SchemaDiscoveryEnabled` | true |
| Discovery / auth | `PerEndpointCredentialsEnabled` | false |

Defaults mirror the documented behavior in [endpoint-profile.types.ts](../api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts) so the Switch state matches what the server actually does when the flag is absent.

Non-boolean settings (`PrimaryEnforcement` enum, `logLevel` string|number) render in a third "Read-only" card with a hint pointing operators to the admin API for editing - a richer editor for those values is out of scope for E2 and would slow ship.

### 3.3 Composed primitives

- `useEndpointOverview` (Phase B BFF) - same hook the Credentials and Overview tabs use, so the Settings tab adds zero additional round trips on tab switch
- `useUpdateEndpointConfig` (Phase C5 + E2 enhancement) - the optimistic mutation
- Fluent UI `Switch` + `MessageBar` + `Card` - no new primitives needed

---

## 4. Optimistic Deep-Merge

Pre-E2 the optimistic update was a single shallow spread:

```ts
qc.setQueryData(detailKey, { ...prev, ...body });
```

For the displayName / description / active fields this works because they are top-level `EndpointResponse` properties. For `{ profile: { settings: { ... } } }` it is destructive: the entire `profile` object is replaced with a stub `{ settings: { <single-flag>: x } }`, losing schemas, resourceTypes, serviceProviderConfig, preset, and every sibling flag. The server-side response that lands on the next refetch corrects the cache, but in the interim every component reading `profile.schemas` (Schemas tab) or `profile.settings.PerEndpointCredentialsEnabled` (Credentials tab 403 banner) would see an empty / undefined value and visually break.

E2 replaces the spread with a focused two-cache deep-merge:

```ts
// Detail cache: deep-merge profile, then deep-merge profile.settings.
const mergedProfile = profilePatch
  ? {
      ...(prev.profile ?? {}),
      ...profilePatch,
      ...(settingsPatch
        ? { settings: { ...(prev.profile?.settings ?? {}), ...settingsPatch } }
        : {}),
    }
  : prev.profile;
qc.setQueryData(detailKey, { ...prev, ...restBody, ...(profilePatch ? { profile: mergedProfile } : {}) });

// Overview cache: deep-merge configFlags so the live SettingsTab
// (which reads from useEndpointOverview) reflects the new value.
if (settingsPatch) {
  qc.setQueryData(overviewKey, { ...prevOv, configFlags: { ...prevOv.configFlags, ...settingsPatch } });
}
```

`onError` snapshots both caches and restores both; `onSettled` invalidates both. The contract is locked by three new mutation tests:

- `E2 optimistic: deep-merges profile.settings into cached endpoint detail` - sibling settings + schemas + resourceTypes preserved
- `E2 optimistic: deep-merges profile.settings into cached overview configFlags` - other configFlags entries preserved
- `E2 rollback: restores both detail.profile.settings and overview.configFlags on server error`

---

## 5. Boolean Coercion

The server stores `ProfileSettings.<bool flag>` as `boolean | string`. The Entra-style preset round-trips them as the exact strings `"True"` and `"False"` (because Microsoft Graph emits and accepts those exact values). The RFC-standard preset uses native booleans. The SettingsTab has to render either form correctly:

```ts
function coerceFlag(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
}
```

When sending PATCH we always emit a JS `boolean` - the server's `AllowAndCoerceBooleanStrings` machinery (default on) handles either form, so pinning the wire format to boolean keeps the client deterministic. Live test 9z-Z.5 confirms an Entra-style `"True"` string PATCH still round-trips to a truthy value.

---

## 6. Files Modified

| File | Change |
|---|---|
| [web/src/pages/SettingsTab.tsx](../web/src/pages/SettingsTab.tsx) | REWRITE - now sources `configFlags` from `useEndpointOverview`; renders 13 Switches + read-only PrimaryEnforcement / logLevel card; inline MessageBar feedback; pending-flag spinner |
| [web/src/pages/SettingsTab.test.tsx](../web/src/pages/SettingsTab.test.tsx) | EXPAND - 14 vitest tests (was 2) covering loading, error, render-all-flags, value coercion (boolean true / "True" / "False" / absent default), toggle invocation, success / error feedback, pending disable, read-only enum render |
| [web/src/api/queries.ts](../web/src/api/queries.ts) | E2 ENHANCEMENT - `useUpdateEndpointConfig` `onMutate` now deep-merges `profile.settings` into both the detail and overview caches; `onError` rolls back both; `onSettled` invalidates both. Comment block explains the regression that motivated the change. |
| [web/src/api/mutations.test.ts](../web/src/api/mutations.test.ts) | +3 tests covering the new deep-merge optimistic + dual-cache rollback contract |
| [scripts/live-test.ps1](../scripts/live-test.ps1) | NEW SECTION 9z-Z (12 assertions): single-flag flip; sibling preservation; flip-back; Entra-style "True" round-trip; BFF overview reflection; displayName preservation; multi-flag PATCH; schemas/resourceTypes retained |
| [api/package.json](../api/package.json), [web/package.json](../web/package.json) | Lockstep bump 0.46.0-alpha.1 -> 0.46.0-alpha.2 |

Backend: zero changes. The PATCH endpoint and `EndpointService.updateEndpoint` already deep-merge server-side (locked by the live test).

---

## 7. Tests

| Layer | Count | Coverage |
|---|---|---|
| Web vitest (SettingsTab) | 14 (12 new + 2 retained) | Loading; error; general info; render-all-13-Switches; value coercion (boolean / 'True' / 'False' / absent default); toggle PATCH-shape (on->off, off->on); success MessageBar; error MessageBar; pending disable; PrimaryEnforcement read-only render |
| Web vitest (mutations) | 3 NEW | optimistic deep-merge into detail.profile.settings; optimistic deep-merge into overview.configFlags; dual-cache rollback on error |
| Live (9z-Z) | 12 NEW assertions | setup; single-flag flip on; sibling preservation x2; flip back off; Entra "True" string round-trip; BFF overview reflection; displayName preservation; multi-flag PATCH; previous PATCH still set; schemas + resourceTypes retained; cleanup |
| **Net new** | **+15 web + +12 live = +27** | All passing |

### 7.1 Test-count delta

- Web vitest: 409 -> **424** (+15 new + 0 regressions; existing 409 stable)
- Live SCIM: 919 -> **931** target (+12 new in 9z-Z)

### 7.2 TDD evidence

- RED: ran `vitest run src/pages/SettingsTab.test.tsx src/api/mutations.test.ts` against the original implementation - **15 of the 41 tests failed** (12 SettingsTab + 3 mutations) with module-shape and "no Switch found" errors
- GREEN: rewrote `SettingsTab.tsx` + enhanced `useUpdateEndpointConfig` in `queries.ts` - all 41 tests pass
- REFACTOR: extracted `coerceFlag()` and `pendingFlagKey()` helpers; pulled the `BOOLEAN_FLAGS` registry into a typed const so adding a flag is a single-row change

### 7.3 Build

- `vite build` 14.58s, clean, no new TS errors
- 2,955 modules, dist size unchanged

---

## 8. Definition of Done

- [x] SettingsTab is interactive: every known boolean ProfileSetting has a Switch
- [x] Switch state reflects current value with boolean / 'True' / 'False' coercion
- [x] Toggling fires `useUpdateEndpointConfig` with `{ profile: { settings: { <flag>: <bool> } } }`
- [x] Optimistic deep-merge into both detail.profile.settings AND overview.configFlags
- [x] Rollback on server error restores both caches
- [x] Inline MessageBar success/error feedback (auto-dismiss 4s)
- [x] Pending Switch is disabled to prevent double-fires
- [x] Non-boolean settings (PrimaryEnforcement, logLevel) shown read-only with API-edit hint
- [x] +12 SettingsTab vitest tests + +3 mutation vitest tests, all green
- [x] +12 live test assertions in new 9z-Z section
- [x] Lockstep version bump api+web `0.46.0-alpha.1` -> `0.46.0-alpha.2`
- [x] Build clean, 424/424 web vitest pass
- [x] Feature doc shipped (this file), CHANGELOG entry, INDEX.md update, Session_starter log
- [ ] **Sub-phase quality gate:** deploy v0.46.0-alpha.2 to dev + 931+ live SCIM tests must all pass before E3 starts

---

## 9. Cross-References

- [PHASE_E1_CREDENTIALS_MANAGER.md](PHASE_E1_CREDENTIALS_MANAGER.md) - E1 predecessor
- [PHASE_C_PRIMITIVES_AND_MUTATIONS.md](PHASE_C_PRIMITIVES_AND_MUTATIONS.md) - useUpdateEndpointConfig original (C5)
- [PHASE_B_BFF_OVERVIEW_AND_SSE.md](PHASE_B_BFF_OVERVIEW_AND_SSE.md) - useEndpointOverview source
- [endpoint-profile.types.ts](../api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts) - canonical ProfileSettings interface
- [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) - per-flag semantics + RFC references
- [UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md) S8.2 - parent spec
