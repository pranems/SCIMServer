import { Test, TestingModule } from '@nestjs/testing';
import { AdminAuthenticationMethodController } from './admin-authentication-method.controller';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { AUTH_ADMIN_EVENT } from '../../../oauth/auth-admin-event';
import { CURRENT_AUTH_SCHEMA_VERSION } from '../endpoint-profile/auto-expand.service';
import type { ProfileAuthentication } from '../endpoint-profile/endpoint-profile.types';

/**
 * A8 - changing an endpoint's authentication methods is the most
 * security-sensitive config-time mutation the product exposes, so it must emit
 * the same structured audit event the credential and JWKS-host controllers
 * already emit. Before this suite it emitted only free-text INFO, which cannot
 * be alerted on or counted.
 */
describe('AdminAuthenticationMethodController - A8 auth-admin audit events', () => {
  let controller: AdminAuthenticationMethodController;
  let logger: { info: jest.Mock; warn: jest.Mock };
  let stored: ProfileAuthentication;

  const ENDPOINT_ID = '11111111-2222-3333-4444-555555555555';

  /**
   * Only the emitter's canonical event, ignoring the free-text lines. Success
   * is emitted at INFO and failure at WARN, so both channels must be read or
   * the failure assertions pass vacuously.
   */
  const adminEvents = (): Record<string, unknown>[] =>
    [...logger.info.mock.calls, ...logger.warn.mock.calls]
      .filter((c) => c[1] === AUTH_ADMIN_EVENT)
      .map((c) => c[2] as Record<string, unknown>);

  beforeEach(async () => {
    stored = { schemaVersion: CURRENT_AUTH_SCHEMA_VERSION, methods: [] };
    logger = { info: jest.fn(), warn: jest.fn() };

    const endpointService = {
      getEndpoint: jest.fn().mockImplementation(() =>
        Promise.resolve({ id: ENDPOINT_ID, profile: { authentication: stored } }),
      ),
      updateEndpoint: jest.fn().mockImplementation((_id: string, patch: { profile: { authentication: ProfileAuthentication } }) => {
        stored = patch.profile.authentication;
        return Promise.resolve({ id: ENDPOINT_ID, profile: { authentication: stored } });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuthenticationMethodController],
      providers: [
        { provide: EndpointService, useValue: endpointService },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile();

    controller = module.get(AdminAuthenticationMethodController);
  });

  it('A8-T1: emits one auth_method_add event on a successful add', async () => {
    const created = await controller.add(ENDPOINT_ID, { type: 'wif-7523', displayName: 'Contoso WIF' });

    const events = adminEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'auth_method_add',
      outcome: 'success',
      endpointId: ENDPOINT_ID,
      method: 'wif-7523',
      credentialId: created.id,
    });
  });

  it('A8-T2: emits one auth_method_remove event on a successful remove', async () => {
    const created = await controller.add(ENDPOINT_ID, { type: 'bearer' });
    logger.info.mockClear(); logger.warn.mockClear();

    await controller.remove(ENDPOINT_ID, created.id);

    const events = adminEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'auth_method_remove',
      outcome: 'success',
      endpointId: ENDPOINT_ID,
      method: 'bearer',
      credentialId: created.id,
    });
  });

  it('A8-T3: a rejected type emits a failure event, not silence', async () => {
    await expect(controller.add(ENDPOINT_ID, { type: 'not-a-real-method' })).rejects.toThrow();

    const events = adminEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'auth_method_add', outcome: 'failure', endpointId: ENDPOINT_ID });
  });

  it('A8-T4: removing an unknown method emits a failure event', async () => {
    await expect(controller.remove(ENDPOINT_ID, 'm-nonexistent')).rejects.toThrow();

    const events = adminEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'auth_method_remove', outcome: 'failure', endpointId: ENDPOINT_ID });
  });

  it('A8-T5: the event carries no secret-bearing config', async () => {
    await controller.add(ENDPOINT_ID, {
      type: 'oauth-client',
      config: { clientSecret: 'super-secret-value', issuer: 'https://example.test' },
    });

    const serialized = JSON.stringify(adminEvents());
    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toContain('clientSecret');
  });
});
