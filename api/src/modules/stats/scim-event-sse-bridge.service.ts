/**
 * ScimEventSseBridge - Phase J (v0.48.1) - SSE forwarder for SCIM events.
 *
 * The bridge is the missing seam between the EventEmitter2 SCIM
 * mutation events (emitted by SCIM service code after DB commit) and
 * the SSE log stream consumed by the Web `useSSE` hook.
 *
 * Before Phase J:
 *   - SCIM services emit `scim.user.created` etc via EventEmitter2.
 *   - Only `StatsProjectionService` listens (for in-memory counters).
 *   - The SSE stream at `GET /scim/admin/log-config/stream` only
 *     forwards `StructuredLogEntry` objects, which have no `type`
 *     field. So `useSSE` (which dispatches on `data?.type`) saw
 *     nothing matching `SUPPORTED_EVENT_TYPES` and cross-tab refresh
 *     fell back entirely to the 30s `staleTime`.
 *
 * With this bridge:
 *   - One handler per `SCIM_EVENTS` constant catches the
 *     EventEmitter2 emit and immediately re-broadcasts onto the SCIM
 *     event channel via `ScimLogger.emitScimEvent(type, payload)`.
 *   - The SSE controller subscribes to BOTH log entries and SCIM
 *     events and writes each to the response stream.
 *   - `useSSE` receives `{type: 'scim.x.y', endpointId, scimId, ...}`
 *     and triggers `computeInvalidations(type, endpointId)` -> per-key
 *     TanStack Query refresh, no 30s wait.
 *
 * Why one handler per event (not `@OnEvent('scim.**')`):
 *   - `EventEmitterModule.forRoot()` in [app.module.ts](../app/app.module.ts)
 *     does not enable wildcard mode (would require `wildcard: true`).
 *   - Explicit handlers make the wiring grep-able and make a missing
 *     forward fail at TypeScript compile time
 *     (the `scim-event-sse-bridge.service.spec.ts` `forEach` over
 *     `SCIM_EVENTS` would fail).
 *
 * @see docs/PHASE_J_SSE_EVENT_BRIDGE.md
 * @see api/src/modules/logging/scim-logger.service.ts emitScimEvent()
 * @see web/src/hooks/useSSE.ts (consumer)
 */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { ScimLogger } from '../logging/scim-logger.service';
import { SCIM_EVENTS } from './scim-events';

@Injectable()
export class ScimEventSseBridge {
  constructor(private readonly logger: ScimLogger) {}

  /**
   * Single forwarder shared by every `@OnEvent` handler. Keeping it
   * private avoids accidental external callers (`emitScimEvent` is
   * the only published API).
   */
  private forward(type: string, payload: unknown): void {
    // Defensive coerce: EventEmitter2 hands us whatever the emit site
    // passed. SCIM services always pass a Record, but we normalize
    // anyway so a non-object payload (mistake) doesn't crash the SSE
    // wire for every other tab.
    const safePayload =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)
        : { value: payload };
    this.logger.emitScimEvent(type, safePayload);
  }

  // ─── Users ──────────────────────────────────────────────────────

  @OnEvent(SCIM_EVENTS.USER_CREATED)
  onUserCreated(payload: unknown): void {
    this.forward(SCIM_EVENTS.USER_CREATED, payload);
  }

  @OnEvent(SCIM_EVENTS.USER_UPDATED)
  onUserUpdated(payload: unknown): void {
    this.forward(SCIM_EVENTS.USER_UPDATED, payload);
  }

  @OnEvent(SCIM_EVENTS.USER_DELETED)
  onUserDeleted(payload: unknown): void {
    this.forward(SCIM_EVENTS.USER_DELETED, payload);
  }

  @OnEvent(SCIM_EVENTS.USER_STATUS_CHANGED)
  onUserStatusChanged(payload: unknown): void {
    this.forward(SCIM_EVENTS.USER_STATUS_CHANGED, payload);
  }

  // ─── Groups ─────────────────────────────────────────────────────

  @OnEvent(SCIM_EVENTS.GROUP_CREATED)
  onGroupCreated(payload: unknown): void {
    this.forward(SCIM_EVENTS.GROUP_CREATED, payload);
  }

  @OnEvent(SCIM_EVENTS.GROUP_UPDATED)
  onGroupUpdated(payload: unknown): void {
    this.forward(SCIM_EVENTS.GROUP_UPDATED, payload);
  }

  @OnEvent(SCIM_EVENTS.GROUP_DELETED)
  onGroupDeleted(payload: unknown): void {
    this.forward(SCIM_EVENTS.GROUP_DELETED, payload);
  }

  @OnEvent(SCIM_EVENTS.GROUP_STATUS_CHANGED)
  onGroupStatusChanged(payload: unknown): void {
    this.forward(SCIM_EVENTS.GROUP_STATUS_CHANGED, payload);
  }

  // ─── Generic resources ──────────────────────────────────────────

  @OnEvent(SCIM_EVENTS.RESOURCE_CREATED)
  onResourceCreated(payload: unknown): void {
    this.forward(SCIM_EVENTS.RESOURCE_CREATED, payload);
  }

  @OnEvent(SCIM_EVENTS.RESOURCE_DELETED)
  onResourceDeleted(payload: unknown): void {
    this.forward(SCIM_EVENTS.RESOURCE_DELETED, payload);
  }

  // ─── Per-endpoint credentials (Phase J) ─────────────────────────

  @OnEvent(SCIM_EVENTS.CREDENTIAL_CREATED)
  onCredentialCreated(payload: unknown): void {
    this.forward(SCIM_EVENTS.CREDENTIAL_CREATED, payload);
  }

  @OnEvent(SCIM_EVENTS.CREDENTIAL_REVOKED)
  onCredentialRevoked(payload: unknown): void {
    this.forward(SCIM_EVENTS.CREDENTIAL_REVOKED, payload);
  }

  // ─── Endpoint admin CRUD (Phase J) ──────────────────────────────

  @OnEvent(SCIM_EVENTS.ENDPOINT_CREATED)
  onEndpointCreated(payload: unknown): void {
    this.forward(SCIM_EVENTS.ENDPOINT_CREATED, payload);
  }

  @OnEvent(SCIM_EVENTS.ENDPOINT_UPDATED)
  onEndpointUpdated(payload: unknown): void {
    this.forward(SCIM_EVENTS.ENDPOINT_UPDATED, payload);
  }

  @OnEvent(SCIM_EVENTS.ENDPOINT_DELETED)
  onEndpointDeleted(payload: unknown): void {
    this.forward(SCIM_EVENTS.ENDPOINT_DELETED, payload);
  }
}
