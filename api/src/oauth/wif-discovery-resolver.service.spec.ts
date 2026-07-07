import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { WifDiscoveryResolverService } from './wif-discovery-resolver.service';
import { JWKS_FETCH } from './external-jwks-validator.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';

/**
 * WI-14 - WifDiscoveryResolverService unit tests. The remote discovery fetch is
 * overridden with an in-memory mock so no network is touched.
 */
describe('WifDiscoveryResolverService (WI-14)', () => {
  const ENDPOINT_ID = '7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34';
  const TENANT = 'ce5f061f-abe6-4e40-9615-301f87bcb7f0';
  const ENTRA_ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
  const ENTRA_JWKS = `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`;

  let service: WifDiscoveryResolverService;
  let fetchMock: jest.Mock;

  function discoveryDoc(overrides: Record<string, unknown> = {}) {
    return { issuer: ENTRA_ISSUER, jwks_uri: ENTRA_JWKS, ...overrides };
  }

  async function build(allowlist = 'login.microsoftonline.com'): Promise<void> {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => discoveryDoc() });
    const moduleRef = await Test.createTestingModule({
      providers: [
        WifDiscoveryResolverService,
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'JWKS_HOST_ALLOWLIST' ? allowlist : undefined) } },
        { provide: ScimLogger, useValue: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
        { provide: JWKS_FETCH, useValue: fetchMock },
      ],
    }).compile();
    service = moduleRef.get(WifDiscoveryResolverService);
  }

  beforeEach(() => build());

  it('Mode A (full discoveryUrl): resolves issuer + jwksUri + audience=endpointId', async () => {
    const result = await service.resolve(ENDPOINT_ID, {
      discoveryUrl: `${ENTRA_ISSUER}/.well-known/openid-configuration`,
    });
    expect(result).toEqual({
      expectedIssuer: ENTRA_ISSUER,
      jwksUri: ENTRA_JWKS,
      expectedAudience: ENDPOINT_ID,
    });
  });

  it('Mode B (preset + tenantId): builds the Entra commercial discovery URL and resolves', async () => {
    const result = await service.resolve(ENDPOINT_ID, { preset: 'entra-commercial', tenantId: TENANT });
    expect(result.expectedIssuer).toBe(ENTRA_ISSUER);
    expect(result.jwksUri).toBe(ENTRA_JWKS);
    // The fetch was made against the preset-built URL.
    expect(fetchMock).toHaveBeenCalledWith(
      `https://login.microsoftonline.com/${TENANT}/v2.0/.well-known/openid-configuration`,
    );
  });

  it('Mode B requires a tenantId for an entra preset', async () => {
    await expect(service.resolve(ENDPOINT_ID, { preset: 'entra-commercial' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an unknown preset', async () => {
    await expect(service.resolve(ENDPOINT_ID, { preset: 'nope', tenantId: TENANT })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('requires either discoveryUrl or preset', async () => {
    await expect(service.resolve(ENDPOINT_ID, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SSRF: rejects a discovery host not on the allowlist BEFORE fetching', async () => {
    await expect(
      service.resolve(ENDPOINT_ID, { discoveryUrl: 'https://evil.example/.well-known/openid-configuration' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SSRF: rejects a non-https discovery URL', async () => {
    await expect(
      service.resolve(ENDPOINT_ID, { discoveryUrl: 'http://login.microsoftonline.com/x/.well-known/openid-configuration' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the discovery doc is missing issuer or jwks_uri', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issuer: ENTRA_ISSUER }) });
    await expect(
      service.resolve(ENDPOINT_ID, { discoveryUrl: `${ENTRA_ISSUER}/.well-known/openid-configuration` }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the advertised jwks_uri host is NOT on the allowlist (runtime SSRF guard)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => discoveryDoc({ jwks_uri: 'https://evil.example/keys' }),
    });
    await expect(
      service.resolve(ENDPOINT_ID, { discoveryUrl: `${ENTRA_ISSUER}/.well-known/openid-configuration` }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed when the discovery fetch errors (HTTP not ok)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      service.resolve(ENDPOINT_ID, { discoveryUrl: `${ENTRA_ISSUER}/.well-known/openid-configuration` }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exposes the preset ids for the UI dropdown', () => {
    expect(WifDiscoveryResolverService.PRESET_IDS).toContain('entra-commercial');
    expect(WifDiscoveryResolverService.PRESET_IDS).toContain('google');
  });
});
