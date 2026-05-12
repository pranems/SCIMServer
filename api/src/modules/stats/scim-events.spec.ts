/**
 * Phase J (v0.48.1) - SCIM_EVENTS contract spec.
 *
 * Locks the set of event-name string constants that flow over the
 * EventEmitter2 bus. The Web `useSSE` hook (and its `EVENT_CHANNEL`
 * map in [web/src/hooks/useSSE.ts](../../../../web/src/hooks/useSSE.ts))
 * dispatch on these exact strings, so any rename here is a wire-level
 * breaking change for the live SSE consumer. This spec freezes the
 * contract.
 *
 * Phase J adds 7 new constants to close the cross-tab refresh gap for
 * the credential and endpoint admin flows + parity USER_UPDATED /
 * GROUP_UPDATED that the receive side already handles.
 *
 * @see docs/PHASE_J_SSE_EVENT_BRIDGE.md S2
 */
import { SCIM_EVENTS } from './scim-events';

describe('SCIM_EVENTS - wire contract', () => {
  // --- Phase B (existing) ----------------------------------------------
  describe('existing user / group / resource constants (Phase B)', () => {
    it('USER_CREATED matches the wire string useSSE listens for', () => {
      expect(SCIM_EVENTS.USER_CREATED).toBe('scim.user.created');
    });

    it('USER_DELETED matches the wire string', () => {
      expect(SCIM_EVENTS.USER_DELETED).toBe('scim.user.deleted');
    });

    it('USER_STATUS_CHANGED matches the wire string', () => {
      expect(SCIM_EVENTS.USER_STATUS_CHANGED).toBe('scim.user.statusChanged');
    });

    it('GROUP_CREATED matches the wire string', () => {
      expect(SCIM_EVENTS.GROUP_CREATED).toBe('scim.group.created');
    });

    it('GROUP_DELETED matches the wire string', () => {
      expect(SCIM_EVENTS.GROUP_DELETED).toBe('scim.group.deleted');
    });

    it('GROUP_STATUS_CHANGED matches the wire string', () => {
      expect(SCIM_EVENTS.GROUP_STATUS_CHANGED).toBe('scim.group.statusChanged');
    });

    it('RESOURCE_CREATED matches the wire string', () => {
      expect(SCIM_EVENTS.RESOURCE_CREATED).toBe('scim.resource.created');
    });

    it('RESOURCE_DELETED matches the wire string', () => {
      expect(SCIM_EVENTS.RESOURCE_DELETED).toBe('scim.resource.deleted');
    });
  });

  // --- Phase J (new in v0.48.1) ----------------------------------------
  describe('Phase J additions: parity USER_UPDATED / GROUP_UPDATED', () => {
    it('USER_UPDATED is exposed and matches the wire string useSSE expects', () => {
      // useSSE.SUPPORTED_EVENT_TYPES already lists 'scim.user.updated';
      // before Phase J the constant was missing so emit sites had to use
      // a magic string. This locks the constant in.
      expect((SCIM_EVENTS as Record<string, string>).USER_UPDATED).toBe(
        'scim.user.updated',
      );
    });

    it('GROUP_UPDATED is exposed and matches the wire string', () => {
      expect((SCIM_EVENTS as Record<string, string>).GROUP_UPDATED).toBe(
        'scim.group.updated',
      );
    });
  });

  describe('Phase J additions: credential admin events', () => {
    it('CREDENTIAL_CREATED matches the wire string useSSE dispatches on', () => {
      expect((SCIM_EVENTS as Record<string, string>).CREDENTIAL_CREATED).toBe(
        'scim.credential.created',
      );
    });

    it('CREDENTIAL_REVOKED matches the wire string', () => {
      expect((SCIM_EVENTS as Record<string, string>).CREDENTIAL_REVOKED).toBe(
        'scim.credential.revoked',
      );
    });
  });

  describe('Phase J additions: endpoint admin events', () => {
    it('ENDPOINT_CREATED matches the wire string', () => {
      expect((SCIM_EVENTS as Record<string, string>).ENDPOINT_CREATED).toBe(
        'scim.endpoint.created',
      );
    });

    it('ENDPOINT_UPDATED matches the wire string', () => {
      expect((SCIM_EVENTS as Record<string, string>).ENDPOINT_UPDATED).toBe(
        'scim.endpoint.updated',
      );
    });

    it('ENDPOINT_DELETED matches the wire string', () => {
      expect((SCIM_EVENTS as Record<string, string>).ENDPOINT_DELETED).toBe(
        'scim.endpoint.deleted',
      );
    });
  });

  // --- Wire-format guard ----------------------------------------------
  describe('all event names follow the dot-namespaced lower-case convention', () => {
    it('every constant is a `scim.<resource>.<verb>` string', () => {
      const pattern = /^scim\.[a-z]+\.[a-zA-Z]+$/;
      for (const [key, value] of Object.entries(SCIM_EVENTS)) {
        // Jest's expect() does not take a message argument; surface
        // the offending key in the error via a custom assertion.
        if (!pattern.test(value)) {
          throw new Error(
            `SCIM_EVENTS.${key}='${value}' violates dot-namespaced convention (must match ${pattern})`,
          );
        }
        expect(value).toMatch(pattern);
      }
    });

    it('exposes at least 15 event names (8 pre-Phase-J + 7 new)', () => {
      const count = Object.keys(SCIM_EVENTS).length;
      expect(count).toBeGreaterThanOrEqual(15);
    });
  });
});
