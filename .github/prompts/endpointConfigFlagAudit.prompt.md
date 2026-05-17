---
name: endpointConfigFlagAudit
description: Audit the 14 boolean ProfileSettings flags + logLevel for full architectural completeness - every flag must have registry entry, default, validator, runtime enforcement, tests at every layer, doc reference, and changelog.
argument-hint: Optional - name a single flag (e.g. "RequireIfMatch") to scope to that flag, or omit to sweep all.
---

The SCIM endpoint profile in this codebase has a major architectural element: a closed set of **14 boolean configuration flags + `logLevel`** that gate features per endpoint. Every flag is:

1. **Declared** in the `ProfileSettings` interface at [api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts](../../api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts).
2. **Defaulted** in `DEFAULT_PROFILE_SETTINGS`.
3. **Validated** at the controller / DTO layer (`AllowAndCoerceBooleanStrings`-friendly string-or-boolean inputs).
4. **Enforced** at runtime by a specific service method (e.g. `RequireIfMatch` -> `enforceIfMatch()`).
5. **Tested** at unit + E2E + live levels (the "Schema-Characteristic Test Rule" applies for any flag that affects schema characteristics).
6. **Documented** in [docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md](../../docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md) with semantics + interaction notes.
7. **Surfaced** in the UI Settings tab as a Switch (Phase E2) with optimistic deep-merge mutation.

When a new flag is added (or an existing one modified), MISSING any one of these 7 deliverables is a real bug class. This prompt is the standing check.

---

## Step 1 - List all current flags from the source of truth

```powershell
cd api/src/modules/scim/endpoint-profile
Select-String -Path endpoint-profile.types.ts -Pattern '^\s*\w+\??:\s*(?:boolean|true|false|string).*;' | ForEach-Object {
    $_.Line.Trim()
}
```

Cross-reference against the canonical list in [docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md](../../docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md). Any discrepancy = doc drift.

---

## Step 2 - Build the flag-completeness matrix

For EACH flag, fill this row:

| Column | Source of truth | Pass condition |
|---|---|---|
| **Declared** | `endpoint-profile.types.ts` `ProfileSettings` interface | Type is `boolean \| string` (allows coercion) |
| **Default** | `DEFAULT_PROFILE_SETTINGS` const | Explicit value (no implicit `undefined`) |
| **Validator** | DTO at `api/src/modules/endpoint/dto/update-endpoint.dto.ts` | Validation block accepts both bool + string-bool, rejects garbage |
| **Runtime enforcement** | Specific service method | Behavior changes based on flag value |
| **Unit test** | `*.service.spec.ts` or DTO spec | Flag ON branch + Flag OFF branch + invalid value branch |
| **E2E test** | `test/e2e/*.e2e-spec.ts` | HTTP-level flag exercise |
| **Live test** | `scripts/live-test.ps1` section | Behavior verified end-to-end |
| **Doc** | `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md` row | Has semantics + default + interaction notes |
| **UI** | `web/src/pages/SettingsTab.tsx` `BOOLEAN_FLAGS` registry | Flag appears as Switch in UI |
| **UI test** | `web/src/pages/SettingsTab.test.tsx` | Toggle + optimistic mutation + rollback covered |

The matrix has 14 rows × 10 columns = 140 cells. A single ❌ cell is a real gap.

---

## Step 3 - Audit flag combinations

Flags don't live in isolation. Per `addMissingTests` Step 2B, audit at least these interaction pairs (rules from real precedents):

- `RequireIfMatch + VerbosePatch`
- `RequireIfMatch + SoftDelete` (RFC 7644 §3.14: 404 fires before 428 when resource is soft-deleted)
- `StrictSchema + BooleanStrings` (coerce first, validate second)
- `StrictSchema + IgnoreReadOnly + IncludeWarning` (4-flag combination is a known live-test section, 9z-U)
- `Bulk + RequireIfMatch` (Per-operation 428, NOT request-level)
- `Bulk + StrictSchema` (per-operation validation)
- `MultiMemberPatchOp + PatchOpAllowRemoveAllMembers` (both control group member PATCH)
- `GroupHardDelete + UserSoftDelete` (operate on different resource types but cleanup tests interleave)
- `PerEndpointCredentials + RequireIfMatch` (auth and ETag both at request level)
- `CustomResourceTypes + StrictSchema` (custom types must respect strict mode)

For each PAIR not yet tested, the gap-fix is a new E2E spec OR a new live-test sub-section.

---

## Step 4 - Recently-introduced flags get extra scrutiny

If a flag was added in the LAST 3 commits:
1. Verify it has ALL 10 cells in the matrix (Step 2).
2. Verify it appears in CHANGELOG with semantics.
3. Verify the doc table in [docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md](../../docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md) is sorted alphabetically (so the new entry doesn't sit at the bottom looking like an afterthought).
4. Verify there's an active live-test section (numbered `9z-XX` per convention) that exercises the new flag.

---

## Step 5 - Schema-Characteristic flags (special handling)

A subset of flags affect RFC 7643 attribute characteristics (`uniqueness`, `caseExact`, `mutability`, `returned`, `required`). For those:

- The **Schema-Characteristic Test Rule** from [.github/copilot-instructions.md](../../.github/copilot-instructions.md) applies.
- Use `expectCharacteristicIn()` helper, never `toBe()`.
- For PowerShell live tests, use `Get-EffectiveUniqueness` (and add the same shape for other characteristics before asserting them).

---

## Step 6 - Deprecated flags

Settings v7 (2026-Q1) made a clean break and DEPRECATED these flags:

| Deprecated | Replacement |
|---|---|
| `SoftDeleteEnabled` | `UserSoftDeleteEnabled` |
| `ReprovisionOnConflictForSoftDeletedResource` | (removed) |
| `MultiOpPatchRequestAddMultipleMembersToGroup` | `MultiMemberPatchOpForGroupEnabled` |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | `MultiMemberPatchOpForGroupEnabled` |

The `normalizeStaleSettingsKeys()` method in `EndpointService` strips these on read. The audit must confirm:
- No production code path reads the deprecated key.
- Tests that pass a deprecated key see it normalized (or stripped).
- Docs mark them deprecated with a "use X instead" pointer.

---

## Outputs

When this prompt completes, produce:
1. The Step 2 flag-completeness matrix (14 rows × 10 columns).
2. List of cells marked ❌ (gaps).
3. List of flag-combination tests added.
4. List of doc updates (additions to ENDPOINT_CONFIG_FLAGS_REFERENCE.md).
5. Confirmation that all deprecated flags still strip cleanly.
