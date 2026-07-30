/**
 * credential-encryption.service.spec.ts (WI-6) - the DEK lifecycle + encrypt/
 * decrypt round-trip against a fake DEK repository, plus KEK status.
 */
import { CredentialEncryptionService } from './credential-encryption.service';
import type {
  ICredentialDekRepository,
  CredentialDekModel,
  CredentialDekCreateInput,
} from '../domain/repositories/credential-dek.repository.interface';

/** A minimal in-memory DEK repo double. */
class FakeDekRepo implements ICredentialDekRepository {
  rows: CredentialDekModel[] = [];
  createCalls = 0;

  async findActive(): Promise<CredentialDekModel | null> {
    return this.rows.find((r) => r.active) ?? null;
  }

  async create(input: CredentialDekCreateInput): Promise<CredentialDekModel> {
    this.createCalls += 1;
    const model: CredentialDekModel = {
      id: `dek-${this.rows.length + 1}`,
      wrappedDek: input.wrappedDek,
      kekSalt: input.kekSalt,
      active: true,
      createdAt: new Date(),
    };
    this.rows.push(model);
    return model;
  }
}

describe('CredentialEncryptionService (WI-6)', () => {
  const ORIGINAL_KEK = process.env.CREDENTIAL_KEK;

  afterEach(() => {
    if (ORIGINAL_KEK === undefined) delete process.env.CREDENTIAL_KEK;
    else process.env.CREDENTIAL_KEK = ORIGINAL_KEK;
  });

  it('provisions + persists a DEK on first init', async () => {
    const repo = new FakeDekRepo();
    const svc = new CredentialEncryptionService(repo);
    await svc.onModuleInit();
    expect(repo.createCalls).toBe(1);
    expect(repo.rows).toHaveLength(1);
    expect(svc.isReady()).toBe(true);
    // The persisted DEK is wrapped, not plaintext.
    expect(repo.rows[0].wrappedDek).toMatch(/^v1\./);
    expect(repo.rows[0].kekSalt.length).toBeGreaterThan(0);
  });

  it('round-trips a secret through encrypt + decrypt', async () => {
    const svc = new CredentialEncryptionService(new FakeDekRepo());
    await svc.onModuleInit();
    const secret = 's3T-base64url-secret-Wx9Yz0Ab1Cd2Ef3';
    expect(svc.decrypt(svc.encrypt(secret))).toBe(secret);
  });

  it('does NOT re-provision when an active DEK already exists', async () => {
    const repo = new FakeDekRepo();
    // First service provisions the DEK.
    const first = new CredentialEncryptionService(repo);
    await first.onModuleInit();
    const provisioned = repo.rows[0];

    // A second service (same repo + same default KEK) loads the existing DEK.
    const second = new CredentialEncryptionService(repo);
    await second.onModuleInit();
    expect(repo.createCalls).toBe(1); // no new DEK

    // The second service can decrypt what the first encrypted (same DEK).
    const env = first.encrypt('shared-secret');
    expect(second.decrypt(env)).toBe('shared-secret');
    expect(provisioned).toBeDefined();
  });

  it('a secret encrypted under KEK-A cannot be decrypted after a KEK change (blast radius)', async () => {
    const repo = new FakeDekRepo();
    process.env.CREDENTIAL_KEK = 'kek-A';
    const withA = new CredentialEncryptionService(repo);
    await withA.onModuleInit();
    const envelope = withA.encrypt('retained');

    // Simulate a redeploy with a DIFFERENT KEK against the SAME persisted DEK.
    process.env.CREDENTIAL_KEK = 'kek-B';
    const withB = new CredentialEncryptionService(repo);
    // Init does not throw (it logs + continues); the DEK simply cannot unwrap.
    await withB.onModuleInit();
    expect(withB.isReady()).toBe(false);
    expect(() => withB.decrypt(envelope)).toThrow(/unavailable/);
  });

  it('reports KEK status (default vs configured)', async () => {
    delete process.env.CREDENTIAL_KEK;
    const def = new CredentialEncryptionService(new FakeDekRepo());
    await def.onModuleInit();
    expect(def.getKekStatus()).toEqual({ configured: true, isDefault: true });

    process.env.CREDENTIAL_KEK = 'private-prod-kek';
    const custom = new CredentialEncryptionService(new FakeDekRepo());
    await custom.onModuleInit();
    expect(custom.getKekStatus()).toEqual({ configured: true, isDefault: false });
  });

  it('throws a clear error when encrypt is called before the DEK is ready', () => {
    const svc = new CredentialEncryptionService(new FakeDekRepo());
    // No onModuleInit called.
    expect(() => svc.encrypt('x')).toThrow(/unavailable/);
    expect(svc.isReady()).toBe(false);
  });
});
