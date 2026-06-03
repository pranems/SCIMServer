# Phase N4 - Settings Persistence

**Status:** Shipped in v0.52.0-alpha.5 (2026-05).
**Branch:** `feat/ui`.
**Test counts:** API unit 3,735 / API E2E 1,197 / Web vitest **959** / Live SCIM 1,005 / PowerShell 15 / Playwright 75.

## Goal

Persist a small, opinionated set of per-user UI preferences across page
loads and browser sessions so the UI feels remembered instead of reset.
The first cut covers the 3 highest-leverage knobs:

| Preference                   | Type            | Default | Where it matters                                  |
|------------------------------|-----------------|---------|---------------------------------------------------|
| `defaultPageSize`            | 10/20/50/100    | 20      | Users, Groups, Logs, Activity list views          |
| `denseMode`                  | boolean         | false   | Reserved for table row padding (UI consumers TBD) |
| `sidebarCollapsedDefault`    | boolean         | false   | Reserved for app-shell sidebar default            |

`defaultPageSize` is the only preference that has live consumers in this
commit; `denseMode` and `sidebarCollapsedDefault` are persisted but
intentionally not yet wired into chrome (see "Deferred" below).

## Architecture

```mermaid
flowchart LR
  subgraph Storage
    LS[localStorage<br/>scimserver.preferences.v1<br/>{v:1, prefs:{...}}]
  end
  subgraph Store
    PS[preferences-store.ts<br/>Zustand atom]
  end
  subgraph UI
    SP[SettingsPage<br/>PreferencesCard]
    UT[UsersTab]
    GT[GroupsTab]
    LT[LogsTab]
    AT[ActivityTab]
  end
  subgraph Routes
    UR[users route loader]
    GR[groups route loader]
    LR[logs route loader]
    AR[activity route loader]
  end

  LS -->|hydrate at module load| PS
  PS -->|setters persist| LS
  SP -->|read + setters| PS
  UT -->|defaultPageSize selector| PS
  GT -->|defaultPageSize selector| PS
  LT -->|defaultPageSize selector| PS
  AT -->|defaultPageSize selector| PS
  UR -->|getState\(\).defaultPageSize| PS
  GR -->|getState\(\).defaultPageSize| PS
  LR -->|getState\(\).defaultPageSize| PS
  AR -->|getState\(\).defaultPageSize| PS
```

## Module Map

| File                                                       | Role                                                                                  |
|------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `web/src/store/preferences-store.ts`                       | Zustand store + hand-rolled versioned `localStorage` persistence + clamping helpers   |
| `web/src/store/preferences-store.test.ts`                  | 13 unit tests: defaults, setters, reset, hydration (envelope/corrupt/unknown/partial) |
| `web/src/pages/SettingsPage.tsx`                           | `PreferencesCard` (Dropdown + 2 Switch + Reset)                                       |
| `web/src/pages/SettingsPage.test.tsx`                      | 3 tests covering card render, dense-mode persistence, reset                           |
| `web/src/routes/search-schemas.ts`                         | `paginationSchema.pageSize` flipped from `.default(20)` to `.optional()`              |
| `web/src/routes/search-schemas.test.ts`                    | Updated assertions to reflect new optional pageSize semantics                         |
| `web/src/pages/{Users,Groups,Logs,Activity}Tab.tsx`        | Consumers: `search.pageSize ?? defaultPageSize` selector                              |
| `web/src/routes/endpoints.$endpointId.{users,groups,logs,activity}.tsx` | Route loader prefetch: `deps.pageSize ?? usePreferencesStore.getState().defaultPageSize` |
| `web/src/pages/LogsPage.tsx`                               | Reset link drops the explicit `pageSize: 20`; lets the preference fill                |

## Design Rationale

### Why a hand-rolled persistence layer instead of `zustand/middleware/persist`?

- We need a versioned envelope (`{v: 1, prefs: {...}}`) so a future
  schema change can be rejected/migrated without zustand-middleware
  semantics leaking.
- We need explicit allowlisting / clamping at hydrate time
  (`ALLOWED_PAGE_SIZES`). The persist middleware merges raw JSON.
- The hand-roll is ~50 LoC and stays under our security and CSP
  posture (no surprise serialization of unknown shapes).

### Why a separate store (not folded into `ui-store`)?

`ui-store` holds ephemeral chrome state (sidebar open/closed,
breadcrumbs, current theme). `preferences-store` holds long-lived
user preferences. Mixing them would conflate "what the UI looks like
right now" with "what the user wants every session to start as."

### Why `defaultPageSize` is the source of truth, not the URL?

Each tab already reads the URL via TanStack Router's `useSearch`. The
URL is the *current* state; the preference is the *default*. The
component composition is exactly:

```ts
const defaultPageSize = usePreferencesStore((s) => s.defaultPageSize);
const pageSize = search.pageSize ?? defaultPageSize;
```

This means:
- `?pageSize=50` in the URL always wins (deep-link + share preserved).
- Without `?pageSize`, the user's persisted preference takes effect.
- The historic out-of-the-box value 20 still applies for a fresh
  visitor because `PREFERENCES_DEFAULTS.defaultPageSize === 20`.

### Why route loaders use `getState()` instead of the hook?

TanStack Router loaders run outside React's render cycle. `getState()`
on a Zustand store is the legitimate way to read the current snapshot
synchronously. The loader's prefetch and the component's render must
agree on `count`, otherwise the prefetched query is missed and we pay
a double-fetch.

### Why clamp `defaultPageSize` to `[10, 20, 50, 100]`?

The server's `/scim/Users?count=<N>` caps at 100, and dropdown UX is
cleaner with a closed set than a freeform spinner. The clamp also
defends against a stale localStorage entry from a future schema where
the allow-set widens.

## Test Coverage

### Unit (vitest, 16 tests across 4 files)

| File | Suite | Count |
|------|-------|------|
| `preferences-store.test.ts` | defaults/constants, setters, reset, hydration (6 cases including corrupt/unknown/partial) | 13 |
| `SettingsPage.test.tsx`     | PreferencesCard render + dense-mode persist + reset | 3 |
| `UsersTab.test.tsx`         | `honors preferences-store defaultPageSize when URL has no ?pageSize override` | 1 |
| `GroupsTab.test.tsx`        | `honors preferences-store defaultPageSize when URL has no ?pageSize override` | 1 |
| `LogsTab.test.tsx`          | `honors preferences-store defaultPageSize when URL has no ?pageSize override` | 1 |

### Smoke (Playwright)

`web/e2e/preferences.spec.ts` mounts the Settings page against dev FQDN
and confirms the `settings-preferences-card` is visible with its 4
controls. Skip-safe in environments where auth is not available.

## Deferred (Standing Backlog)

- **Per-page gear panels** to let the user override `pageSize` for a
  single view without changing the global default.
- **Wire `denseMode` into every DataTable** (table primitive gains a
  density prop; affects `Users`, `Groups`, `Logs`, `Activity` rows).
- **Wire `sidebarCollapsedDefault`** into `ui-store` initial state at
  bootstrap.
- **Server-side `/admin/me/preferences`** to sync preferences across
  devices for the same operator. This requires endpoint credentials,
  schema, and an opt-in. Out of scope for v0.52.x.

## RFC / Spec Notes

This is a UI-only change. No SCIM 2.0 (RFC 7643 / 7644) endpoints are
added or modified. Storage is `localStorage` (browser-local only).

## CHANGELOG Reference

See `CHANGELOG.md` v0.52.0-alpha.5 entry.
