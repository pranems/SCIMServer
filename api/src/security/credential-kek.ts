/**
 * credential-kek.ts (WI-6) - loads the KEK passphrase from the environment
 * with a known public default, exactly like the shared secrets
 * (`changeme-oauth`, `changeme-scim`). See
 * docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md section 6A.5.
 *
 * CRITICAL: while the KEK is still the public default, encryption-at-rest is
 * cosmetic (a repo-aware attacker knows the default). Real protection begins
 * only when the operator sets a private `CREDENTIAL_KEK` in prod. The KEK is
 * NEVER on the authentication hot path (auth compares the bcrypt hash); it is
 * touched only by the admin reveal path.
 */

/** The known public default KEK passphrase (documented in DEPLOYMENT.md etc). */
export const DEFAULT_CREDENTIAL_KEK = 'changeme-credential-kek';

/**
 * The KEK passphrase in effect: `CREDENTIAL_KEK` env var, or the public default
 * when unset/blank. Never throws - the default keeps the system working out of
 * the box and redeployable.
 */
export function loadCredentialKek(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CREDENTIAL_KEK;
  if (raw === undefined) return DEFAULT_CREDENTIAL_KEK;
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_CREDENTIAL_KEK : trimmed;
}

/** Whether the KEK in effect is still the public default (cosmetic protection). */
export function isDefaultKek(env: NodeJS.ProcessEnv = process.env): boolean {
  return loadCredentialKek(env) === DEFAULT_CREDENTIAL_KEK;
}
