import { computeAuthenticationSchemes } from './authentication-schemes';
import type { SpcAuthenticationScheme, ProfileAuthentication } from '../endpoint-profile/endpoint-profile.types';

/**
 * A2 - computed authenticationSchemes unit tests.
 */
const BASELINE: SpcAuthenticationScheme[] = [
  {
    type: 'oauthbearertoken',
    name: 'OAuth Bearer Token',
    description: 'Authentication scheme using the OAuth Bearer Token Standard',
    specUri: 'https://www.rfc-editor.org/info/rfc6750',
    primary: true,
  },
];

describe('computeAuthenticationSchemes (A2)', () => {
  it('advertises ONLY the baseline when there is no authentication block', () => {
    const result = computeAuthenticationSchemes(BASELINE, undefined);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('oauthbearertoken');
    expect(result[0].primary).toBe(true);
  });

  it('advertises ONLY the baseline when there are no enabled methods', () => {
    const auth: ProfileAuthentication = { schemaVersion: 1, methods: [] };
    const result = computeAuthenticationSchemes(BASELINE, auth);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('oauthbearertoken');
    expect(result[0].primary).toBe(true);
  });

  it('treats an explicitly-disabled method as not advertised', () => {
    const auth: ProfileAuthentication = {
      schemaVersion: 1,
      methods: [{ id: 'm-1', type: 'wif-7523', enabled: false }],
    };
    const result = computeAuthenticationSchemes(BASELINE, auth);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('oauthbearertoken');
  });

  it('adds a scheme per enabled method (baseline + N)', () => {
    const auth: ProfileAuthentication = {
      schemaVersion: 1,
      methods: [
        { id: 'm-1', type: 'wif-7523', displayName: 'WIF', specUri: 'https://www.rfc-editor.org/rfc/rfc7523' },
        { id: 'm-2', type: 'oauth-client', displayName: 'OAuth Client' },
      ],
    };
    const result = computeAuthenticationSchemes(BASELINE, auth);
    expect(result).toHaveLength(3); // baseline + 2
    expect(result.map((s) => s.name)).toEqual(
      expect.arrayContaining(['OAuth Bearer Token', 'WIF', 'OAuth Client']),
    );
    // wif-7523 + oauth-client both map to the oauth2 scheme type.
    const wif = result.find((s) => s.name === 'WIF')!;
    expect(wif.type).toBe('oauth2');
    expect(wif.specUri).toBe('https://www.rfc-editor.org/rfc/rfc7523');
  });

  it('places primary:true on the defaultMethodId scheme', () => {
    const auth: ProfileAuthentication = {
      schemaVersion: 1,
      defaultMethodId: 'm-1',
      methods: [
        { id: 'm-1', type: 'wif-7523', displayName: 'WIF' },
        { id: 'm-2', type: 'oauth-client', displayName: 'OAuth Client' },
      ],
    };
    const result = computeAuthenticationSchemes(BASELINE, auth);
    const primaries = result.filter((s) => s.primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].name).toBe('WIF');
  });

  it('keeps the baseline primary when defaultMethodId is unset', () => {
    const auth: ProfileAuthentication = {
      schemaVersion: 1,
      methods: [{ id: 'm-1', type: 'wif-7523', displayName: 'WIF' }],
    };
    const result = computeAuthenticationSchemes(BASELINE, auth);
    const primaries = result.filter((s) => s.primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].type).toBe('oauthbearertoken');
  });

  it('does not mutate the baseline input', () => {
    const auth: ProfileAuthentication = {
      schemaVersion: 1,
      defaultMethodId: 'm-1',
      methods: [{ id: 'm-1', type: 'wif-7523', displayName: 'WIF' }],
    };
    computeAuthenticationSchemes(BASELINE, auth);
    expect(BASELINE[0].primary).toBe(true); // unchanged
  });

  it('maps httpbasic method type to the httpbasic scheme type', () => {
    const auth: ProfileAuthentication = {
      schemaVersion: 1,
      methods: [{ id: 'm-1', type: 'httpbasic', displayName: 'Basic' }],
    };
    const result = computeAuthenticationSchemes(BASELINE, auth);
    expect(result.find((s) => s.name === 'Basic')!.type).toBe('httpbasic');
  });

  // ─── Q6.6 - WifCredentialsEnabled flag drives WIF advertisement ───────────
  describe('Q6.6 WifCredentialsEnabled advertisement', () => {
    it('advertises a WIF scheme when the flag is on (baseline + WIF)', () => {
      const result = computeAuthenticationSchemes(BASELINE, undefined, { wifCredentialsEnabled: true });
      expect(result).toHaveLength(2);
      const wif = result.find((s) => s.name === 'Workload Identity Federation');
      expect(wif).toBeDefined();
      expect(wif!.type).toBe('oauth2');
      expect(wif!.specUri).toBe('https://www.rfc-editor.org/rfc/rfc7523');
    });

    it('does NOT advertise a WIF scheme when the flag is off', () => {
      const result = computeAuthenticationSchemes(BASELINE, undefined, { wifCredentialsEnabled: false });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('oauthbearertoken');
    });

    it('does not duplicate WIF when an enabled wif method already advertises it', () => {
      const auth: ProfileAuthentication = {
        schemaVersion: 1,
        methods: [{ id: 'm-1', type: 'wif-7523', displayName: 'WIF' }],
      };
      const result = computeAuthenticationSchemes(BASELINE, auth, { wifCredentialsEnabled: true });
      // baseline + the explicit method scheme only; no second auto WIF scheme.
      expect(result).toHaveLength(2);
      expect(result.filter((s) => s.name === 'Workload Identity Federation')).toHaveLength(0);
    });
  });
});
