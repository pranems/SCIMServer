/**
 * credential-envelope.ts (WI-6) - the pure cryptographic core of the retained-
 * secret envelope-encryption scheme (docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md
 * section 6A). No NestJS, no DB, no env access here - just deterministic,
 * unit-testable primitives so the crypto can be verified in isolation.
 *
 * Two-level key hierarchy (standard envelope encryption, the shape AWS/Azure
 * KMS use):
 *
 *   KEK (key-encryption-key)  - derived from the CREDENTIAL_KEK passphrase via
 *                               scrypt; lives only in deployment config (env),
 *                               never in the DB.
 *   DEK (data-encryption-key) - a random 32-byte key; stored in the DB WRAPPED
 *                               (encrypted) by the KEK, so it survives restart /
 *                               redeploy / backup while a DB dump alone is inert.
 *   Secret ciphertext         - the retained credential secret, AES-256-GCM
 *                               encrypted by the DEK.
 *
 * All symmetric encryption is AES-256-GCM (authenticated). Wrapped keys and
 * secret envelopes are self-describing strings: `v1.<iv>.<ciphertext>.<tag>`
 * with each part base64url-encoded, so they round-trip through JSON / a text
 * column without escaping.
 */
import * as crypto from 'node:crypto';

/** Envelope format version prefix - lets the format evolve without ambiguity. */
export const ENVELOPE_VERSION = 'v1';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard nonce length
const SCRYPT_SALT_LEN = 16;
// scrypt cost params - N must be a power of two. These match Node's defaults
// scaled for an interactive-but-not-hot-path derivation (reveal path only).
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64u(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** Generate a fresh random scrypt salt for KEK derivation. */
export function generateKekSalt(): Buffer {
  return crypto.randomBytes(SCRYPT_SALT_LEN);
}

/**
 * Derive a 32-byte AES key from the KEK passphrase + salt using scrypt. A
 * human-friendly passphrase (like the shared secrets) works as input.
 */
export function deriveKekKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    // Node's default maxmem (32 MB) is too small for N=16384; raise it.
    maxmem: 64 * 1024 * 1024,
  });
}

/** Generate a fresh random 32-byte data-encryption key. */
export function generateDek(): Buffer {
  return crypto.randomBytes(KEY_LEN);
}

/**
 * AES-256-GCM encrypt `plaintext` (a Buffer) under `key`, returning a
 * self-describing `v1.<iv>.<ct>.<tag>` string.
 */
function sealBuffer(plaintext: Buffer, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, b64u(iv), b64u(ct), b64u(tag)].join('.');
}

/** Inverse of sealBuffer: verify + decrypt a `v1.<iv>.<ct>.<tag>` string. */
function openBuffer(envelope: string, key: Buffer): Buffer {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Malformed envelope: expected v1.<iv>.<ciphertext>.<tag>.');
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const iv = fromB64u(ivB64);
  const ct = fromB64u(ctB64);
  const tag = fromB64u(tagB64);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Wrap (encrypt) a DEK under the KEK-derived key. Returns a `v1....` string. */
export function wrapDek(dek: Buffer, kekKey: Buffer): string {
  return sealBuffer(dek, kekKey);
}

/** Unwrap (decrypt) a wrapped DEK using the KEK-derived key. */
export function unwrapDek(wrapped: string, kekKey: Buffer): Buffer {
  return openBuffer(wrapped, kekKey);
}

/** Encrypt a UTF-8 secret string under the DEK. Returns a `v1....` envelope. */
export function encryptSecret(plaintext: string, dek: Buffer): string {
  return sealBuffer(Buffer.from(plaintext, 'utf8'), dek);
}

/** Decrypt a secret envelope under the DEK back to the UTF-8 string. */
export function decryptSecret(envelope: string, dek: Buffer): string {
  return openBuffer(envelope, dek).toString('utf8');
}
