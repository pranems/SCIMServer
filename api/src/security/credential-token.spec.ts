import {
  CREDENTIAL_TOKEN_PREFIX,
  DEFAULT_CREDENTIAL_PEPPER,
  HASH_ALGO_HMAC_V1,
  computeSecretHash,
  isDefaultPepper,
  loadCredentialPepper,
  mintCredentialToken,
  parseCredentialToken,
  verifySecretHash,
} from './credential-token';

/**
 * P1 - keyed credential lookup primitives.
 *
 * See docs/auth/P1_KEYED_CREDENTIAL_LOOKUP_DESIGN.md. The point of this module
 * is that a presented token carries a PUBLIC identifier, so the server can find
 * the one row it belongs to instead of bcrypt-comparing against every active
 * credential on the endpoint (measured 287 ms each, x N).
 */
describe('credential-token (P1)', () => {
  describe('mint + parse round-trip', () => {
    it('P1-T1: a minted token parses back to the same lookupKey and secret', () => {
      const minted = mintCredentialToken();
      const parsed = parseCredentialToken(minted.token);
      expect(parsed).not.toBeNull();
      expect(parsed!.lookupKey).toBe(minted.lookupKey);
      expect(parsed!.secret).toBe(minted.secret);
    });

    it('P1-T2: the token carries the greppable prefix, so secret scanners can find it', () => {
      expect(mintCredentialToken().token.startsWith(`${CREDENTIAL_TOKEN_PREFIX}_`)).toBe(true);
    });

    it('P1-T3: the SECRET is never stored - only its hash', () => {
      const minted = mintCredentialToken();
      expect(minted.secretHash).not.toContain(minted.secret);
      expect(minted.secretHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    });

    it('P1-T4: every mint is unique in both key and secret', () => {
      const a = mintCredentialToken();
      const b = mintCredentialToken();
      expect(a.lookupKey).not.toBe(b.lookupKey);
      expect(a.secret).not.toBe(b.secret);
    });

    it('P1-T5: the secret carries at least 256 bits of entropy', () => {
      // This is the property that makes a fast hash correct here rather than a
      // slow KDF - the design rests on it, so it is asserted rather than assumed.
      const { secret } = mintCredentialToken();
      expect(Buffer.from(secret, 'base64url').length).toBeGreaterThanOrEqual(32);
    });

    it('P1-T6: the lookupKey is NOT derivable from the secret and vice versa', () => {
      // They must be independent random values; if the key were a prefix of the
      // secret, publishing the key would leak secret bits.
      const { lookupKey, secret } = mintCredentialToken();
      expect(secret.includes(lookupKey)).toBe(false);
      expect(lookupKey.includes(secret)).toBe(false);
    });
  });

  describe('parsing rejects anything that is not our format', () => {
    // Each of these must return null rather than throw - the authenticator uses
    // a null result to mean "fall through to the legacy path", so a throw here
    // would turn a legacy token into a 500.
    const notOurs = [
      ['empty', ''],
      ['a legacy opaque secret', 'K7bTqM4wZ2xLpR9vN3cF8dH1jS5aG0yE6uI2oP4wQ8s'],
      ['a JWT', 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.sig'],
      ['wrong prefix', 'other_abc_def'],
      ['prefix only', 'scim_'],
      ['missing secret', 'scim_abc'],
      ['empty key', 'scim__secret'],
      ['empty secret', 'scim_abc_'],
      ['non-base64url key', 'scim_has spaces_secret'],
    ] as const;

    for (const [label, value] of notOurs) {
      it(`P1-T7: returns null for ${label}`, () => {
        expect(parseCredentialToken(value)).toBeNull();
      });
    }

    it('P1-T8: a secret containing the separator still round-trips', () => {
      // base64url excludes `_`... but asserting it means a future alphabet change
      // cannot silently truncate secrets at the first separator.
      const minted = mintCredentialToken();
      const parsed = parseCredentialToken(minted.token);
      expect(parsed!.secret).toBe(minted.secret);
    });
  });

  describe('verification', () => {
    it('P1-T9: the correct secret verifies', () => {
      const { secret, secretHash } = mintCredentialToken();
      expect(verifySecretHash(secret, secretHash)).toBe(true);
    });

    it('P1-T10: a wrong secret does not verify', () => {
      const { secretHash } = mintCredentialToken();
      const other = mintCredentialToken();
      expect(verifySecretHash(other.secret, secretHash)).toBe(false);
    });

    it('P1-T11: verification is peppered - the same secret fails under a different pepper', () => {
      // This is what preserves the database-dump resistance bcrypt gave for free:
      // the stored hash alone is not enough to verify offline.
      const { secret } = mintCredentialToken();
      const hashA = computeSecretHash(secret, 'pepper-A');
      const hashB = computeSecretHash(secret, 'pepper-B');
      expect(hashA).not.toBe(hashB);
      expect(verifySecretHash(secret, hashA, 'pepper-B')).toBe(false);
      expect(verifySecretHash(secret, hashA, 'pepper-A')).toBe(true);
    });

    it('P1-T12: a malformed stored hash returns false rather than throwing', () => {
      // timingSafeEqual throws on length mismatch; a corrupt row must not 500.
      const { secret } = mintCredentialToken();
      expect(verifySecretHash(secret, '')).toBe(false);
      expect(verifySecretHash(secret, 'not-hex')).toBe(false);
      expect(verifySecretHash(secret, 'aa')).toBe(false);
    });

    it('P1-T13: hashing is deterministic for a given secret + pepper', () => {
      const { secret } = mintCredentialToken();
      expect(computeSecretHash(secret, 'p')).toBe(computeSecretHash(secret, 'p'));
    });
  });

  describe('pepper loading follows the CREDENTIAL_KEK convention', () => {
    const ORIGINAL = process.env.CREDENTIAL_HASH_PEPPER;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.CREDENTIAL_HASH_PEPPER;
      else process.env.CREDENTIAL_HASH_PEPPER = ORIGINAL;
    });

    it('P1-T14: falls back to the public default when unset or blank', () => {
      expect(loadCredentialPepper({})).toBe(DEFAULT_CREDENTIAL_PEPPER);
      expect(loadCredentialPepper({ CREDENTIAL_HASH_PEPPER: '   ' })).toBe(DEFAULT_CREDENTIAL_PEPPER);
    });

    it('P1-T15: uses the configured pepper when set', () => {
      expect(loadCredentialPepper({ CREDENTIAL_HASH_PEPPER: ' real ' })).toBe('real');
    });

    it('P1-T16: reports whether the default is still in effect', () => {
      // Same honesty as isDefaultKek: while the pepper is the public default the
      // dump-resistance is cosmetic, and an operator deserves to be told.
      expect(isDefaultPepper({})).toBe(true);
      expect(isDefaultPepper({ CREDENTIAL_HASH_PEPPER: 'real' })).toBe(false);
    });
  });

  it('P1-T17: the algorithm discriminator is stable', () => {
    // Persisted in every row; changing it silently would strand existing rows.
    expect(HASH_ALGO_HMAC_V1).toBe('hmac-sha256-v1');
  });
});
