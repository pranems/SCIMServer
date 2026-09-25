/**
 * credential-security.service.spec.ts (WI-7) - server-scope visibility get/set,
 * effective precedence (server ceiling), and retained-secret purge orchestration.
 */
import { CredentialSecurityService, SERVER_VISIBILITY_KEY } from './credential-security.service';
import type { IServerSettingRepository } from '../domain/repositories/server-setting.repository.interface';
import type { IEndpointCredentialRepository } from '../domain/repositories/endpoint-credential.repository.interface';

class FakeServerSettings implements IServerSettingRepository {
  store = new Map<string, string>([['credentialSecretVisibility', 'always']]);
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function fakeCredRepo(): jest.Mocked<Pick<IEndpointCredentialRepository, 'clearSecretEnvelopesForEndpoint'>> {
  return { clearSecretEnvelopesForEndpoint: jest.fn().mockResolvedValue(3) };
}

describe('CredentialSecurityService (WI-7)', () => {
  it('reads the seeded server visibility (always)', async () => {
    const svc = new CredentialSecurityService(new FakeServerSettings(), fakeCredRepo() as any);
    expect(await svc.getServerVisibility()).toBe('always');
  });

  it('defaults to always when the server setting is unset/invalid', async () => {
    const settings = new FakeServerSettings();
    settings.store.delete('credentialSecretVisibility');
    const svc = new CredentialSecurityService(settings, fakeCredRepo() as any);
    expect(await svc.getServerVisibility()).toBe('always');

    settings.store.set('credentialSecretVisibility', 'garbage');
    expect(await svc.getServerVisibility()).toBe('always');
  });

  it('treats legacy once-mode settings as always-retain going forward', async () => {
    const settings = new FakeServerSettings();
    settings.store.set('credentialSecretVisibility', 'once');
    const svc = new CredentialSecurityService(settings, fakeCredRepo() as any);

    expect(await svc.getServerVisibility()).toBe('always');
    expect(await svc.getEffectiveVisibility({ CredentialSecretVisibility: 'once' })).toBe('always');
  });

  it('coerces retired once-mode server updates to always', async () => {
    const settings = new FakeServerSettings();
    const svc = new CredentialSecurityService(settings, fakeCredRepo() as any);
    await svc.setServerVisibility('once');
    expect(settings.store.get(SERVER_VISIBILITY_KEY)).toBe('always');
    expect(await svc.getServerVisibility()).toBe('always');
  });

  it('always retains secrets regardless of legacy stored values', async () => {
    const settings = new FakeServerSettings();
    const svc = new CredentialSecurityService(settings, fakeCredRepo() as any);

    expect(await svc.getEffectiveVisibility({ CredentialSecretVisibility: 'once' })).toBe('always');
    expect(await svc.getEffectiveVisibility({})).toBe('always');

    await svc.setServerVisibility('once');
    expect(await svc.getEffectiveVisibility({ CredentialSecretVisibility: 'always' })).toBe('always');
  });

  it('purges retained secrets via the credential repo', async () => {
    const repo = fakeCredRepo();
    const svc = new CredentialSecurityService(new FakeServerSettings(), repo as any);
    const cleared = await svc.purgeRetainedSecrets('ep-1');
    expect(cleared).toBe(3);
    expect(repo.clearSecretEnvelopesForEndpoint).toHaveBeenCalledWith('ep-1');
  });
});
