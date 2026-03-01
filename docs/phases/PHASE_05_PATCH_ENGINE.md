# Phase 5 — Domain-Layer PATCH Engine

## Summary

**Gap:** G5 — Inline PATCH logic coupled to NestJS services  
**Severity:** MEDIUM  
**Goal:** Extract SCIM PATCH operations from service classes into standalone, pure-domain PatchEngine classes with zero framework dependencies.

## What Changed

### Before (Phase 4)
- `endpoint-scim-users.service.ts` (~626 lines) contained `applyPatchOperationsForEndpoint()` (~140 lines) + 6 inline helper methods for path parsing, attribute extraction, and dot-notation handling
- `endpoint-scim-groups.service.ts` (~677 lines) contained `handleReplace()`, `handleAdd()`, `handleRemove()`, `toMemberDto()`, `ensureUniqueMembers()` inline methods
- PATCH logic was tightly coupled to NestJS `@Injectable()` services — untestable without full DI setup
- No domain-layer error boundary — HTTP exceptions thrown directly from business logic

### After (Phase 5)
- **`UserPatchEngine`** — pure static class (~290 lines) with `apply()` method handling all SCIM path types
- **`GroupPatchEngine`** — pure static class (~240 lines) with `apply()` method handling member operations + config flags
- **`PatchError`** — domain error class (no NestJS dependency) with `status`, `scimType`, `message`
- **`PatchConfig` / `GroupMemberPatchConfig`** — typed interfaces for config flag passing
- Services reduced to thin orchestrators: load → delegate → catch → save
- `endpoint-scim-users.service.ts` reduced from ~626 to ~415 lines (~34% reduction)
- `endpoint-scim-groups.service.ts` reduced from ~677 to ~465 lines (~31% reduction)

## Architecture

```
Service (NestJS)                    Domain (Pure TypeScript)
┌──────────────────────┐           ┌─────────────────────────┐
│ endpoint-scim-users  │           │ UserPatchEngine          │
│   .service.ts        │──apply()──│   .apply(ops, state,     │
│                      │           │     config): Result       │
│  - loads DB record   │           │                           │
│  - catches PatchError│           │  - normalizeObjectKeys()  │
│  - saves to DB       │           │  - stripReservedAttrs()   │
└──────────────────────┘           │  - extract*Value()        │
                                   │  - applyDotNotation()     │
┌──────────────────────┐           │  - removeAttribute()      │
│ endpoint-scim-groups │           └─────────────────────────┘
│   .service.ts        │──apply()──┐
│                      │           │ GroupPatchEngine           │
│  - loads DB record   │           │   .apply(ops, state,      │
│  - catches PatchError│           │     config): Result        │
│  - saves to DB       │           │                            │
└──────────────────────┘           │  - handleReplace()         │
                                   │  - handleAdd()             │
                                   │  - handleRemove()          │
                                   │  - ensureUniqueMembers()   │
                                   └────────────────────────────┘
```

## Error Boundary

```
Domain Layer                          Service Layer
┌──────────────┐                     ┌──────────────────────┐
│  PatchError  │──catch(err)──────►  │  createScimError()   │
│  .status     │                     │  HttpException        │
│  .scimType   │                     │  SCIM JSON response   │
│  .message    │                     └──────────────────────┘
└──────────────┘
```

Services catch `PatchError` and convert to NestJS `HttpException` via `createScimError({ status, scimType, detail })`.

## File Inventory

### New Files (7)
| File | Purpose | Lines |
|------|---------|-------|
| `api/src/domain/patch/patch-types.ts` | Domain interfaces: `PatchOperation`, `PatchConfig`, `GroupMemberPatchConfig`, `UserPatchResult`, `GroupPatchResult`, etc. | ~55 |
| `api/src/domain/patch/patch-error.ts` | Domain error class with `status` + `scimType` | ~15 |
| `api/src/domain/patch/user-patch-engine.ts` | Pure domain UserPatchEngine with static `apply()` | ~290 |
| `api/src/domain/patch/group-patch-engine.ts` | Pure domain GroupPatchEngine with static `apply()` | ~240 |
| `api/src/domain/patch/index.ts` | Barrel export | ~5 |
| `api/src/domain/patch/user-patch-engine.spec.ts` | 36 unit tests | ~450 |
| `api/src/domain/patch/group-patch-engine.spec.ts` | 37 unit tests | ~530 |

### Modified Files (2)
| File | Change | Before → After |
|------|--------|----------------|
| `endpoint-scim-users.service.ts` | Replaced inline PATCH + 6 helpers with `UserPatchEngine.apply()` delegation | ~626 → ~415 lines |
| `endpoint-scim-groups.service.ts` | Replaced inline ops loop + 5 helpers with `GroupPatchEngine.apply()` delegation | ~677 → ~465 lines |

## UserPatchEngine Details

### Path Types Handled
| Path Type | Example | Handler |
|-----------|---------|---------|
| Simple attribute | `active`, `userName`, `displayName` | Direct extraction + field mapping |
| ValuePath expression | `emails[type eq "work"].value` | `parseValuePath()` → `applyValuePathUpdate()` |
| Extension URN | `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department` | `parseExtensionPath()` → `applyExtensionUpdate()` |
| Dot-notation | `name.familyName` | `applyDotNotation()` (when `verbosePatch` enabled) |
| No-path merge | (path omitted, value is object) | `resolveNoPathValue()` with key normalization |

### Reserved Attributes (stripped from rawPayload)
`schemas`, `id`, `meta`, `userName`, `displayName`, `externalId`, `active`

## GroupPatchEngine Details

### Operation Handling
| Op | Path | Behavior |
|----|------|----------|
| replace | (none) | Merge string→displayName, object→fields+members |
| replace | `displayName` | Update displayName |
| replace | `externalId` | Update externalId |
| replace | `members` | Replace entire member list (deduplicated) |
| add | `members` | Append members (deduplicated), multi-member flag enforced |
| add | (none) | Merge members from value object |
| remove | `members` | Remove by value array or path filter expression |
| remove | (all members) | Requires `allowRemoveAllMembers` config flag |

### Config Flags
| Flag | Effect |
|------|--------|
| `allowMultiMemberAdd` | When false, rejects add ops with >1 member |
| `allowMultiMemberRemove` | When false, rejects remove ops with >1 member |
| `allowRemoveAllMembers` | When false, rejects remove-all-members operations |

## Test Coverage

### New Tests: 73
- **UserPatchEngine:** 36 tests covering all path types, operations, error handling, helper methods
- **GroupPatchEngine:** 37 tests covering all operations, member management, config flag enforcement, error handling

### Full Suite Results
- **984/984 unit tests passing** (29 suites) — up from 911
- **193/193 E2E tests passing** (15 suites)
- Docker build succeeded, container healthy

## Design Decisions

1. **Static classes over instances** — Engines are pure functions with no state; static `apply()` avoids unnecessary instantiation
2. **Config as resolved booleans** — Services read config flags; engines receive resolved values via typed interfaces
3. **Domain error boundary** — `PatchError` carries HTTP status + SCIM type without importing NestJS; services handle conversion
4. **Existing path utilities preserved** — `scim-patch-path.ts` remains as-is; UserPatchEngine imports its utilities rather than duplicating
5. **Services as orchestrators** — Load record → build state → delegate to engine → catch errors → save result
