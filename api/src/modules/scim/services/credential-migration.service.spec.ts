import { Test, TestingModule } from '@nestjs/testing';
import { CredentialMigrationService } from './credential-migration.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { HASH_ALGO_BCRYPT, HASH_ALGO_HMAC_V1 } from '../../../security/credential-token';

/**
 * P1 phase 4 - make the legacy credential tail MEASURABLE.
 *
 * Phase 5 (delete the bcrypt scan) is one-way, so it must be gated on a number
 * rather than on elapsed time. These tests pin what that number counts.
 */
describe('CredentialMigrationService (P1 phase 4)', () => {
  let service: CredentialMigrationService;
  let credRepo: { countByHashAlgo: jest.Mock };
  let endpointService: { listEndpoints: jest.Mock };

  const EP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const EP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeEach(async () => {
    credRepo = { countByHashAlgo: jest.fn().mockResolvedValue([]) };
    endpointService = {
      listEndpoints: jest.fn().mockResolvedValue({
        totalResults: 2,
        endpoints: [
          { id: EP_A, name: 'endpoint-a' },
          { id: EP_B, name: 'endpoint-b' },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialMigrationService,
        { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useValue: credRepo },
        { provide: EndpointService, useValue: endpointService },
      ],
    }).compile();

    service = module.get(CredentialMigrationService);
  });

  it('P4-S1: splits the population by hash algorithm', async () => {
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 2 },
      { endpointId: EP_A, hashAlgo: HASH_ALGO_HMAC_V1, active: true, count: 5 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.legacy.total).toBe(2);
    expect(report.keyed.total).toBe(5);
    expect(report.total).toBe(7);
  });

  it('P4-S2: an INACTIVE legacy credential still counts, because it can be reactivated', async () => {
    // This is the whole reason the gate is not "active legacy === 0". The
    // activate route can bring a deactivated credential back; if phase 5 had
    // already deleted the bcrypt verifier, it would return and silently fail
    // to authenticate. So the tail we must drain includes dormant rows.
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, hashAlgo: HASH_ALGO_BCRYPT, active: false, count: 1 },
      { endpointId: EP_A, hashAlgo: HASH_ALGO_HMAC_V1, active: true, count: 9 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.legacy.total).toBe(1);
    expect(report.legacy.active).toBe(0);
    expect(report.legacy.inactive).toBe(1);
    expect(report.readyToRetireLegacyPath).toBe(false);
  });

  it('P4-S3: the phase-5 gate opens only when the legacy count is zero', async () => {
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, hashAlgo: HASH_ALGO_HMAC_V1, active: true, count: 4 },
      { endpointId: EP_B, hashAlgo: HASH_ALGO_HMAC_V1, active: false, count: 2 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.legacy.total).toBe(0);
    expect(report.readyToRetireLegacyPath).toBe(true);
    expect(report.endpoints).toHaveLength(0);
  });

  it('P4-S4: the per-endpoint list is the work queue - only endpoints still holding legacy rows', async () => {
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 3 },
      { endpointId: EP_B, hashAlgo: HASH_ALGO_HMAC_V1, active: true, count: 7 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.endpoints).toHaveLength(1);
    expect(report.endpoints[0]).toMatchObject({
      endpointId: EP_A,
      endpointName: 'endpoint-a',
      legacyTotal: 3,
    });
  });

  it('P4-S5: a row with no hashAlgo counts as LEGACY, mirroring the column default', async () => {
    // The column is NOT NULL DEFAULT 'bcrypt', but the inmemory backend and any
    // hand-built row can omit it. Defaulting the other way would under-report
    // the tail and open the one-way gate early.
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, hashAlgo: undefined, active: true, count: 2 },
      { endpointId: EP_B, hashAlgo: null, active: true, count: 1 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.legacy.total).toBe(3);
    expect(report.keyed.total).toBe(0);
    expect(report.readyToRetireLegacyPath).toBe(false);
  });

  it('P4-S6: an unrecognised algorithm is NOT silently treated as migrated', async () => {
    // Fail closed: an algo we do not know about must not open the one-way gate.
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, hashAlgo: 'argon2-someday', active: true, count: 1 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.readyToRetireLegacyPath).toBe(false);
    expect(report.byAlgo['argon2-someday']).toBe(1);
  });

  it('P4-S7: an endpoint the name lookup cannot resolve still appears in the queue', async () => {
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 1 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.endpoints).toHaveLength(1);
    expect(report.endpoints[0].endpointName).toBeNull();
  });

  it('P4-S8: byAlgo reports raw counts per algorithm for the whole estate', async () => {
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 2 },
      { endpointId: EP_B, hashAlgo: HASH_ALGO_BCRYPT, active: false, count: 3 },
      { endpointId: EP_A, hashAlgo: HASH_ALGO_HMAC_V1, active: true, count: 4 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.byAlgo[HASH_ALGO_BCRYPT]).toBe(5);
    expect(report.byAlgo[HASH_ALGO_HMAC_V1]).toBe(4);
    expect(report.endpoints).toHaveLength(2);
  });

  it('P4-S9: a WIF trust is SECRETLESS, not legacy - it would block the gate forever', async () => {
    // Found by running the report against a live node: WIF rows are created with
    // credentialHash '' and no hashAlgo, so the column default makes them look
    // like bcrypt. But a WIF trust has no secret to migrate and never touches
    // the bcrypt verifier - it is checked as a JWT against a JWKS. Counting it
    // as legacy produces a phase-5 gate that can NEVER open.
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, credentialType: 'wif', hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 3 },
      { endpointId: EP_B, credentialType: 'bearer', hashAlgo: HASH_ALGO_HMAC_V1, active: true, count: 2 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.legacy.total).toBe(0);
    expect(report.secretless.total).toBe(3);
    expect(report.readyToRetireLegacyPath).toBe(true);
    expect(report.endpoints).toHaveLength(0);
  });

  it('P4-S10: a WIF trust does not mask a real bearer credential still on bcrypt', async () => {
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, credentialType: 'wif', hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 3 },
      { endpointId: EP_A, credentialType: 'bearer', hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 1 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.legacy.total).toBe(1);
    expect(report.secretless.total).toBe(3);
    expect(report.readyToRetireLegacyPath).toBe(false);
    expect(report.endpoints).toHaveLength(1);
    expect(report.endpoints[0].legacyTotal).toBe(1);
  });

  it('P4-S11: the totals account for every row, secretless included', async () => {
    credRepo.countByHashAlgo.mockResolvedValue([
      { endpointId: EP_A, credentialType: 'wif', hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 3 },
      { endpointId: EP_A, credentialType: 'bearer', hashAlgo: HASH_ALGO_BCRYPT, active: true, count: 1 },
      { endpointId: EP_B, credentialType: 'bearer', hashAlgo: HASH_ALGO_HMAC_V1, active: true, count: 6 },
    ]);

    const report = await service.getMigrationStatus();

    expect(report.total).toBe(10);
    expect(report.legacy.total + report.keyed.total + report.secretless.total).toBe(report.total);
  });
});
