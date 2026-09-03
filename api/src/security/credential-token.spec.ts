import * as crypto from 'crypto';
import {
  CREDENTIAL_TOKEN_PREFIX,
  DEFAULT_CREDENTIAL_PEPPER,
  HASH_ALGO_HMAC_V1,
  OAUTH_CLIENT_SECRET_PREFIX,
  computeSecretHash,
  isDefaultPepper,
  loadCredentialPepper,
  mintCredentialToken,
  mintOAuthClientSecret,
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

  /**
   * P1-H - the HYBRID oauth_client format.
   *
   * An oauth_client secret keeps its readable `client-secret-` prefix (an
   * explicit operator request) and gains a lookup key, so it can be verified
   * with one indexed read like a bearer credential:
   *
   *     client-secret-<24 hex lookupKey>-<43 char base64url secret>
   *
   * The key is HEX for the same reason it is on the bearer format, and the point
   * is sharper here: the separator is `-`, and base64url CONTAINS `-`. A hex key
   * cannot contain `-`, so the boundary is unambiguous; the secret is simply
   * everything after it.
   */
  describe('P1-H: hybrid oauth_client secret', () => {
    it('P1-H1: round-trips through the shared parser', () => {
      const minted = mintOAuthClientSecret();
      const parsed = parseCredentialToken(minted.token);
      expect(parsed).not.toBeNull();
      expect(parsed!.lookupKey).toBe(minted.lookupKey);
      expect(parsed!.secret).toBe(minted.secret);
    });

    it('P1-H2: keeps the readable prefix an operator asked for', () => {
      expect(mintOAuthClientSecret().token.startsWith(OAUTH_CLIENT_SECRET_PREFIX)).toBe(true);
    });

    it('P1-H3: carries the same 256-bit entropy as a bearer secret', () => {
      const { secret } = mintOAuthClientSecret();
      expect(Buffer.from(secret, 'base64url').length).toBeGreaterThanOrEqual(32);
    });

    it('P1-H4: the secret is stored only as a peppered HMAC', () => {
      const minted = mintOAuthClientSecret();
      expect(minted.secretHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(minted.secretHash).not.toContain(minted.secret);
      expect(minted.hashAlgo).toBe(HASH_ALGO_HMAC_V1);
    });

    it('P1-H5: a secret containing the "-" separator still round-trips intact', () => {
      // base64url includes `-`, so this is the failure mode the hex key exists to
      // prevent. Generate until we actually produce one rather than assuming.
      let minted = mintOAuthClientSecret();
      for (let i = 0; i < 200 && !minted.secret.includes('-'); i++) minted = mintOAuthClientSecret();
      expect(minted.secret).toContain('-');
      expect(parseCredentialToken(minted.token)!.secret).toBe(minted.secret);
    });

    it('P1-H6: NEGATIVE CONTROL - a LEGACY client-secret-<uuid> does NOT parse', () => {
      // This is the assertion the whole migration rests on. A legacy secret must
      // fall through to the bcrypt path; if it parsed here it would be looked up
      // by a bogus key, miss, and stop authenticating - a silent outage.
      const legacy = 'client-secret-550e8400-e29b-41d4-a716-446655440000';
      expect(parseCredentialToken(legacy)).toBeNull();
    });

    it('P1-H7: many real UUIDs never false-match the hybrid shape', () => {
      // A UUID's longest run of hex is 12 chars (the final group), and the key
      // needs 24, so no UUID can satisfy it. Asserted over real values rather
      // than argued, because the cost of being wrong is a customer outage.
      for (let i = 0; i < 500; i++) {
        expect(parseCredentialToken(`client-secret-${crypto.randomUUID()}`)).toBeNull();
      }
    });

    it('P1-H8: the two formats never collide', () => {
      const bearer = mintCredentialToken();
      const oauth = mintOAuthClientSecret();
      expect(bearer.token.startsWith(CREDENTIAL_TOKEN_PREFIX)).toBe(true);
      expect(oauth.token.startsWith(OAUTH_CLIENT_SECRET_PREFIX)).toBe(true);
      // Each parses to its OWN key, never the other's.
      expect(parseCredentialToken(bearer.token)!.lookupKey).toBe(bearer.lookupKey);
      expect(parseCredentialToken(oauth.token)!.lookupKey).toBe(oauth.lookupKey);
      expect(bearer.lookupKey).not.toBe(oauth.lookupKey);
    });

    it('P1-H9: verification works through the shared hash functions', () => {
      const minted = mintOAuthClientSecret();
      expect(verifySecretHash(minted.secret, minted.secretHash)).toBe(true);
      expect(verifySecretHash('wrong', minted.secretHash)).toBe(false);
    });
  });
});
