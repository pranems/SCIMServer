import { Test } from '@nestjs/testing';
import { WifAssertionTokenProvider } from './wif-assertion-token.provider';
import { WifAssertionValidatorService, WifAssertionInvalidError } from '../../../oauth/wif-assertion-validator.service';
import { OAuthService } from '../../../oauth/oauth.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimLogger } from '../../logging/scim-logger.service';
import { AuthDecisionRecordStore } from '../../../oauth/auth-decision-record.store';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';

/**
 * Q6.4 - WifAssertionTokenProvider unit tests. The three-outcome acceptor
 * contract (architecture section 2.2) is the core assertion surface.
 */
describe('WifAssertionTokenProvider (Q6.4)', () => {
  let provider: WifAssertionTokenProvider;
  let findActiveByEndpoint: jest.Mock;
  let validate: jest.Mock;
  let validateWithTrace: jest.Mock;
  let generateEndpointAccessToken: jest.Mock;
  let getEndpoint: jest.Mock;
  let logger: { warn: jest.Mock; info: jest.Mock; debug: jest.Mock; error: jest.Mock };
  let decisionStore: AuthDecisionRecordStore;

  const wifMetadata = {
    expectedIssuer: 'https://login.microsoftonline.com/tenant-123/v2.0',
    expectedSubject: 'sp-object-id-abc',
    expectedAudience: 'api://scimserver-endpoint',
    jwksUri: 'https://login.microsoftonline.com/tenant-123/discovery/v2.0/keys',
    allowedTenantId: 'tenant-123',
    requiredRoles: ['Scim.Provision'],
    scope: 'scim.read scim.write',
    issuedTokenTtlSec: 7200,
    assertionProfile: 'jwt-bearer',
  };

  function wifCredential(): EndpointCredentialModel {
    return {
      id: 'cred-wif-1',
      endpointId: 'ep-1',
      credentialType: 'wif',
      credentialHash: '',
      label: 'Entra WIF',
      metadata: { ...wifMetadata },
      secretEnvelope: null,
      active: true,
      createdAt: new Date(),
      expiresAt: null,
    };
  }

  beforeEach(async () => {
    findActiveByEndpoint = jest.fn();
    validate = jest.fn();
    generateEndpointAccessToken = jest.fn();
    getEndpoint = jest.fn().mockResolvedValue({ profile: { settings: {} } });
    logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };

    validateWithTrace = jest.fn(async (a: string, t: unknown) => ({
      claims: await validate(a, t),
      trace: {
        plane: 'token-mint',
        method: 'wif',
        outcome: 'accept',
        checks: [
          { id: 'issuer_match', status: 'pass', expected: 'iss', received: 'iss' },
          { id: 'audience_match', status: 'pass', expected: 'aud', received: 'aud' },
        ],
      },
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        WifAssertionTokenProvider,
        { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useValue: { findActiveByEndpoint } },
        {
          provide: WifAssertionValidatorService,
          // Phase 1: the provider calls validateWithTrace(); wrap the existing
          // `validate` mock so all its call-assertions still hold, and return
          // the {claims, trace} shape the provider now consumes.
          useValue: {
            validate,
            validateWithTrace,
          },
        },
        { provide: OAuthService, useValue: { generateEndpointAccessToken } },
        { provide: ScimLogger, useValue: logger },
        { provide: EndpointService, useValue: { getEndpoint } },
        AuthDecisionRecordStore,
      ],
    }).compile();

    provider = moduleRef.get(WifAssertionTokenProvider);
    decisionStore = moduleRef.get(AuthDecisionRecordStore);
  });

  it('returns null when the endpoint has no wif trust (not-mine-continue)', async () => {
    findActiveByEndpoint.mockResolvedValue([
      { credentialType: 'oauth_client', metadata: { clientId: 'epc_x' } },
    ]);
    const result = await provider.mintFromAssertion('ep-1', 'assertion.jwt');
    expect(result).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });

  it('mints the endpoint token when the assertion is valid (accept)', async () => {
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123', roles: ['Scim.Provision'] });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    const result = await provider.mintFromAssertion('ep-1', 'assertion.jwt');

    expect(result).toEqual({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });
    // Validator was called with the assertion + the trust built from metadata.
    expect(validate).toHaveBeenCalledWith('assertion.jwt', expect.objectContaining({
      expectedIssuer: wifMetadata.expectedIssuer,
      jwksUri: wifMetadata.jwksUri,
      allowedTenantId: 'tenant-123',
    }));
    // W3.2 - the issued token's client_id is the endpoint's OWN client identity
    // (the endpointId, since this trust has no explicit targetClientId), NOT the
    // federated assertion subject. The assertion subject rides `sourceSubject`
    // (stamped as the distinct `src_sub` claim) for attribution only.
    expect(generateEndpointAccessToken).toHaveBeenCalledWith(
      'ep-1',
      'ep-1',
      undefined,
      expect.objectContaining({
        ttlSec: 7200,
        trustedScope: 'scim.read scim.write',
        sourceSubject: wifMetadata.expectedSubject,
      }),
    );
    // The assertion subject must NEVER be passed as the issued client_id (W3.2).
    expect(generateEndpointAccessToken).not.toHaveBeenCalledWith(
      'ep-1',
      wifMetadata.expectedSubject,
      expect.anything(),
      expect.anything(),
    );
    // WI-D4 - exactly one canonical AUTH decision event (accept) is emitted.
    const acceptEvents = logger.info.mock.calls.filter((c) => c[1] === 'Auth decision');
    expect(acceptEvents).toHaveLength(1);
    expect(acceptEvents[0][2]).toEqual(
      expect.objectContaining({ outcome: 'accept', method: 'wif', endpointId: 'ep-1' }),
    );
    // WI-D5 - the accepted decision is captured in the record store.
    const accepted = decisionStore.query({ endpointId: 'ep-1' });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].outcome).toBe('accept');
  });

  it("W3.2: mints with the trust's explicit targetClientId as the issued client_id (not the assertion subject)", async () => {
    const cred = wifCredential();
    cred.metadata = { ...wifMetadata, targetClientId: 'scim-wif-client-abc123' };
    findActiveByEndpoint.mockResolvedValue([cred]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123', roles: ['Scim.Provision'] });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    await provider.mintFromAssertion('ep-1', 'assertion.jwt');

    // The operator-configured target client id is the issued client_id; the
    // assertion subject rides `sourceSubject` only.
    expect(generateEndpointAccessToken).toHaveBeenCalledWith(
      'ep-1',
      'scim-wif-client-abc123',
      undefined,
      expect.objectContaining({ sourceSubject: wifMetadata.expectedSubject }),
    );
  });

  it('threads the endpoint-level egress overrides into the validator', async () => {
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123', roles: ['Scim.Provision'] });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });
    // Endpoint carries explicit runtime egress overrides in its profile settings.
    getEndpoint.mockResolvedValue({
      profile: {
        settings: {
          JwksFetchTimeoutMs: 1500,
          JwksFetchRetries: 4,
          JwksFetchRetryBackoffMs: 50,
          JwksCacheMaxAgeMs: 30000,
        },
      },
    });

    await provider.mintFromAssertion('ep-1', 'assertion.jwt');

    // The validator receives the resolved overrides as its 3rd argument, so the
    // endpoint values override the server defaults for THIS mint.
    expect(validateWithTrace).toHaveBeenCalledWith(
      'assertion.jwt',
      expect.objectContaining({ jwksUri: wifMetadata.jwksUri }),
      { timeoutMs: 1500, retries: 4, retryBackoffMs: 50, cacheMaxAgeMs: 30000 },
      undefined,
    );
  });

  it('passes empty overrides (server defaults) when the endpoint sets no egress flags', async () => {
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123', roles: ['Scim.Provision'] });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    await provider.mintFromAssertion('ep-1', 'assertion.jwt');

    expect(validateWithTrace).toHaveBeenCalledWith('assertion.jwt', expect.any(Object), {}, undefined);
  });

  it('W3.4: threads the request resource parameter into the validator', async () => {
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123', roles: ['Scim.Provision'] });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    await provider.mintFromAssertion('ep-1', 'assertion.jwt', { resource: 'api://sf-resource' });

    // The RFC 8707 resource param is the validator's 4th argument, so the
    // trust's resourceMode can enforce it.
    expect(validateWithTrace).toHaveBeenCalledWith('assertion.jwt', expect.any(Object), {}, 'api://sf-resource');
  });

  it('W3.6: passes the assertion exp so the mint can cap the issued lifetime (guide 13.5)', async () => {
    const assertionExp = Math.floor(Date.now() / 1000) + 900;
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123', exp: assertionExp });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 900, scope: 'scim.read scim.write' });

    await provider.mintFromAssertion('ep-1', 'assertion.jwt');

    expect(generateEndpointAccessToken).toHaveBeenCalledWith(
      'ep-1',
      'ep-1',
      undefined,
      expect.objectContaining({ assertionExpiresAt: assertionExp }),
    );
  });

  it('W3.7: rejects a request client_id that does not match the trust targetClientId', async () => {
    const cred = wifCredential();
    cred.metadata = { ...wifMetadata, targetClientId: 'scim-wif-client-abc123' };
    findActiveByEndpoint.mockResolvedValue([cred]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123' });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 3600, scope: 'scim.read' });

    await expect(
      provider.mintFromAssertion('ep-1', 'assertion.jwt', { clientId: 'the-wrong-client' }),
    ).rejects.toMatchObject({ reasonCode: 'wif_client_id_mismatch' });
    expect(generateEndpointAccessToken).not.toHaveBeenCalled();
  });

  it('W3.7: accepts a request client_id that matches the trust targetClientId', async () => {
    const cred = wifCredential();
    cred.metadata = { ...wifMetadata, targetClientId: 'scim-wif-client-abc123' };
    findActiveByEndpoint.mockResolvedValue([cred]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123' });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 3600, scope: 'scim.read' });

    const token = await provider.mintFromAssertion('ep-1', 'assertion.jwt', { clientId: 'scim-wif-client-abc123' });
    expect(token?.accessToken).toBe('minted.jwt');
  });

  it('W3.7: a request with NO client_id is unaffected by the binding (backward compatible)', async () => {
    const cred = wifCredential();
    cred.metadata = { ...wifMetadata, targetClientId: 'scim-wif-client-abc123' };
    findActiveByEndpoint.mockResolvedValue([cred]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123' });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 3600, scope: 'scim.read' });

    const token = await provider.mintFromAssertion('ep-1', 'assertion.jwt');
    expect(token?.accessToken).toBe('minted.jwt');
  });

  it('W3.7: a trust with NO targetClientId never binds (nothing to bind against)', async () => {
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockResolvedValue({ iss: wifMetadata.expectedIssuer, sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123' });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 3600, scope: 'scim.read' });

    const token = await provider.mintFromAssertion('ep-1', 'assertion.jwt', { clientId: 'anything-at-all' });
    expect(token?.accessToken).toBe('minted.jwt');
  });

  it('throws when the assertion is for this endpoint but invalid (mine-but-invalid-stop)', async () => {
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockRejectedValue(new WifAssertionInvalidError('issuer mismatch', 'wif_issuer_mismatch', {
      plane: 'token-mint',
      method: 'wif',
      outcome: 'reject',
      reasonCode: 'wif_issuer_mismatch',
      checks: [{ id: 'issuer_match', status: 'fail' }],
    }));

    await expect(provider.mintFromAssertion('ep-1', 'assertion.jwt')).rejects.toBeInstanceOf(WifAssertionInvalidError);
    expect(generateEndpointAccessToken).not.toHaveBeenCalled();
    // WI-D4 - exactly one canonical AUTH decision event (reject) is emitted.
    const rejectEvents = logger.warn.mock.calls.filter((c) => c[1] === 'Auth decision');
    expect(rejectEvents).toHaveLength(1);
    expect(rejectEvents[0][2]).toEqual(
      expect.objectContaining({ outcome: 'reject', reasonCode: 'wif_issuer_mismatch' }),
    );
    // WI-D5 - the rejected decision is captured in the store, scoped to the endpoint.
    const rejected = decisionStore.query({ endpointId: 'ep-1', outcome: 'reject' });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasonCode).toBe('wif_issuer_mismatch');
  });

  it('throws when the wif trust metadata is missing required fields (fail closed)', async () => {
    const broken = wifCredential();
    broken.metadata = { expectedIssuer: 'https://idp' }; // missing the rest
    findActiveByEndpoint.mockResolvedValue([broken]);

    await expect(provider.mintFromAssertion('ep-1', 'assertion.jwt')).rejects.toThrow();
    expect(generateEndpointAccessToken).not.toHaveBeenCalled();
  });

  // ─── A4 - shadow authorization telemetry (inert) ───────────────────────────
  it('still mints the token even when the A4 shadow gate would reject (enforcement OFF)', async () => {
    const cred = wifCredential();
    // roleScopeMap maps a role the assertion does NOT carry -> shadow wouldReject.
    cred.metadata = {
      ...wifMetadata,
      roleScopeMap: { 'Some.Other.Role': ['scim.read'] },
      identityModel: 'first-party',
    };
    findActiveByEndpoint.mockResolvedValue([cred]);
    validate.mockResolvedValue({
      iss: wifMetadata.expectedIssuer,
      sub: wifMetadata.expectedSubject,
      aud: wifMetadata.expectedAudience,
      tid: 'tenant-123',
      roles: ['Scim.Provision'],
    });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    const result = await provider.mintFromAssertion('ep-1', 'assertion.jwt');

    // The token is STILL minted - A4 enforcement is off.
    expect(result).toEqual({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });
    // The shadow decision was emitted as telemetry (wouldReject true, not enforced).
    const shadowLog = logger.info.mock.calls.find(
      (c) => typeof c[1] === 'string' && c[1].includes('shadow authorization'),
    );
    expect(shadowLog).toBeDefined();
    expect(shadowLog![2]).toMatchObject({
      wouldReject: true,
      enforced: false,
      identityModel: 'first-party',
    });
  });

  // ─── WI-16 - multiple wif trusts on one endpoint (iterate, not first-only) ──
  it('WI-16: mints when the assertion validates against a NON-first wif trust', async () => {
    const first = wifCredential();
    first.id = 'cred-wif-1';
    first.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-A/v2.0', jwksUri: 'https://issuer-A/keys' };
    const second = wifCredential();
    second.id = 'cred-wif-2';
    second.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-B/v2.0', jwksUri: 'https://issuer-B/keys' };
    findActiveByEndpoint.mockResolvedValue([first, second]);

    // The assertion is valid ONLY against the second trust (issuer-B); the
    // first trust rejects. Today's first-only `find` would stop at the first
    // and throw; WI-16 must try the second and mint.
    validate.mockImplementation((_assertion: string, trust: { expectedIssuer: string }) => {
      if (trust.expectedIssuer === 'https://issuer-B/v2.0') {
        return Promise.resolve({
          iss: 'https://issuer-B/v2.0',
          sub: wifMetadata.expectedSubject,
          aud: wifMetadata.expectedAudience,
          tid: 'tenant-123',
          roles: ['Scim.Provision'],
        });
      }
      return Promise.reject(new WifAssertionInvalidError('issuer mismatch'));
    });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    const result = await provider.mintFromAssertion('ep-1', 'assertion.jwt');

    expect(result).toEqual({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });
    // Both trusts were tried (first rejected, second accepted).
    expect(validate).toHaveBeenCalledTimes(2);
    expect(generateEndpointAccessToken).toHaveBeenCalledTimes(1);
  });

  it('WI-16: throws mine-but-invalid-stop when NO wif trust matches (multi-trust)', async () => {
    const first = wifCredential();
    first.id = 'cred-wif-1';
    first.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-A/v2.0' };
    const second = wifCredential();
    second.id = 'cred-wif-2';
    second.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-B/v2.0' };
    findActiveByEndpoint.mockResolvedValue([first, second]);
    validate.mockRejectedValue(new WifAssertionInvalidError('issuer mismatch'));

    await expect(provider.mintFromAssertion('ep-1', 'assertion.jwt')).rejects.toBeInstanceOf(
      WifAssertionInvalidError,
    );
    // Both trusts were tried before failing closed.
    expect(validate).toHaveBeenCalledTimes(2);
    expect(generateEndpointAccessToken).not.toHaveBeenCalled();
  });

  // ─── WI-17 - issuer-first selection + source-stamped mint ──────────────────
  /** Build a fake (unsigned) assertion whose decoded payload carries `iss`. */
  function assertionWithIssuer(iss: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss })).toString('base64url');
    return `${header}.${payload}.sig`;
  }

  it('WI-17: tries the issuer-matching trust FIRST (validate called once, O(1))', async () => {
    // Trust A is listed first but does NOT match the assertion issuer; trust B
    // (listed second) matches. Issuer-first ordering must try B directly, so
    // validate is called exactly ONCE (against B), not twice.
    const first = wifCredential();
    first.id = 'cred-wif-A';
    first.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-A/v2.0', jwksUri: 'https://issuer-A/keys' };
    const second = wifCredential();
    second.id = 'cred-wif-B';
    second.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-B/v2.0', jwksUri: 'https://issuer-B/keys' };
    findActiveByEndpoint.mockResolvedValue([first, second]);

    validate.mockResolvedValue({
      iss: 'https://issuer-B/v2.0',
      sub: wifMetadata.expectedSubject,
      aud: wifMetadata.expectedAudience,
      tid: 'tenant-123',
      roles: ['Scim.Provision'],
    });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    const result = await provider.mintFromAssertion('ep-1', assertionWithIssuer('https://issuer-B/v2.0'));

    expect(result).toEqual({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });
    // Issuer-first: only the matching trust (B) was validated.
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ expectedIssuer: 'https://issuer-B/v2.0' }),
    );
  });

  it('WI-17: stamps the winning trust issuer (sourceIssuer) on the minted token', async () => {
    const cred = wifCredential();
    cred.id = 'cred-wif-src';
    cred.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-src/v2.0' };
    findActiveByEndpoint.mockResolvedValue([cred]);
    validate.mockResolvedValue({
      iss: 'https://issuer-src/v2.0',
      sub: wifMetadata.expectedSubject,
      aud: wifMetadata.expectedAudience,
      tid: 'tenant-123',
      roles: ['Scim.Provision'],
    });
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    await provider.mintFromAssertion('ep-1', assertionWithIssuer('https://issuer-src/v2.0'));

    // The mint call carries the winning trust's issuer as sourceIssuer, and
    // issues the endpoint's own client identity (W3.2), not the assertion sub.
    expect(generateEndpointAccessToken).toHaveBeenCalledWith(
      'ep-1',
      'ep-1',
      undefined,
      expect.objectContaining({ sourceIssuer: 'https://issuer-src/v2.0' }),
    );
  });

  it('WI-17: falls back to trying every trust when the assertion issuer is undecodable', async () => {
    // A non-JWT assertion string cannot yield an `iss`; the provider must not
    // throw on decode and must fall back to the WI-16 try-all behavior.
    const first = wifCredential();
    first.id = 'cred-wif-1';
    first.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-A/v2.0' };
    const second = wifCredential();
    second.id = 'cred-wif-2';
    second.metadata = { ...wifMetadata, expectedIssuer: 'https://issuer-B/v2.0' };
    findActiveByEndpoint.mockResolvedValue([first, second]);
    validate.mockImplementation((_a: string, trust: { expectedIssuer: string }) =>
      trust.expectedIssuer === 'https://issuer-B/v2.0'
        ? Promise.resolve({ iss: 'https://issuer-B/v2.0', sub: wifMetadata.expectedSubject, aud: wifMetadata.expectedAudience, tid: 'tenant-123', roles: ['Scim.Provision'] })
        : Promise.reject(new WifAssertionInvalidError('issuer mismatch')),
    );
    generateEndpointAccessToken.mockResolvedValue({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });

    const result = await provider.mintFromAssertion('ep-1', 'not-a-jwt');

    expect(result).toEqual({ accessToken: 'minted.jwt', expiresIn: 7200, scope: 'scim.read scim.write' });
    // Undecodable issuer -> try-all order (A rejects, B accepts) = 2 calls.
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
