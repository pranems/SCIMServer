import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';
import { WifTrustCacheService } from './wif-trust-cache.service';

describe('WifTrustCacheService (W3.5)', () => {
  let findActiveByEndpointAndType: jest.Mock;
  let service: WifTrustCacheService;
  const originalCacheTtl = process.env.WIF_TRUST_CACHE_TTL_MS;
  const originalCacheMaxEndpoints = process.env.WIF_TRUST_CACHE_MAX_ENDPOINTS;

  const credential = (
    id: string,
    expectedIssuer: string,
    expiresAt: Date | null = null,
  ): EndpointCredentialModel => ({
    id,
    endpointId: 'ep-1',
    credentialType: 'wif',
    credentialHash: '',
    label: id,
    metadata: { expectedIssuer },
    secretEnvelope: null,
    active: true,
    createdAt: new Date(),
    expiresAt,
  });

  beforeEach(() => {
    delete process.env.WIF_TRUST_CACHE_TTL_MS;
    delete process.env.WIF_TRUST_CACHE_MAX_ENDPOINTS;
    findActiveByEndpointAndType = jest.fn().mockResolvedValue([
      credential('trust-a', 'https://issuer-a'),
      credential('trust-b', 'https://issuer-b'),
    ]);
    service = new WifTrustCacheService({ findActiveByEndpointAndType } as never);
  });

  afterAll(() => {
    if (originalCacheTtl === undefined) delete process.env.WIF_TRUST_CACHE_TTL_MS;
    else process.env.WIF_TRUST_CACHE_TTL_MS = originalCacheTtl;
    if (originalCacheMaxEndpoints === undefined) delete process.env.WIF_TRUST_CACHE_MAX_ENDPOINTS;
    else process.env.WIF_TRUST_CACHE_MAX_ENDPOINTS = originalCacheMaxEndpoints;
  });

  it('loads once and reuses the compiled per-endpoint trust set on a warm read', async () => {
    const first = await service.get('ep-1');
    const second = await service.get('ep-1');

    expect(findActiveByEndpointAndType).toHaveBeenCalledTimes(1);
    expect(findActiveByEndpointAndType).toHaveBeenCalledWith('ep-1', 'wif');
    expect(second).toBe(first);
    expect(first.byIssuer.get('https://issuer-b')?.[0].id).toBe('trust-b');
  });

  it('reloads the trust set after endpoint invalidation', async () => {
    await service.get('ep-1');
    service.invalidate('ep-1');
    await service.get('ep-1');

    expect(findActiveByEndpointAndType).toHaveBeenCalledTimes(2);
  });

  it('does not let an in-flight stale load survive invalidation', async () => {
    let resolveStale!: (credentials: EndpointCredentialModel[]) => void;
    findActiveByEndpointAndType
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce([credential('trust-new', 'https://issuer-new')]);

    const staleRead = service.get('ep-1');
    service.invalidate('ep-1');
    const freshRead = service.get('ep-1');
    resolveStale([credential('trust-old', 'https://issuer-old')]);

    await expect(freshRead).resolves.toMatchObject({
      credentials: [expect.objectContaining({ id: 'trust-new' })],
    });
    await staleRead;
    const warmRead = await service.get('ep-1');

    expect(findActiveByEndpointAndType).toHaveBeenCalledTimes(2);
    expect(warmRead.credentials[0].id).toBe('trust-new');
  });

  it('reloads no later than the earliest cached credential expiry', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    findActiveByEndpointAndType.mockResolvedValue([
      credential('trust-expiring', 'https://issuer-expiring', new Date(1_100)),
    ]);

    await service.get('ep-1');
    now.mockReturnValue(1_100);
    await service.get('ep-1');

    expect(findActiveByEndpointAndType).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('bounds cached endpoint entries and evicts the least recently used endpoint', async () => {
    for (let index = 0; index <= 256; index += 1) {
      await service.get(`ep-${index}`);
    }
    await service.get('ep-0');

    expect(findActiveByEndpointAndType).toHaveBeenCalledTimes(258);
  });

  it('invalidates the endpoint cache when the endpoint is deleted', async () => {
    await service.get('ep-1');
    service.handleEndpointDeleted({ endpointId: 'ep-1' });
    await service.get('ep-1');

    expect(findActiveByEndpointAndType).toHaveBeenCalledTimes(2);
  });
});
