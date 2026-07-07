/**
 * credential-envelope.spec.ts (WI-6) - verifies the envelope-encryption core:
 * round-trips, KEK/DEK independence, GCM tamper-detection, format shape.
 */
import {
  ENVELOPE_VERSION,
  generateKekSalt,
  deriveKekKey,
  generateDek,
  wrapDek,
  unwrapDek,
  encryptSecret,
  decryptSecret,
} from './credential-envelope';

describe('credential-envelope (WI-6)', () => {
  describe('deriveKekKey', () => {
    it('is deterministic for the same passphrase + salt', () => {
      const salt = generateKekSalt();
      const a = deriveKekKey('changeme-credential-kek', salt);
      const b = deriveKekKey('changeme-credential-kek', salt);
      expect(a.equals(b)).toBe(true);
      expect(a.length).toBe(32);
    });

    it('differs for a different salt', () => {
      const a = deriveKekKey('kek', generateKekSalt());
      const b = deriveKekKey('kek', generateKekSalt());
      expect(a.equals(b)).toBe(false);
    });

    it('differs for a different passphrase', () => {
      const salt = generateKekSalt();
      const a = deriveKekKey('kek-one', salt);
      const b = deriveKekKey('kek-two', salt);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('DEK wrap / unwrap', () => {
    it('round-trips a DEK through wrap + unwrap under the same KEK key', () => {
      const kekKey = deriveKekKey('kek', generateKekSalt());
      const dek = generateDek();
      const wrapped = unwrapDek(wrapDek(dek, kekKey), kekKey);
      expect(wrapped.equals(dek)).toBe(true);
    });

    it('a wrapped DEK cannot be unwrapped under a different KEK key', () => {
      const dek = generateDek();
      const wrapped = wrapDek(dek, deriveKekKey('kek-A', generateKekSalt()));
      expect(() => unwrapDek(wrapped, deriveKekKey('kek-B', generateKekSalt()))).toThrow();
    });

    it('a wrapped DEK is not the DEK in plaintext', () => {
      const dek = generateDek();
      const wrapped = wrapDek(dek, deriveKekKey('kek', generateKekSalt()));
      expect(wrapped).not.toContain(dek.toString('base64url'));
    });
  });

  describe('secret encrypt / decrypt', () => {
    it('round-trips a secret through the DEK', () => {
      const dek = generateDek();
      const secret = 's3T-base64url-secret-Wx9Yz0Ab1Cd2Ef3';
      expect(decryptSecret(encryptSecret(secret, dek), dek)).toBe(secret);
    });

    it('produces a versioned 4-part envelope', () => {
      const dek = generateDek();
      const env = encryptSecret('x', dek);
      const parts = env.split('.');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe(ENVELOPE_VERSION);
    });

    it('produces distinct ciphertext for the same plaintext (random IV)', () => {
      const dek = generateDek();
      expect(encryptSecret('same', dek)).not.toBe(encryptSecret('same', dek));
    });

    it('a secret encrypted under one DEK cannot be decrypted under another', () => {
      const env = encryptSecret('secret', generateDek());
      expect(() => decryptSecret(env, generateDek())).toThrow();
    });

    it('detects tampering (GCM auth tag)', () => {
      const dek = generateDek();
      const env = encryptSecret('secret', dek);
      const parts = env.split('.');
      // Flip a byte in the ciphertext segment.
      const ct = Buffer.from(parts[2], 'base64url');
      ct[0] = ct[0] ^ 0xff;
      parts[2] = ct.toString('base64url');
      expect(() => decryptSecret(parts.join('.'), dek)).toThrow();
    });

    it('rejects a malformed envelope', () => {
      expect(() => decryptSecret('not-an-envelope', generateDek())).toThrow(/Malformed envelope/);
    });

    it('round-trips unicode + long secrets', () => {
      const dek = generateDek();
      const secret = 'ключ-🔐-' + 'x'.repeat(500);
      expect(decryptSecret(encryptSecret(secret, dek), dek)).toBe(secret);
    });
  });

  describe('full envelope hierarchy', () => {
    it('KEK -> wrapped DEK -> encrypted secret round-trips end-to-end', () => {
      const passphrase = 'changeme-credential-kek';
      const salt = generateKekSalt();
      const kekKey = deriveKekKey(passphrase, salt);

      // Provision: generate DEK, wrap it, encrypt a secret under it.
      const dek = generateDek();
      const wrappedDek = wrapDek(dek, kekKey);
      const secretEnvelope = encryptSecret('the-retained-secret', dek);

      // Recover (as if from a DB dump + env KEK): re-derive KEK key from the
      // stored salt, unwrap the DEK, decrypt the secret.
      const recoveredKekKey = deriveKekKey(passphrase, salt);
      const recoveredDek = unwrapDek(wrappedDek, recoveredKekKey);
      expect(decryptSecret(secretEnvelope, recoveredDek)).toBe('the-retained-secret');
    });
  });
});
