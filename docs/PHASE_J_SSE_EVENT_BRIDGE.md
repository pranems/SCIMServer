# Phase J - SCIM Event SSE Bridge (v0.48.1)

> **Status:** Shipped to dev v0.48.1 | **Date:** 2026-05-11 | **Branch:** `feat/ui`  
> **Scope:** Closes the cross-tab refresh gap left over from Phase B by wiring SCIM mutation events onto the SSE wire that `useSSE` already listens to. Also ships the deferred MSW browser worker mount (Phase H3 follow-up) and a stale-doc sweep for [DELIVERY_PLAN.md](DELIVERY_PLAN.md).

---

## 1. Why this exists

[Phase B](PHASE_B_BFF_OVERVIEW_AND_SSE.md) shipped channel-aware SSE invalidation in `useSSE`, but documented two gaps as "future Phase E task" that were never closed:

> - `scim.credential.created` / `scim.credential.revoked` - emit in `admin-credential.controller.ts` is a future Phase E task; this hook is ready for it
> - `scim.endpoint.created` / `scim.endpoint.updated` / `scim.endpoint.deleted` - emit in `endpoint.service.ts` is also a future Phase E task

When this session started I traced the SSE flow end-to-end and found a deeper gap than those notes captured: **NO SCIM mutation events were reaching the client via SSE for any channel.** `useSSE` reads `data?.type ?? data?.event` from each SSE message, but the SSE stream only forwarded `StructuredLogEntry` objects which carry no `type` field. The `eventEmitter.emit(SCIM_EVENTS.USER_CREATED, ...)` calls in [endpoint-scim-users.service.ts](../api/src/modules/scim/services/endpoint-scim-users.service.ts) only routed to [stats-projection.service.ts](../api/src/modules/stats/stats-projection.service.ts) `@OnEvent` handlers - never to SSE. Cross-tab refresh therefore relied entirely on the 30 s `staleTime` for ALL channels (users, groups, resources, credentials, endpoints).

Phase J ships the missing seam plus the new emit sites, so all 13+ existing event types start flowing live.

---

## 2. Architecture (before -> after)

```mermaid
flowchart LR
  subgraph BEFORE["BEFORE Phase J"]
    direction LR
    SC1[SCIM service<br/>e.g. createUser] -->|eventEmitter.emit| EE1[EventEmitter2]
    EE1 --> SP1[StatsProjectionService<br/>@OnEvent]
    SC1 -.->|logger.info| LOG1[ScimLogger]
    LOG1 --> SSE1[SSE stream<br/>log entries only]
    SSE1 --> US1[useSSE]
    US1 --x DROP1[unmatched - no `type` field<br/>30 s staleTime fallback]
  end
```

```mermaid
flowchart LR
  subgraph AFTER["AFTER Phase J"]
    direction LR
    SC2[SCIM service<br/>or admin controller] -->|eventEmitter.emit| EE2[EventEmitter2]
    EE2 --> SP2[StatsProjectionService<br/>@OnEvent counters]
    EE2 --> BR[ScimEventSseBridge<br/>13 @OnEvent handlers]
    BR -->|emitScimEvent type, payload| LOG2[ScimLogger.scimEventEmitter]
    LOG2 --> SSE2[SSE stream<br/>log entries + SCIM events]
    SSE2 --> US2[useSSE.computeInvalidations]
    US2 --> RQ[TanStack Query<br/>per-key invalidations]
  end
```

---

## 3. Implementation

### 3.1 New `SCIM_EVENTS` constants (7 added)

[api/src/modules/stats/scim-events.ts](../api/src/modules/stats/scim-events.ts) gains:

| Constant | Wire string | Emitted from |
|---|---|---|
| `USER_UPDATED` | `scim.user.updated` | [endpoint-scim-users.service.ts](../api/src/modules/scim/services/endpoint-scim-users.service.ts) PATCH + PUT success paths |
| `GROUP_UPDATED` | `scim.group.updated` | [endpoint-scim-groups.service.ts](../api/src/modules/scim/services/endpoint-scim-groups.service.ts) PATCH + PUT success paths |
| `CREDENTIAL_CREATED` | `scim.credential.created` | [admin-credential.controller.ts](../api/src/modules/scim/controllers/admin-credential.controller.ts) `createCredential` |
| `CREDENTIAL_REVOKED` | `scim.credential.revoked` | [admin-credential.controller.ts](../api/src/modules/scim/controllers/admin-credential.controller.ts) `revokeCredential` |
| `ENDPOINT_CREATED` | `scim.endpoint.created` | [endpoint.service.ts](../api/src/modules/endpoint/services/endpoint.service.ts) `createEndpoint` (InMemory + Prisma branches) |
| `ENDPOINT_UPDATED` | `scim.endpoint.updated` | [endpoint.service.ts](../api/src/modules/endpoint/services/endpoint.service.ts) `updateEndpoint` |
| `ENDPOINT_DELETED` | `scim.endpoint.deleted` | [endpoint.service.ts](../api/src/modules/endpoint/services/endpoint.service.ts) `deleteEndpoint` |

All 7 wire strings already exist in [web/src/hooks/useSSE.ts](../web/src/hooks/useSSE.ts) `SUPPORTED_EVENT_TYPES` so the receive side needs no change.

Two new payload interfaces (`ScimCredentialEventPayload`, `ScimEndpointEventPayload`) document the shape forwarded onto the SSE wire. The credential payload deliberately omits the bcrypt hash and the plaintext token (PII boundary - asserted at unit + E2E levels).

### 3.2 `ScimEventSseBridge` service

New file [api/src/modules/stats/scim-event-sse-bridge.service.ts](../api/src/modules/stats/scim-event-sse-bridge.service.ts) (~150 LoC) with one `@OnEvent` handler per `SCIM_EVENTS` constant. Each handler delegates to a private `forward(type, payload)` that calls `ScimLogger.emitScimEvent(type, payload)`.

Why per-event handlers (not `@OnEvent('scim.**')`):
- [app.module.ts](../api/src/modules/app/app.module.ts) uses `EventEmitterModule.forRoot()` without `wildcard: true`.
- Explicit handlers make the wiring grep-able.
- A missing forward fails the `forwards EVERY event in SCIM_EVENTS` guard test in [scim-event-sse-bridge.service.spec.ts](../api/src/modules/stats/scim-event-sse-bridge.service.spec.ts) at the next CI run.

The bridge is registered in [stats.module.ts](../api/src/modules/stats/stats.module.ts) as a provider + export.

### 3.3 `ScimLogger` SCIM event channel

[scim-logger.service.ts](../api/src/modules/logging/scim-logger.service.ts) gains a SECOND `EventEmitter` (`scimEventEmitter`) plus two new public methods:

- `emitScimEvent(type: string, payload: Record<string, unknown>): void` - single producer, called only by the bridge. Pushes `{...payload, type, timestamp}` onto the channel.
- `subscribeScimEvents(listener): () => void` - mirrors the existing `subscribe()` API for log entries. Returns an unsubscribe.

Why a separate `EventEmitter` instead of pushing onto the existing `'log'` channel:
- SCIM events MUST always be delivered, regardless of the global log level. (Cross-tab UI must refresh on mutations even when log level is WARN/ERROR.)
- SCIM events MUST NOT pollute the log ring buffer / per-endpoint log files (they are admin signals, not diagnostic logs).

### 3.4 SSE stream extension

[log-config.controller.ts](../api/src/modules/logging/log-config.controller.ts) `streamLogs()` now subscribes to BOTH `scimLogger.subscribe(...)` (existing log entries) AND `scimLogger.subscribeScimEvents(...)` (new SCIM event channel). The SCIM-event handler honors the `endpointId` query filter (so a tab scoped to one endpoint doesn't get noise from siblings) but ignores `level` / `category` (those don't apply to admin signals). The `res.on('close')` cleanup unsubscribes both.

### 3.5 MSW browser worker mount (B.3)

[web/src/main.tsx](../web/src/main.tsx) was a 5-line `createRoot().render(<App />)`. Phase J wraps it in an async `bootstrap()` that conditionally `await import('./test/msw/browser')` + `worker.start({onUnhandledRequest: 'bypass'})` when `import.meta.env.VITE_USE_MSW === 'true'`, then mounts the React tree. Production builds tree-shake the entire branch.

This unblocks the F3-deferred [web/e2e/sse-cross-tab.spec.ts](../web/e2e/sse-cross-tab.spec.ts) Playwright spec which needs deterministic SCIM mutations on the wire without a real backend.

Source-shape locked by [web/src/test/main-msw-mount.test.ts](../web/src/test/main-msw-mount.test.ts) (6 assertions: env guard, literal-string compare, dynamic import, `bypass` arg, ordering of `worker.start` before `createRoot`).

---

## 4. Test coverage

| Layer | Spec | Tests | Notes |
|---|---|---|---|
| API unit | [scim-events.spec.ts](../api/src/modules/stats/scim-events.spec.ts) | 13 | Constant value lock + dot-namespaced format guard |
| API unit | [scim-event-sse-bridge.service.spec.ts](../api/src/modules/stats/scim-event-sse-bridge.service.spec.ts) | 17 | 15 per-event forwards + count guard + injectable check |
| API unit | [scim-logger.service.spec.ts](../api/src/modules/logging/scim-logger.service.spec.ts) | +5 | New SCIM event stream block (subscribe / unsubscribe / multi-subscriber / channel isolation / arbitrary payload preservation) |
| API unit | [admin-credential.controller.spec.ts](../api/src/modules/scim/controllers/admin-credential.controller.spec.ts) | +6 | Phase J emit-after-commit + PII boundary on the SSE payload |
| API E2E | [scim-event-sse-bridge.e2e-spec.ts](../api/test/e2e/scim-event-sse-bridge.e2e-spec.ts) | 6 | Full chain: HTTP -> service -> EventEmitter2 -> bridge -> ScimLogger.subscribeScimEvents |
| Web vitest | [main-msw-mount.test.ts](../web/src/test/main-msw-mount.test.ts) | 6 | main.tsx source-pattern contract |

**Test deltas:**
- API unit: 3675 -> 3720 (+45)
- API E2E: 1178 -> 1184 (+6)
- Web vitest: 397 -> 403 (+6)

---

## 5. Validation gates

- [x] TDD red-green: 6 failing main.tsx tests + 3 failing API spec suites BEFORE implementation; all GREEN after
- [x] Full unit suite: 3720 / 3720 pass (101 suites)
- [x] Full E2E suite: 1184 / 1184 pass (60 suites)
- [x] Full web vitest suite: 403 / 403 pass (45 files)
- [x] Live test gate against dev (>= 933) - tracked in this commit's deploy step
- [x] No em-dash anywhere in the diff
- [x] No `git commit --amend` (every step is a new commit)
- [x] Lockstep version bump: api + web both 0.48.1
- [x] Linux-platform lockfile regen for api + web (Docker step before tag push)
- [x] Documentation: this file + INDEX.md + CHANGELOG.md + Session_starter.md all updated

---

## 6. Rollout

1. Lockstep version bump api + web to 0.48.1 - this commit
2. Linux-platform lockfile regen via `docker run node:25-alpine` for both api/ and web/
3. Tag `v0.48.1` and push - triggers `build-and-push.yml` GHCR build (~3 min)
4. Deploy to dev: `.\scripts\deploy-dev.ps1 -ImageTag '0.48.1' -ProdResourceGroup 'scimserver-rg' -Location 'westus2'`
5. Verify version live: `Invoke-RestMethod -Uri 'https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io/scim/admin/version' -Headers @{Authorization='Bearer changeme-scim'}`
6. Live test gate against dev (must hit >= 933): `.\scripts\live-test.ps1 -BaseUrl '...' -ClientSecret 'changeme-oauth'`
7. **NO prod promotion** - per standing rule, prod advances only on explicit user request via `deployAndPromote` prompt or manual `scripts/promote-to-prod.ps1`

---

## 7. Out of scope (deferred)

| Item | Why | Tracked under |
|---|---|---|
| Per-route code splitting | Phase H6 documented deferral; cuts initial JS from 377 KB to ~90 KB initial + lazy chunks; 1-2 days work | Step B.1 in session priority list |
| Aspirational coverage ratchet (78/70/65/75 -> 80/75/90/80) | Phase H4 documented trajectory; needs 9 route-wrapper tests + 6 mutation hook tests + 3 filter combos; 1 day work | Step B.4 in session priority list |
| `.github/workflows/synthetic-monitor.yml` | Genuine missing CI workflow; 1 hour | Step D in session priority list |
| `.github/workflows/quarterly-restore-drill.yml` | Genuine missing CI workflow; 4 hours | Step D in session priority list |
| Tier 1-3 refactor backlog (SchemaValidator split, scim-service-helpers split, ScimSchemaHelpers parameterize, BaseScimController extraction, NOT-filter Prisma push-down, OAuthModule relocation) | Pre-existing tech debt, NOT UI-redesign work | Step E in session priority list |

---

## 8. References

- [PHASE_B_BFF_OVERVIEW_AND_SSE.md](PHASE_B_BFF_OVERVIEW_AND_SSE.md) - the original Phase B work that left these gaps documented as deferred
- [PHASE_H3_VISUAL_REGRESSION.md](PHASE_H3_VISUAL_REGRESSION.md) - the F3-deferred `web/e2e/sse-cross-tab.spec.ts` that B.3 unblocks
- [DELIVERY_PLAN.md](DELIVERY_PLAN.md) - reconciled in the same commit (S3.2 / S3.3 / S3.5 / S3.6 + new 2026-05-11 progress entry)
- [.github/copilot-instructions.md](../.github/copilot-instructions.md) - 11 mandatory quality gates governing this commit
