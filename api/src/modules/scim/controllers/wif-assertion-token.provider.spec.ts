import { Test } from '@nestjs/testing';
import { WifAssertionTokenProvider } from './wif-assertion-token.provider';
import { WifAssertionValidatorService, WifAssertionInvalidError } from '../../../oauth/wif-assertion-validator.service';
import { OAuthService } from '../../../oauth/oauth.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimLogger } from '../../logging/scim-logger.service';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';

/**
 * Q6.4 - WifAssertionTokenProvider unit tests. The three-outcome acceptor
 * contract (architecture section 2.2) is the core assertion surface.
 */
describe('WifAssertionTokenProvider (Q6.4)', () => {
  let provider: WifAssertionTokenProvider;
  let findActiveByEndpoint: jest.Mock;
  let validate: jest.Mock;
  let generateEndpointAccessToken: jest.Mock;
  let logger: { warn: jest.Mock; info: jest.Mock; debug: jest.Mock; error: jest.Mock };

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
      active: true,
      createdAt: new Date(),
      expiresAt: null,
    };
  }

  beforeEach(async () => {
    findActiveByEndpoint = jest.fn();
    validate = jest.fn();
    generateEndpointAccessToken = jest.fn();
    logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WifAssertionTokenProvider,
        { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useValue: { findActiveByEndpoint } },
        { provide: WifAssertionValidatorService, useValue: { validate } },
        { provide: OAuthService, useValue: { generateEndpointAccessToken } },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile();

    provider = moduleRef.get(WifAssertionTokenProvider);
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
    // Token minted with the configured scope + ttl (admin-trusted).
    expect(generateEndpointAccessToken).toHaveBeenCalledWith(
      'ep-1',
      wifMetadata.expectedSubject,
      undefined,
      expect.objectContaining({ ttlSec: 7200, trustedScope: 'scim.read scim.write' }),
    );
  });

  it('throws when the assertion is for this endpoint but invalid (mine-but-invalid-stop)', async () => {
    findActiveByEndpoint.mockResolvedValue([wifCredential()]);
    validate.mockRejectedValue(new WifAssertionInvalidError('issuer mismatch'));

    await expect(provider.mintFromAssertion('ep-1', 'assertion.jwt')).rejects.toBeInstanceOf(WifAssertionInvalidError);
    expect(generateEndpointAccessToken).not.toHaveBeenCalled();
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

    // The mint call carries the winning trust's issuer as sourceIssuer.
    expect(generateEndpointAccessToken).toHaveBeenCalledWith(
      'ep-1',
      wifMetadata.expectedSubject,
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
