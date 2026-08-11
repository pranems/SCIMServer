import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwksHostAllowlistService, WELL_KNOWN_JWKS_HOST_SEED } from './jwks-host-allowlist.service';
import { JWKS_HOST_ALLOWLIST_REPOSITORY } from '../domain/repositories/repository.tokens';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import type { IJwksHostAllowlistRepository, JwksHostAllowlistEntryModel } from '../domain/repositories/jwks-host-allowlist.repository.interface';

/**
 * WI-15 - JwksHostAllowlistService unit tests. An in-memory fake repository
 * stands in for the persisted layer.
 */
describe('JwksHostAllowlistService (WI-15)', () => {
  let service: JwksHostAllowlistService;
  let repoStore: JwksHostAllowlistEntryModel[];
  let repo: IJwksHostAllowlistRepository;

  async function build(envAllowlist = 'custom-env.example.com'): Promise<void> {
    repoStore = [];
    repo = {
      findAll: jest.fn(async () => [...repoStore]),
      add: jest.fn(async (host: string, label: string | null) => {
        const existing = repoStore.find((e) => e.host === host);
        if (existing) return existing;
        const row = { id: `id-${repoStore.length}`, host, label, createdAt: new Date() };
        repoStore.push(row);
        return row;
      }),
      removeByHost: jest.fn(async (host: string) => {
        const before = repoStore.length;
        repoStore = repoStore.filter((e) => e.host !== host);
        return repoStore.length < before;
      }),
      update: jest.fn(async (id: string, host: string, label: string | null) => {
        const row = repoStore.find((e) => e.id === id);
        if (!row) return null;
        row.host = host;
        row.label = label;
        return row;
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        JwksHostAllowlistService,
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'JWKS_HOST_ALLOWLIST' ? envAllowlist : undefined) } },
        { provide: ScimLogger, useValue: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
        { provide: JWKS_HOST_ALLOWLIST_REPOSITORY, useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(JwksHostAllowlistService);
    await service.onModuleInit();
  }

  beforeEach(() => build());

  it('the effective union contains the well-known seed hosts out of the box', () => {
    for (const seed of WELL_KNOWN_JWKS_HOST_SEED) {
      expect(service.isAllowed(seed)).toBe(true);
    }
  });

  // The loop above iterates whatever the constant happens to contain, so it can
  // never notice a host being DROPPED from the seed. These name the Microsoft and
  // Google hosts explicitly, so removing one is a failing test rather than a
  // silent behaviour change.
  //
  // login.windows.net earned its own case: it is the v1 Entra JWKS host, it was
  // NOT seeded originally, and it had been added by hand to the persisted layer
  // on every long-lived estate. The 2026-08 cross-tenant migration carried every
  // endpoint, user, group and credential faithfully and still lost this host,
  // because no count-based check can see a missing allow-list entry. Seeding it
  // makes it a permanent floor; this test keeps it there.
  it.each([
    'login.microsoftonline.com',
    'login.windows.net',
    'login.microsoftonline.us',
    'login.chinacloudapi.cn',
    'login.partner.microsoftonline.cn',
    'www.googleapis.com',
    'accounts.google.com',
  ])('the seed permanently contains the well-known host %s', (host) => {
    expect(WELL_KNOWN_JWKS_HOST_SEED).toContain(host);
    expect(service.isAllowed(host)).toBe(true);
  });

  it('a v1 Entra JWKS URI is allowed without any admin configuration', () => {
    // The shape live-test.ps1 section 9z-AV builds, and the shape a token minted
    // through a v1 Entra endpoint carries.
    const v1JwksHost = new URL('https://login.windows.net/9751e42f-78f3-42f4-8b8a-6e73845aceae/discovery/v2.0/keys').hostname;
    expect(service.isAllowed(v1JwksHost)).toBe(true);
  });

  it('the effective union contains the env-configured host', () => {
    expect(service.isAllowed('custom-env.example.com')).toBe(true);
  });

  it('an unknown host is NOT allowed', () => {
    expect(service.isAllowed('evil.example')).toBe(false);
  });

  it('isAllowed is case- and whitespace-insensitive', () => {
    expect(service.isAllowed('  LOGIN.microsoftonline.COM ')).toBe(true);
  });

  it('addHost persists + hot-reloads the union so the host is allowed immediately', async () => {
    expect(service.isAllowed('new-idp.example.com')).toBe(false);
    await service.addHost('New-IdP.example.com');
    expect(service.isAllowed('new-idp.example.com')).toBe(true);
    expect(repo.add).toHaveBeenCalledWith('new-idp.example.com', null);
  });

  it('removeHost removes a persisted host from the union', async () => {
    await service.addHost('temp.example.com');
    expect(service.isAllowed('temp.example.com')).toBe(true);
    const { removed } = await service.removeHost('temp.example.com');
    expect(removed).toBe(true);
    expect(service.isAllowed('temp.example.com')).toBe(false);
  });

  it('R1: the well-known seed is prepopulated into the persisted table as editable rows', () => {
    const v = service.view();
    // Each compiled seed host now has a persisted entry (id + host) an admin can edit/remove.
    for (const seed of WELL_KNOWN_JWKS_HOST_SEED) {
      const entry = v.persistedEntries.find((e) => e.host === seed);
      expect(entry).toBeDefined();
      expect(entry?.id).toBeTruthy();
    }
  });

  it('R1: a prepopulated seed row is removable, but the host stays allowed via the compiled safety floor', async () => {
    const { removed } = await service.removeHost('login.microsoftonline.com');
    // The persisted seed row IS removed now (prepopulated), unlike the old compiled-only behavior.
    expect(removed).toBe(true);
    // Still allowed via the compiled seed floor (accidental removal cannot brick Entra auth).
    expect(service.isAllowed('login.microsoftonline.com')).toBe(true);
  });

  it('R1: updateHost edits a persisted entry by id and hot-reloads the union', async () => {
    await service.addHost('old-host.example.com');
    const entry = service.view().persistedEntries.find((e) => e.host === 'old-host.example.com');
    expect(entry).toBeDefined();
    const { updated } = await service.updateHost(entry!.id, 'new-host.example.com', 'renamed');
    expect(updated).toBe(true);
    expect(service.isAllowed('new-host.example.com')).toBe(true);
    expect(service.isAllowed('old-host.example.com')).toBe(false);
    const after = service.view().persistedEntries.find((e) => e.id === entry!.id);
    expect(after?.host).toBe('new-host.example.com');
    expect(after?.label).toBe('renamed');
  });

  it('R1: updateHost returns updated:false for an unknown id', async () => {
    const { updated } = await service.updateHost('no-such-id', 'whatever.example.com');
    expect(updated).toBe(false);
  });

  it('R1: patchHosts selectively adds AND removes in a single call', async () => {
    await service.addHost('to-remove.example.com');
    expect(service.isAllowed('to-remove.example.com')).toBe(true);
    const { added, removed } = await service.patchHosts(
      ['new-a.example.com', 'new-b.example.com'],
      ['to-remove.example.com'],
    );
    expect(added).toBe(2);
    expect(removed).toBe(1);
    expect(service.isAllowed('new-a.example.com')).toBe(true);
    expect(service.isAllowed('new-b.example.com')).toBe(true);
    expect(service.isAllowed('to-remove.example.com')).toBe(false);
  });

  it('R1: patchHosts add is idempotent (re-adding an existing host counts 0)', async () => {
    await service.addHost('already.example.com');
    const { added } = await service.patchHosts(['already.example.com'], []);
    expect(added).toBe(0);
    expect(service.isAllowed('already.example.com')).toBe(true);
  });

  it('view() exposes the three layers + the effective union', async () => {
    await service.addHost('persisted-one.example.com');
    const v = service.view();
    expect(v.seed).toEqual(expect.arrayContaining(['login.microsoftonline.com']));
    expect(v.env).toContain('custom-env.example.com');
    expect(v.persisted).toContain('persisted-one.example.com');
    expect(v.effective).toEqual(
      expect.arrayContaining(['login.microsoftonline.com', 'custom-env.example.com', 'persisted-one.example.com']),
    );
  });

  it('loads the persisted layer at startup (onModuleInit)', async () => {
    // Pre-seed the repo, then build a fresh service and init.
    repoStore = [{ id: 'x', host: 'preexisting.example.com', label: null, createdAt: new Date() }];
    const moduleRef = await Test.createTestingModule({
      providers: [
        JwksHostAllowlistService,
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: ScimLogger, useValue: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
        { provide: JWKS_HOST_ALLOWLIST_REPOSITORY, useValue: repo },
      ],
    }).compile();
    const fresh = moduleRef.get(JwksHostAllowlistService);
    await fresh.onModuleInit();
    expect(fresh.isAllowed('preexisting.example.com')).toBe(true);
  });
});
