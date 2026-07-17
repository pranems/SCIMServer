/**
 * Phase 4 - emitAuthAdminEvent (config-time auth-administration audit event).
 *
 * Locks the canonical event contract: exactly one message string, INFO on
 * success / WARN on failure|denied, non-secret payload, undefined-key drop.
 */
import { emitAuthAdminEvent, AUTH_ADMIN_EVENT, type AuthAdminEvent } from './auth-admin-event';

describe('emitAuthAdminEvent (Phase 4)', () => {
  function makeLogger() {
    return { info: jest.fn(), warn: jest.fn() };
  }
  const CAT = 'auth';

  it('logs a success at INFO with the canonical message', () => {
    const logger = makeLogger();
    const ev: AuthAdminEvent = { action: 'wif_verify', outcome: 'success', endpointId: 'ep-1' };
    emitAuthAdminEvent(logger, ev, CAT);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    const [cat, msg, data] = logger.info.mock.calls[0];
    expect(cat).toBe(CAT);
    expect(msg).toBe(AUTH_ADMIN_EVENT);
    expect(data).toMatchObject({ action: 'wif_verify', outcome: 'success', endpointId: 'ep-1' });
  });

  it('logs a failure at WARN', () => {
    const logger = makeLogger();
    emitAuthAdminEvent(
      logger,
      { action: 'jwks_host_add', outcome: 'failure', host: 'idp.example.com', detail: 'invalid host' },
      CAT,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    const [, msg, data] = logger.warn.mock.calls[0];
    expect(msg).toBe(AUTH_ADMIN_EVENT);
    expect(data).toMatchObject({ action: 'jwks_host_add', outcome: 'failure', host: 'idp.example.com' });
  });

  it('logs a denied outcome at WARN', () => {
    const logger = makeLogger();
    emitAuthAdminEvent(logger, { action: 'wif_verify', outcome: 'denied' }, CAT);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('drops undefined keys so the payload stays clean', () => {
    const logger = makeLogger();
    emitAuthAdminEvent(logger, { action: 'jwks_host_remove', outcome: 'success', host: 'h' }, CAT);
    const [, , data] = logger.info.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(data, 'credentialId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(data, 'reasonCode')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(data, 'dryRun')).toBe(false);
  });

  it('carries the dryRun flag + reasonCode for a WIF debug-assertion event', () => {
    const logger = makeLogger();
    emitAuthAdminEvent(
      logger,
      { action: 'wif_debug_assertion', outcome: 'failure', endpointId: 'ep-1', dryRun: true, reasonCode: 'wif_audience_mismatch' },
      CAT,
    );
    const [, , data] = logger.warn.mock.calls[0];
    expect(data).toMatchObject({ dryRun: true, reasonCode: 'wif_audience_mismatch' });
  });

  it('carries changedFlags with before/after for an auth-flag change event', () => {
    const logger = makeLogger();
    emitAuthAdminEvent(
      logger,
      {
        action: 'auth_flags_changed',
        outcome: 'success',
        endpointId: 'ep-1',
        changedFlags: [{ flag: 'WifCredentialsEnabled', from: false, to: true }],
      },
      CAT,
    );
    const [, , data] = logger.info.mock.calls[0];
    expect(data.changedFlags).toEqual([{ flag: 'WifCredentialsEnabled', from: false, to: true }]);
  });

  it('carries hostsAdded / hostsRemoved for a bulk JWKS patch event', () => {
    const logger = makeLogger();
    emitAuthAdminEvent(
      logger,
      { action: 'jwks_host_patch', outcome: 'success', hostsAdded: ['a.com'], hostsRemoved: ['b.com'] },
      CAT,
    );
    const [, , data] = logger.info.mock.calls[0];
    expect(data.hostsAdded).toEqual(['a.com']);
    expect(data.hostsRemoved).toEqual(['b.com']);
  });
});
