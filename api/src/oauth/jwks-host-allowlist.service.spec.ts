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

  it('a seed host cannot be removed (not in the persisted layer) but stays allowed', async () => {
    const { removed } = await service.removeHost('login.microsoftonline.com');
    expect(removed).toBe(false);
    // Still allowed via the seed layer.
    expect(service.isAllowed('login.microsoftonline.com')).toBe(true);
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
