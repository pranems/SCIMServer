/**
 * admin-security-settings.controller.spec.ts (WI-8) - unit tests for the
 * server-scope security settings surface (visibility + KEK status + purge).
 */
import { BadRequestException } from '@nestjs/common';
import { AdminSecuritySettingsController } from './admin-security-settings.controller';

function makeController() {
  const credentialSecurity = {
    getServerVisibility: jest.fn().mockResolvedValue('always'),
    setServerVisibility: jest.fn().mockResolvedValue(undefined),
    purgeAllRetainedSecrets: jest.fn().mockResolvedValue(2),
  };
  const credentialEncryption = {
    getKekStatus: jest.fn().mockReturnValue({ configured: true, isDefault: true }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const controller = new AdminSecuritySettingsController(
    credentialSecurity as any,
    credentialEncryption as any,
    logger as any,
  );
  return { controller, credentialSecurity, credentialEncryption, logger };
}

describe('AdminSecuritySettingsController (WI-8)', () => {
  it('GET returns the server visibility + KEK status', async () => {
    const { controller } = makeController();
    const res = await controller.get();
    expect(res).toEqual({
      credentialSecretVisibility: 'always',
      kek: { configured: true, isDefault: true },
    });
  });

  it('PUT sets a valid visibility and echoes it back', async () => {
    const { controller, credentialSecurity } = makeController();
    const res = await controller.update({ credentialSecretVisibility: 'once' });
    expect(credentialSecurity.setServerVisibility).toHaveBeenCalledWith('once');
    expect(res.credentialSecretVisibility).toBe('once');
  });

  it('PUT to "once" purges every retained secret (server ceiling)', async () => {
    const { controller, credentialSecurity } = makeController();
    await controller.update({ credentialSecretVisibility: 'once' });
    expect(credentialSecurity.purgeAllRetainedSecrets).toHaveBeenCalledTimes(1);
  });

  it('PUT to "always" does NOT purge', async () => {
    const { controller, credentialSecurity } = makeController();
    await controller.update({ credentialSecretVisibility: 'always' });
    expect(credentialSecurity.purgeAllRetainedSecrets).not.toHaveBeenCalled();
  });

  it('PUT rejects an invalid enum value', async () => {
    const { controller } = makeController();
    await expect(controller.update({ credentialSecretVisibility: 'bogus' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('PUT is case-insensitive on the enum', async () => {
    const { controller, credentialSecurity } = makeController();
    const res = await controller.update({ credentialSecretVisibility: 'ONCE' });
    expect(credentialSecurity.setServerVisibility).toHaveBeenCalledWith('once');
    expect(res.credentialSecretVisibility).toBe('once');
  });
});
