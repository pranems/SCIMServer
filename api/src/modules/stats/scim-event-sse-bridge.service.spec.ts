/**
 * Phase J (v0.48.1) - ScimEventSseBridge spec.
 *
 * The bridge is the missing seam between the EventEmitter2 SCIM
 * mutation events (emitted by SCIM service code after DB commit) and
 * the SSE log stream consumed by the Web `useSSE` hook. Before
 * Phase J the events were only consumed by `StatsProjectionService`
 * for in-memory counter updates; nothing forwarded them onto the
 * SSE wire, so cross-tab refresh fell back to the 30s `staleTime`.
 *
 * Contract:
 *   1. The bridge exposes a handler for every constant in
 *      `SCIM_EVENTS` (so adding a new constant without wiring it is a
 *      build-time failure, not a silent runtime gap).
 *   2. Each handler delegates to `ScimLogger.emitScimEvent(type, payload)`.
 *   3. The `type` field forwarded onto the SSE wire is the SAME
 *      string the SCIM service used to emit the event (so
 *      `useSSE.SUPPORTED_EVENT_TYPES` matching is byte-exact).
 *   4. The original payload (endpointId, scimId, optional fields) is
 *      preserved verbatim alongside the `type` discriminator.
 *
 * @see docs/PHASE_J_SSE_EVENT_BRIDGE.md S3.3
 * @see api/src/modules/stats/scim-event-sse-bridge.service.ts
 * @see api/src/modules/logging/scim-logger.service.ts emitScimEvent()
 */
import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';

import { ScimEventSseBridge } from './scim-event-sse-bridge.service';
import { ScimLogger } from '../logging/scim-logger.service';
import { SCIM_EVENTS } from './scim-events';

describe('ScimEventSseBridge - Phase J SSE forwarder', () => {
  let bridge: ScimEventSseBridge;
  let emitter: EventEmitter2;
  let scimLogger: { emitScimEvent: jest.Mock };

  beforeEach(async () => {
    scimLogger = { emitScimEvent: jest.fn() };

    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        ScimEventSseBridge,
        { provide: ScimLogger, useValue: scimLogger },
      ],
    }).compile();

    // EventEmitter2 only invokes @OnEvent handlers AFTER the app
    // lifecycle has begun; explicitly init so the decorators wire up.
    await module.init();

    bridge = module.get(ScimEventSseBridge);
    emitter = module.get(EventEmitter2);
  });

  describe('per-event forwarding (one handler per SCIM_EVENTS constant)', () => {
    const cases: Array<{ name: keyof typeof SCIM_EVENTS; payload: Record<string, unknown> }> = [
      { name: 'USER_CREATED', payload: { endpointId: 'ep-1', scimId: 'u-1', active: true } },
      { name: 'USER_UPDATED', payload: { endpointId: 'ep-1', scimId: 'u-1' } },
      { name: 'USER_DELETED', payload: { endpointId: 'ep-1', scimId: 'u-1', active: false } },
      { name: 'USER_STATUS_CHANGED', payload: { endpointId: 'ep-1', scimId: 'u-1', previousActive: true, newActive: false } },
      { name: 'GROUP_CREATED', payload: { endpointId: 'ep-1', scimId: 'g-1', active: true } },
      { name: 'GROUP_UPDATED', payload: { endpointId: 'ep-1', scimId: 'g-1' } },
      { name: 'GROUP_DELETED', payload: { endpointId: 'ep-1', scimId: 'g-1', active: true } },
      { name: 'GROUP_STATUS_CHANGED', payload: { endpointId: 'ep-1', scimId: 'g-1', previousActive: true, newActive: false } },
      { name: 'RESOURCE_CREATED', payload: { endpointId: 'ep-1', scimId: 'r-1', resourceType: 'Device' } },
      { name: 'RESOURCE_DELETED', payload: { endpointId: 'ep-1', scimId: 'r-1', resourceType: 'Device' } },
      { name: 'CREDENTIAL_CREATED', payload: { endpointId: 'ep-1', credentialId: 'c-1', credentialType: 'bearer' } },
      { name: 'CREDENTIAL_REVOKED', payload: { endpointId: 'ep-1', credentialId: 'c-1' } },
      { name: 'ENDPOINT_CREATED', payload: { endpointId: 'ep-new', name: 'tenantA' } },
      { name: 'ENDPOINT_UPDATED', payload: { endpointId: 'ep-1', name: 'tenantA' } },
      { name: 'ENDPOINT_DELETED', payload: { endpointId: 'ep-1', name: 'tenantA' } },
    ];

    test.each(cases)(
      'forwards $name to ScimLogger.emitScimEvent with the wire-string type and verbatim payload',
      ({ name, payload }) => {
        const eventType = (SCIM_EVENTS as Record<string, string>)[name];
        if (!eventType) {
          throw new Error(
            `SCIM_EVENTS.${name} must be defined for the bridge to forward it`,
          );
        }
        expect(eventType).toBeDefined();

        emitter.emit(eventType, payload);

        expect(scimLogger.emitScimEvent).toHaveBeenCalledTimes(1);
        const [forwardedType, forwardedPayload] = scimLogger.emitScimEvent.mock.calls[0];
        expect(forwardedType).toBe(eventType);
        // Payload is forwarded verbatim (bridge does not mutate).
        expect(forwardedPayload).toEqual(payload);
      },
    );
  });

  describe('contract guard - no SCIM_EVENTS constant is ever silently dropped', () => {
    it('forwards EVERY event in SCIM_EVENTS (catch missing-handler regressions at build time)', () => {
      let forwarded = 0;
      scimLogger.emitScimEvent.mockImplementation(() => {
        forwarded += 1;
      });

      for (const eventType of Object.values(SCIM_EVENTS)) {
        emitter.emit(eventType, { endpointId: 'ep-coverage', scimId: 'x' });
      }

      // One forward per emit; if a handler is missing this fails by
      // count, pinpointing the unwired event in the diff.
      expect(forwarded).toBe(Object.keys(SCIM_EVENTS).length);
    });
  });

  it('exposes the bridge as an injectable provider', () => {
    expect(bridge).toBeInstanceOf(ScimEventSseBridge);
  });
});
