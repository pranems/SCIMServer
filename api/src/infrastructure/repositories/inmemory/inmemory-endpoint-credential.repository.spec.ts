import { InMemoryEndpointCredentialRepository } from './inmemory-endpoint-credential.repository';

/**
 * W1.2 - `findAllActiveByType` is the first cross-endpoint query on this
 * repository, so its filters are new behavior rather than a variation of an
 * existing one. The Prisma sibling is exercised on every E2E boot, because the
 * JWKS prewarm calls this method during `onModuleInit`.
 */
describe('InMemoryEndpointCredentialRepository - findAllActiveByType (W1.2)', () => {
  let repo: InMemoryEndpointCredentialRepository;

  const seed = async (
    over: Partial<{ endpointId: string; credentialType: string; active: boolean; expiresAt: Date | null }>,
  ) => {
    const created = await repo.create({
      endpointId: over.endpointId ?? 'ep-1',
      credentialType: over.credentialType ?? 'wif',
      credentialHash: 'hash',
      metadata: { jwksUri: 'https://idp.example/keys' },
      expiresAt: over.expiresAt ?? null,
    });
    if (over.active === false) await repo.deactivate(created.id);
    return created;
  };

  beforeEach(() => {
    repo = new InMemoryEndpointCredentialRepository();
  });

  it('returns matching credentials across DIFFERENT endpoints', async () => {
    await seed({ endpointId: 'ep-1' });
    await seed({ endpointId: 'ep-2' });

    const found = await repo.findAllActiveByType('wif');

    expect(found).toHaveLength(2);
    expect(found.map((c) => c.endpointId).sort()).toEqual(['ep-1', 'ep-2']);
  });

  it('filters by credential type', async () => {
    await seed({ credentialType: 'wif' });
    await seed({ credentialType: 'bearer' });
    await seed({ credentialType: 'oauth_client' });

    const found = await repo.findAllActiveByType('wif');

    expect(found).toHaveLength(1);
    expect(found[0].credentialType).toBe('wif');
  });

  it('excludes deactivated credentials', async () => {
    await seed({ active: true });
    await seed({ active: false });

    expect(await repo.findAllActiveByType('wif')).toHaveLength(1);
  });

  it('excludes expired credentials but keeps null and future expiry', async () => {
    await seed({ expiresAt: new Date(Date.now() - 60_000) });
    await seed({ expiresAt: new Date(Date.now() + 60_000) });
    await seed({ expiresAt: null });

    expect(await repo.findAllActiveByType('wif')).toHaveLength(2);
  });

  it('returns an empty array rather than throwing when nothing matches', async () => {
    await expect(repo.findAllActiveByType('wif')).resolves.toEqual([]);
  });
});
