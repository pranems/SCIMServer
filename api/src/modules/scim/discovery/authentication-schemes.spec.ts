import {
  computeAuthenticationSchemes,
  ENFORCEABLE_METHOD_TYPES,
  UNENFORCEABLE_METHOD_TYPES,
} from './authentication-schemes';
import { KNOWN_METHOD_TYPES } from '../controllers/admin-authentication-method.controller';
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

  /**
   * N8 - the server must not advertise what it cannot enforce.
   *
   * `mtls`, `dpop` and `oauth-authcode` are declarable on an endpoint and used to
   * appear in `ServiceProviderConfig.authenticationSchemes`, but no authenticator
   * implements any of them. Discovery is a promise a client is entitled to rely
   * on, so advertising them was worse than not offering them.
   */
  describe('N8 - advertise only what is enforced', () => {
    for (const type of ['mtls', 'dpop', 'oauth-authcode']) {
      it(`does NOT advertise "${type}" even when enabled`, () => {
        const auth: ProfileAuthentication = {
          schemaVersion: 1,
          methods: [{ id: 'm-1', type, displayName: 'Should not appear' }],
        };
        const result = computeAuthenticationSchemes(BASELINE, auth);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('oauthbearertoken');
        expect(result.some((s) => s.name === 'Should not appear')).toBe(false);
      });
    }

    it('NEGATIVE CONTROL: an ENFORCEABLE method is still advertised', () => {
      // Without this, the three tests above would also pass if the function had
      // simply stopped advertising everything.
      const auth: ProfileAuthentication = {
        schemaVersion: 1,
        methods: [{ id: 'm-1', type: 'oauth-client', displayName: 'Client credentials' }],
      };
      const result = computeAuthenticationSchemes(BASELINE, auth);
      expect(result).toHaveLength(2);
      expect(result.some((s) => s.name === 'Client credentials')).toBe(true);
    });

    it('keeps the baseline primary when defaultMethodId names an unenforceable method', () => {
      // The default points at a method that contributes no scheme, so `primary`
      // must not be orphaned - exactly one scheme is primary, and it is the
      // baseline.
      const auth: ProfileAuthentication = {
        schemaVersion: 1,
        defaultMethodId: 'm-mtls',
        methods: [{ id: 'm-mtls', type: 'mtls' }],
      };
      const result = computeAuthenticationSchemes(BASELINE, auth);
      expect(result.filter((s) => s.primary)).toHaveLength(1);
      expect(result.find((s) => s.primary)?.type).toBe('oauthbearertoken');
    });

    it('mixes: enforceable advertised, unenforceable dropped, in one profile', () => {
      const auth: ProfileAuthentication = {
        schemaVersion: 1,
        methods: [
          { id: 'm-1', type: 'oauth-client', displayName: 'Advertised' },
          { id: 'm-2', type: 'dpop', displayName: 'Dropped' },
        ],
      };
      const result = computeAuthenticationSchemes(BASELINE, auth);
      expect(result.map((s) => s.name)).toContain('Advertised');
      expect(result.map((s) => s.name)).not.toContain('Dropped');
    });

    /**
     * The self-extending half. Without this, someone registering a new method
     * type would silently get it dropped from discovery (allowlist default) with
     * no signal, which is the mirror image of the bug being fixed. Forcing the
     * classification makes it a decision rather than an accident in either
     * direction.
     */
    it('every KNOWN method type is classified exactly once (enforceable XOR unenforceable)', () => {
      const unclassified: string[] = [];
      const doubleClassified: string[] = [];
      for (const type of KNOWN_METHOD_TYPES) {
        const enforceable = ENFORCEABLE_METHOD_TYPES.has(type);
        const unenforceable = UNENFORCEABLE_METHOD_TYPES.has(type);
        if (!enforceable && !unenforceable) unclassified.push(type);
        if (enforceable && unenforceable) doubleClassified.push(type);
      }
      expect(unclassified).toEqual([]);
      expect(doubleClassified).toEqual([]);
    });

    it('every unenforceable type carries a non-empty reason', () => {
      // A bare denylist entry rots into folklore. The reason is what tells the
      // next reader whether it is still true.
      for (const [type, reason] of UNENFORCEABLE_METHOD_TYPES) {
        expect(typeof reason === 'string' && reason.trim().length > 20).toBe(true);
        expect(ENFORCEABLE_METHOD_TYPES.has(type)).toBe(false);
      }
    });

    it('guards the guard: the classification sets are not empty', () => {
      expect(ENFORCEABLE_METHOD_TYPES.size).toBeGreaterThan(0);
      expect(UNENFORCEABLE_METHOD_TYPES.size).toBeGreaterThan(0);
      expect(KNOWN_METHOD_TYPES.size).toBeGreaterThan(0);
    });
  });
});
