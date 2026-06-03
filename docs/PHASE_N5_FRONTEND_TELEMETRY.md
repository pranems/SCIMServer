# Phase N5 - Frontend Telemetry (MVP)

> Status: shipped in v0.52.0-alpha.6 (commits `fc5b7a6`, `491464e`, this commit).
>
> Scope: pure frontend MVP. Captures (a) route navigations (page views) and
> (b) uncaught errors. Buffers events in-memory (Zustand) with a hard cap
> + TTL. Surfaces a debug card on `/settings`. Gated by a persisted
> opt-in preference. Zero new runtime dependencies. Server-side ingestion
> + retention is deferred to Phase O.

---

## 1. Why

Pre-N5 the operator had no way to ask the running browser tab "what did the
user click? what blew up?" without opening DevTools and reproducing the
issue live. The Phase N5 MVP solves the smallest useful slice of that:

- Page views feed the same intuition admins have in a normal analytics
  product ("is anyone using /workbench?").
- Uncaught errors land in the same buffer so a failed user action shows up
  side-by-side with the navigation that triggered it.

Phase N5 is intentionally **client-only**. Persisting events to the server
+ a retention policy + an `/admin/telemetry` ingestion endpoint is real
work, lives in a different layer (Postgres schema, Managed-Identity write
path, GDPR retention contract), and would mix new-feature risk with the
Azure-PG-MI cutover slated for Phase O. So Phase N5 ships the **frontend**
collector + a debug surface; Phase O wires it to durable storage.

## 2. Architecture

```mermaid
flowchart LR
  subgraph Sources
    R[TanStack Router\nsubscribe('onResolved')]
    W1[window 'error']
    W2[window 'unhandledrejection']
  end
  subgraph Collector["telemetry-collectors.ts (boot-time wire)"]
    BC[bootstrapTelemetryCollectors&#40;router&#41;]
  end
  subgraph Store["telemetry-store.ts (Zustand)"]
    TS[useTelemetryStore\nring &le; 50 evt &middot; TTL 24h]
  end
  subgraph Gate["preferences-store.ts"]
    P[telemetryOptIn\n&#40;persisted localStorage&#41;]
  end
  subgraph UI["SettingsPage.tsx"]
    TC[TelemetryCard\n&#40;opt-in switch + last 10 + clear&#41;]
  end
  R --> BC
  W1 --> BC
  W2 --> BC
  BC -->|record&#40;&#41;| TS
  P -.gate.-> TS
  TS --> TC
  TC -.toggle.-> P
```

## 3. Module map

| Path | LoC | Role |
|---|---:|---|
| [web/src/store/telemetry-store.ts](../web/src/store/telemetry-store.ts) | ~90 | Zustand atom; `record()`, `clear()`, `events`; ring + TTL + opt-in gate. |
| [web/src/store/telemetry-store.test.ts](../web/src/store/telemetry-store.test.ts) | ~125 | 10 unit tests (constants / record / TTL / cap / clear / preferences integration). |
| [web/src/store/telemetry-collectors.ts](../web/src/store/telemetry-collectors.ts) | ~90 | `bootstrapTelemetryCollectors(router)` - idempotent, returns teardown. |
| [web/src/store/telemetry-collectors.test.ts](../web/src/store/telemetry-collectors.test.ts) | ~105 | 5 unit tests (nav wire / idempotency / error wire / rejection wire / teardown). |
| [web/src/store/preferences-store.ts](../web/src/store/preferences-store.ts) | +~25 | Adds `telemetryOptIn` (default `true`) + `setTelemetryOptIn` to the v1 envelope. |
| [web/src/store/preferences-store.test.ts](../web/src/store/preferences-store.test.ts) | +4 lines | 13 tests now assert the 4-key envelope shape. |
| [web/src/pages/SettingsPage.tsx](../web/src/pages/SettingsPage.tsx) | +~80 | Adds `<TelemetryCard />` mount + component. |
| [web/src/pages/SettingsPage.test.tsx](../web/src/pages/SettingsPage.test.tsx) | +4 tests | Empty state / table render / opt-in toggle / clear. |
| [web/src/main.tsx](../web/src/main.tsx) | +3 lines | Calls `bootstrapTelemetryCollectors(router)` once at boot. |
| [web/e2e/telemetry.spec.ts](../web/e2e/telemetry.spec.ts) | ~35 | Playwright smoke vs dev FQDN: TelemetryCard + 4 controls visible. |

## 4. Design rationale (documented for the gate-strategy audit trail)

### 4.1 Why a hard cap + TTL instead of unbounded buffer
A long-lived SPA tab is normal in this app (operator stays on `/endpoints`
for an hour). An unbounded ring would grow without limit; even at 100 bytes
/ event that's 360 KB / hour at 1 nav/sec. The 50-event cap matches what
fits comfortably in the SettingsPage table without scroll; the 24-hour TTL
is the longest realistic operator session before a forced refresh.

### 4.2 Why in-memory (not localStorage)
Telemetry events are **operational signal** ("did this navigation work?"),
not **preferences** ("show me dense tables"). Persisting operational
signal across reloads makes the ring stale fast (events from yesterday
showing up next to events from now). Phase O ships the durable layer
where this *does* belong (server-side, retention-controlled, queryable).

### 4.3 Why opt-in defaults to `true`
Frontend-only telemetry never leaves the browser tab in Phase N5, so the
privacy cost of default-on is zero. The signal value is high: a fresh
install captures page views immediately, which is what we want when
debugging. The switch is one click away when an operator wants it off.

When Phase O ships the server endpoint, the contract MUST flip: default-on
must require an explicit administrator consent (informed consent on the
onboarding wizard or a documented operational-policy banner).

### 4.4 Why subscribe-based router wire (not React effect)
The collector lives **outside** the React tree (`main.tsx` boots it). A
React effect would couple the collector to App lifecycle (suspense
boundaries, error boundaries, hot-reload semantics) and risk
double-recording in StrictMode. The TanStack Router `subscribe()` API is
purpose-built for the cross-cutting concern of "I want to know every
resolved navigation" without owning a piece of the UI.

### 4.5 Why idempotent bootstrap
Vite HMR re-imports `main.tsx` on edits to that file (rare but possible
during development). Without idempotency a long dev session would
re-subscribe every HMR cycle, ending with N copies of every event. The
module-level `active` flag short-circuits the second call; tests use the
explicit returned teardown to clean up between runs.

### 4.6 Why no `web-vitals` library
`web-vitals` is the obvious "next thing" - Core Web Vitals (LCP, CLS,
INP, TTFB, FCP) are exactly the kind of signal a telemetry pipeline
wants. But it adds a real dependency (~3 KB gzipped), a real bundle
budget entry, and the buffer schema would need a third event variant.
That's a sensible Phase N5b or Phase O scope; the MVP avoids it.

## 5. Test coverage

| Layer | File | Count |
|---|---|---:|
| Unit (Zustand store) | [web/src/store/telemetry-store.test.ts](../web/src/store/telemetry-store.test.ts) | 10 |
| Unit (collectors) | [web/src/store/telemetry-collectors.test.ts](../web/src/store/telemetry-collectors.test.ts) | 5 |
| Unit (preferences integration) | [web/src/store/preferences-store.test.ts](../web/src/store/preferences-store.test.ts) | 13 (4 updated for telemetryOptIn) |
| Component (SettingsPage card) | [web/src/pages/SettingsPage.test.tsx](../web/src/pages/SettingsPage.test.tsx) | 4 new (16 total) |
| E2E smoke | [web/e2e/telemetry.spec.ts](../web/e2e/telemetry.spec.ts) | 1 |

Phase N5 delta: **+19 vitest** (959 -> 978), **+1 Playwright** (75 -> 76).

## 6. Deferred / out-of-scope (Standing Backlog)

- **Server-side ingestion endpoint** `POST /scim/admin/telemetry`
  (Phase O) - batched, fire-and-forget, max 50 events / request.
- **Postgres telemetry table** with 7-day retention + per-tenant
  scoping (Phase O).
- **Web Vitals** capture via `web-vitals` package (Phase N5b or O).
- **Error sourcemap upload** (CI-time) so the captured `stack` resolves
  to TypeScript line numbers (Phase O).
- **Default-on flip to default-off** for server-side telemetry; needs
  operator consent UI on the onboarding wizard.
- **Per-user telemetry history view** as a tab on the global
  `/logs` page (Phase O, depends on the server-side table).
- **PII redaction** of `path` (the path may contain user-supplied
  resource IDs; if Phase O ships server-side ingestion, we'll add a
  redactor here that strips UUID-shaped path segments before record).

## 7. RFC / standards references

- W3C [`Performance Timeline Level 2`](https://www.w3.org/TR/performance-timeline-2/)
  - the eventual home for Web Vitals capture (Phase N5b).
- W3C [`Resource Timing Level 3`](https://www.w3.org/TR/resource-timing-3/)
  - for the eventual XHR / fetch latency feed (Phase O).
- WHATWG [`Window.onerror`](https://html.spec.whatwg.org/multipage/webappapis.html#runtime-script-errors)
  + [`unhandledrejection`](https://html.spec.whatwg.org/multipage/webappapis.html#unhandled-promise-rejections)
  - the standardized error sources the collector listens to.
