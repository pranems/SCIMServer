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

    const moduleRef = await Test.createTestingModule({
      providers: [
        WifAssertionTokenProvider,
        { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useValue: { findActiveByEndpoint } },
        { provide: WifAssertionValidatorService, useValue: { validate } },
        { provide: OAuthService, useValue: { generateEndpointAccessToken } },
        { provide: ScimLogger, useValue: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() } },
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
});
