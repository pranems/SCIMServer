/**
 * AdminJwksHostController - Phase 4 config-time auth audit events.
 *
 * The JWKS host allowlist is a WIF trust root (which hosts the server will fetch
 * signing keys from), so every add / update / patch / remove is audited as a
 * `LogCategory.AUTH` "Auth config change" event. This spec locks that each
 * mutation emits exactly one such event with the right action + host payload.
 */
import { AdminJwksHostController } from './admin-jwks-host.controller';

describe('AdminJwksHostController (Phase 4 audit events)', () => {
  let controller: AdminJwksHostController;
  let allowlist: {
    view: jest.Mock;
    addHost: jest.Mock;
    updateHost: jest.Mock;
    patchHosts: jest.Mock;
    removeHost: jest.Mock;
  };
  let logger: { info: jest.Mock; warn: jest.Mock };

  const view = { seed: [], env: [], persisted: [], effective: [] };

  beforeEach(() => {
    allowlist = {
      view: jest.fn().mockReturnValue(view),
      addHost: jest.fn().mockResolvedValue(view),
      updateHost: jest.fn().mockResolvedValue({ updated: true, view }),
      patchHosts: jest.fn().mockResolvedValue({ added: 1, removed: 1, view }),
      removeHost: jest.fn().mockResolvedValue({ removed: true, view }),
    };
    logger = { info: jest.fn(), warn: jest.fn() };
    controller = new AdminJwksHostController(allowlist as never, logger as never);
  });

  function authEvent() {
    return logger.info.mock.calls.find((c) => c[1] === 'Auth config change');
  }

  it('add() emits a jwks_host_add success event', async () => {
    await controller.add({ host: 'idp.example.com', label: 'Entra' });
    expect(allowlist.addHost).toHaveBeenCalledWith('idp.example.com', 'Entra');
    const call = authEvent();
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ action: 'jwks_host_add', outcome: 'success', host: 'idp.example.com' });
  });

  it('update() emits a jwks_host_update success event', async () => {
    await controller.update('id-1', { host: 'new.example.com' });
    expect(allowlist.updateHost).toHaveBeenCalledWith('id-1', 'new.example.com', null);
    const call = authEvent();
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ action: 'jwks_host_update', outcome: 'success', host: 'new.example.com' });
  });

  it('patch() emits a jwks_host_patch success event with hostsAdded/hostsRemoved', async () => {
    await controller.patch({ add: ['a.example.com'], remove: ['b.example.com'] });
    const call = authEvent();
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({
      action: 'jwks_host_patch',
      outcome: 'success',
      hostsAdded: ['a.example.com'],
      hostsRemoved: ['b.example.com'],
    });
  });

  it('remove() emits a jwks_host_remove success event', async () => {
    await controller.remove('idp.example.com');
    expect(allowlist.removeHost).toHaveBeenCalledWith('idp.example.com');
    const call = authEvent();
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ action: 'jwks_host_remove', outcome: 'success', host: 'idp.example.com' });
  });

  it('remove() of a non-existent host still emits, with a no-match detail', async () => {
    allowlist.removeHost.mockResolvedValue({ removed: false, view });
    await controller.remove('absent.example.com');
    const call = authEvent();
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ action: 'jwks_host_remove', outcome: 'success', detail: 'no matching persisted host' });
  });

  it('rejects a non-bare host before emitting (no event on validation failure)', async () => {
    await expect(controller.add({ host: 'https://idp.example.com/keys' })).rejects.toBeTruthy();
    expect(authEvent()).toBeUndefined();
  });
});
