import { Test, TestingModule } from '@nestjs/testing';
import { JwksPrewarmService } from './jwks-prewarm.service';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../domain/repositories/repository.tokens';

/**
 * W1.2 - the last Wave 1 item. Without a boot prefetch the FIRST WIF mint after
 * a deploy pays a cold outbound JWKS fetch on a user's request. W1.4 keeps the
 * cache warm once populated; nothing populated it at startup.
 */
describe('JwksPrewarmService (W1.2)', () => {
  let service: JwksPrewarmService;
  let validator: { prewarm: jest.Mock };
  let repo: { findAllActiveByType: jest.Mock };
  let logger: { info: jest.Mock; warn: jest.Mock; debug: jest.Mock };

  const wif = (id: string, jwksUri: unknown) => ({
    id,
    endpointId: `ep-${id}`,
    credentialType: 'wif',
    metadata: jwksUri === undefined ? null : { jwksUri },
    active: true,
  });

  beforeEach(async () => {
    validator = { prewarm: jest.fn().mockResolvedValue(undefined) };
    repo = { findAllActiveByType: jest.fn().mockResolvedValue([]) };
    logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwksPrewarmService,
        { provide: ExternalJwksValidatorService, useValue: validator },
        { provide: ScimLogger, useValue: logger },
        { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useValue: repo },
      ],
    }).compile();

    service = module.get(JwksPrewarmService);
  });

  it('W1.2-T1: prewarms every registered trust jwksUri at boot', async () => {
    repo.findAllActiveByType.mockResolvedValue([
      wif('a', 'https://login.microsoftonline.com/t1/discovery/v2.0/keys'),
      wif('b', 'https://login.microsoftonline.com/t2/discovery/v2.0/keys'),
    ]);

    const warmed = await service.onModuleInit();

    expect(repo.findAllActiveByType).toHaveBeenCalledWith('wif');
    expect(validator.prewarm).toHaveBeenCalledTimes(2);
    expect(warmed).toBe(2);
  });

  it('W1.2-T2: fetches each distinct host once, however many trusts share it', async () => {
    const shared = 'https://login.microsoftonline.com/t1/discovery/v2.0/keys';
    repo.findAllActiveByType.mockResolvedValue([wif('a', shared), wif('b', shared), wif('c', shared)]);

    const warmed = await service.onModuleInit();

    expect(validator.prewarm).toHaveBeenCalledTimes(1);
    expect(warmed).toBe(1);
  });

  it('W1.2-T3: skips trusts with a missing or non-string jwksUri', async () => {
    repo.findAllActiveByType.mockResolvedValue([
      wif('a', undefined),
      wif('b', ''),
      wif('c', 42),
      wif('d', 'https://login.microsoftonline.com/t1/discovery/v2.0/keys'),
    ]);

    const warmed = await service.onModuleInit();

    expect(validator.prewarm).toHaveBeenCalledTimes(1);
    expect(warmed).toBe(1);
  });

  it('W1.2-T4: a repository failure never breaks startup', async () => {
    repo.findAllActiveByType.mockRejectedValue(new Error('db down at boot'));

    await expect(service.onModuleInit()).resolves.toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('W1.2-T5: one unreachable IdP does not stop the others warming', async () => {
    repo.findAllActiveByType.mockResolvedValue([
      wif('a', 'https://unreachable.example/keys'),
      wif('b', 'https://login.microsoftonline.com/t2/discovery/v2.0/keys'),
    ]);
    validator.prewarm.mockImplementation((uri: string) =>
      uri.includes('unreachable') ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve(undefined),
    );

    await expect(service.onModuleInit()).resolves.toBe(2);
    expect(validator.prewarm).toHaveBeenCalledTimes(2);
  });

  /**
   * A boot-time action leaves no other trace. Without an unconditional log line
   * there is no way to distinguish "ran and found no trusts" from "never ran",
   * and a silently-inert feature is the failure mode this repo keeps hitting.
   */
  it('W1.2-T6: logs completion even when there are no trusts to warm', async () => {
    repo.findAllActiveByType.mockResolvedValue([]);

    await expect(service.onModuleInit()).resolves.toBe(0);

    const line = logger.info.mock.calls.find((c) => c[1] === 'JWKS prewarm complete');
    expect(line).toBeDefined();
    expect(line![2]).toMatchObject({ trusts: 0, distinctJwksUris: 0 });
  });
});
