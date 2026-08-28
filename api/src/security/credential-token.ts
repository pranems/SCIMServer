import * as crypto from 'crypto';

/**
 * credential-token.ts (P1) - keyed credential tokens.
 *
 * See docs/auth/P1_KEYED_CREDENTIAL_LOOKUP_DESIGN.md.
 *
 * A per-endpoint credential used to be an opaque random secret stored as a
 * bcrypt hash. Because the token carried nothing identifying, verification had
 * to bcrypt-compare it against EVERY active credential on the endpoint -
 * measured at 287 ms per compare, so 5 credentials cost 1.4 s and 25 cost 7.2 s,
 * on a path reachable by an UNAUTHENTICATED caller.
 *
 * The token now carries a PUBLIC lookup key, so the server finds exactly one row
 * and performs exactly one comparison:
 *
 *     scim_<lookupKey>_<secret>
 *
 * WHY A FAST HASH IS CORRECT HERE. bcrypt is deliberately slow to make
 * brute-forcing a HUMAN-CHOSEN password expensive. This secret is 32 random
 * bytes - 256 bits, no dictionary, no reuse, no human pattern - so a slow KDF
 * buys nothing against the only attack it was designed to stop. HMAC-SHA256 with
 * a server-side pepper is the same choice GitHub, Stripe and AWS make for API
 * tokens. The pepper preserves the one property bcrypt did give us: a dump of
 * the credentials table alone is not enough to verify tokens offline.
 */

/** Greppable prefix so secret scanners (GitHub, trufflehog) can spot a leak. */
export const CREDENTIAL_TOKEN_PREFIX = 'scim';

/** Persisted in `hashAlgo`; changing it would strand existing rows. */
export const HASH_ALGO_HMAC_V1 = 'hmac-sha256-v1';

/** Persisted in `hashAlgo` for pre-P1 rows still verified with bcrypt. */
export const HASH_ALGO_BCRYPT = 'bcrypt';

/** Public default, same honesty as DEFAULT_CREDENTIAL_KEK: documented, not secret. */
export const DEFAULT_CREDENTIAL_PEPPER = 'changeme-credential-pepper';

/**
 * Stored in the legacy `credentialHash` column for P1 rows.
 *
 * That column is NOT NULL and belongs to the bcrypt verifier, which never runs
 * for a keyed row (the scan skips `hashAlgo = 'hmac-sha256-v1'`). A
 * self-describing placeholder is better than a second copy of the secret
 * material, and it is not a valid bcrypt hash, so even a mis-routed compare
 * cannot match.
 */
export const P1_KEYED_HASH_PLACEHOLDER = 'p1-keyed-see-secretHash';

const LOOKUP_KEY_BYTES = 12;
const SECRET_BYTES = 32;

/**
 * The lookup key is HEX, not base64url, and that is deliberate: the base64url
 * alphabet includes `_`, which is our separator, so a key containing `_` would
 * split ambiguously and truncate. Hex cannot collide. The SECRET stays base64url
 * (denser) because it is the last field - everything after the second `_`.
 */
const TOKEN_RE = new RegExp(`^${CREDENTIAL_TOKEN_PREFIX}_([0-9a-f]+)_([A-Za-z0-9_\\-]+)$`);

export interface MintedCredentialToken {
  /** The full value handed to the caller ONCE. Never stored. */
  token: string;
  /** Public identifier, stored and uniquely indexed - this is what makes it O(1). */
  lookupKey: string;
  /** The secret half. Never stored; only `secretHash` is. */
  secret: string;
  /** HMAC-SHA256(pepper, secret), hex. */
  secretHash: string;
  hashAlgo: typeof HASH_ALGO_HMAC_V1;
}

/**
 * The pepper in effect: `CREDENTIAL_HASH_PEPPER`, else the public default.
 * Never throws - mirrors `loadCredentialKek` so the system works out of the box.
 */
export function loadCredentialPepper(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CREDENTIAL_HASH_PEPPER;
  if (raw === undefined) return DEFAULT_CREDENTIAL_PEPPER;
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_CREDENTIAL_PEPPER : trimmed;
}

/** Whether the pepper is still the public default (dump-resistance is cosmetic). */
export function isDefaultPepper(env: NodeJS.ProcessEnv = process.env): boolean {
  return loadCredentialPepper(env) === DEFAULT_CREDENTIAL_PEPPER;
}

export function computeSecretHash(secret: string, pepper: string = loadCredentialPepper()): string {
  return crypto.createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

/** Constant-time compare of the DIGESTS, so lengths always match. */
export function verifySecretHash(
  secret: string,
  storedHash: string,
  pepper: string = loadCredentialPepper(),
): boolean {
  if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const expected = Buffer.from(computeSecretHash(secret, pepper), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function mintCredentialToken(pepper: string = loadCredentialPepper()): MintedCredentialToken {
  // Independent random values: deriving one from the other would leak secret
  // bits through the public key.
  const lookupKey = crypto.randomBytes(LOOKUP_KEY_BYTES).toString('hex');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  return {
    token: `${CREDENTIAL_TOKEN_PREFIX}_${lookupKey}_${secret}`,
    lookupKey,
    secret,
    secretHash: computeSecretHash(secret, pepper),
    hashAlgo: HASH_ALGO_HMAC_V1,
  };
}

/**
 * Returns null - never throws - for anything that is not one of our tokens.
 * The authenticator treats null as "fall through to the legacy bcrypt path", so
 * throwing here would turn a legacy credential into a 500.
 */
export function parseCredentialToken(token: string): { lookupKey: string; secret: string } | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  return { lookupKey: m[1], secret: m[2] };
}
