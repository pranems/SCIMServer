/**
 * credential-kek.spec.ts (WI-6) - env loading + default detection.
 */
import { DEFAULT_CREDENTIAL_KEK, loadCredentialKek, isDefaultKek } from './credential-kek';

describe('credential-kek (WI-6)', () => {
  it('returns the public default when the env var is unset', () => {
    expect(loadCredentialKek({})).toBe(DEFAULT_CREDENTIAL_KEK);
    expect(isDefaultKek({})).toBe(true);
  });

  it('returns the public default when the env var is blank', () => {
    expect(loadCredentialKek({ CREDENTIAL_KEK: '   ' })).toBe(DEFAULT_CREDENTIAL_KEK);
    expect(isDefaultKek({ CREDENTIAL_KEK: '' })).toBe(true);
  });

  it('returns a configured private KEK and reports it is not the default', () => {
    const env = { CREDENTIAL_KEK: 'super-secret-prod-kek' };
    expect(loadCredentialKek(env)).toBe('super-secret-prod-kek');
    expect(isDefaultKek(env)).toBe(false);
  });

  it('trims surrounding whitespace on a configured value', () => {
    expect(loadCredentialKek({ CREDENTIAL_KEK: '  padded-kek  ' })).toBe('padded-kek');
  });
});
