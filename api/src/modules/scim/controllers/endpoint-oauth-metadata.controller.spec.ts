import type { Request } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';
import { EndpointOAuthMetadataController } from './endpoint-oauth-metadata.controller';

/**
 * W0.3 - per-endpoint RFC 8414 OAuth AS metadata is now CAPABILITY-DERIVED:
 * it advertises a grant/method ONLY when the runtime implements it AND the
 * endpoint has an active compatible credential/trust. This removes the prior
 * live untruth (token-exchange + private_key_jwt were advertised unconditionally
 * even though the runtime has no RFC 8693 handler and a WIF endpoint may have no
 * trust). Tests follow guide Section 17.5.
 */
describe('EndpointOAuthMetadataController (W0.3 capability-derived)', () => {
  function cred(credentialType: string): EndpointCredentialModel {
    return { credentialType } as unknown as EndpointCredentialModel;
  }

  function build(active: EndpointCredentialModel[], scopesEnv?: string) {
    const repo: IEndpointCredentialRepository = {
      findActiveByEndpoint: jest.fn().mockResolvedValue(active),
    } as unknown as IEndpointCredentialRepository;
    const config = {
      get: jest.fn().mockReturnValue(scopesEnv),
    } as unknown as ConfigService;
    return new EndpointOAuthMetadataController(repo, config);
  }

  function fakeRequest(
    headers: Record<string, string> = {},
    protocol = 'https',
    host = 'scim.example.com',
  ): Request {
    return {
      headers,
      protocol,
      get: (name: string) => (name.toLowerCase() === 'host' ? host : undefined),
    } as unknown as Request;
  }

  it('builds the issuer as the bare per-endpoint identifier (RFC 8414 section 3.3)', async () => {
    const meta = await build([]).getMetadata('ep-123', fakeRequest());
    expect(meta.issuer).toBe('https://scim.example.com/scim/endpoints/ep-123');
  });

  it('advertises the per-endpoint token endpoint, appended to the issuer (self-consistent)', async () => {
    const meta = await build([]).getMetadata('ep-123', fakeRequest());
    expect(meta.token_endpoint).toBe('https://scim.example.com/scim/endpoints/ep-123/oauth/token');
    expect((meta.token_endpoint as string).startsWith(meta.issuer as string)).toBe(true);
  });

  it('advertises the SHARED global jwks_uri (one signing key today)', async () => {
    const meta = await build([]).getMetadata('ep-123', fakeRequest());
    expect(meta.jwks_uri).toBe('https://scim.example.com/scim/oauth/jwks');
  });

  it('NEVER advertises the token-exchange grant before the RFC 8693 handler exists (W4)', async () => {
    // Even with an active WIF trust, token-exchange is not implemented.
    const meta = await build([cred('wif')]).getMetadata('ep-123', fakeRequest());
    expect(meta.grant_types_supported).toEqual(['client_credentials']);
    expect(meta.grant_types_supported).not.toContain(
      'urn:ietf:params:oauth:grant-type:token-exchange',
    );
  });

  it('advertises NO auth methods when the endpoint has no active credentials', async () => {
    const meta = await build([]).getMetadata('ep-123', fakeRequest());
    expect(meta.token_endpoint_auth_methods_supported).toEqual([]);
    expect(meta.token_endpoint_auth_signing_alg_values_supported).toBeUndefined();
    expect(meta.x_scimserver_wif_profiles).toBeUndefined();
  });

  it('advertises client_secret_basic + client_secret_post only with an active oauth_client credential', async () => {
    const meta = await build([cred('oauth_client')]).getMetadata('ep-123', fakeRequest());
    expect(meta.token_endpoint_auth_methods_supported).toEqual([
      'client_secret_basic',
      'client_secret_post',
    ]);
    // No WIF trust -> no private_key_jwt, no signing-alg list, no WIF profile.
    expect(meta.token_endpoint_auth_methods_supported).not.toContain('private_key_jwt');
    expect(meta.token_endpoint_auth_signing_alg_values_supported).toBeUndefined();
    expect(meta.x_scimserver_wif_profiles).toBeUndefined();
  });

  it('advertises private_key_jwt + signing algs + the WIF profile disclosure only with an active wif trust', async () => {
    const meta = await build([cred('wif')]).getMetadata('ep-123', fakeRequest());
    expect(meta.token_endpoint_auth_methods_supported).toEqual(['private_key_jwt']);
    // guide 17.4: disclose that the assertion subject binding is independent
    // of client_id (unlike conventional private_key_jwt).
    expect(meta.token_endpoint_auth_signing_alg_values_supported).toEqual(['RS256', 'ES256']);
    expect(meta.x_scimserver_wif_profiles).toEqual([
      {
        name: 'syncfabric-rfc7523',
        client_id_binding: 'target-client-id',
        assertion_subject_binding: 'independent',
        resource_parameter_supported: true,
      },
    ]);
    // No RFC 8693 profile / `none` method before W4.
    expect(meta.token_endpoint_auth_methods_supported).not.toContain('none');
  });

  it('combines secret + WIF methods when both are active', async () => {
    const meta = await build([cred('oauth_client'), cred('wif'), cred('bearer')]).getMetadata(
      'ep-123',
      fakeRequest(),
    );
    expect(meta.token_endpoint_auth_methods_supported).toEqual([
      'client_secret_basic',
      'client_secret_post',
      'private_key_jwt',
    ]);
  });

  it('does not project a bearer credential into any token-endpoint auth method', async () => {
    // A per-endpoint `bearer` is a resource-plane opaque secret, not a token-
    // endpoint client-auth method.
    const meta = await build([cred('bearer')]).getMetadata('ep-123', fakeRequest());
    expect(meta.token_endpoint_auth_methods_supported).toEqual([]);
  });

  it('derives scopes_supported from OAUTH_CLIENT_SCOPES, defaulting to the standard set', async () => {
    const dflt = await build([]).getMetadata('ep-123', fakeRequest());
    expect(dflt.scopes_supported).toEqual(['scim.read', 'scim.write', 'scim.manage']);

    const custom = await build([], 'scim.read, scim.write').getMetadata('ep-123', fakeRequest());
    expect(custom.scopes_supported).toEqual(['scim.read', 'scim.write']);
  });

  it('fails open to an empty capability set when the credential lookup throws', async () => {
    const repo = {
      findActiveByEndpoint: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as IEndpointCredentialRepository;
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const controller = new EndpointOAuthMetadataController(repo, config);
    const meta = await controller.getMetadata('ep-123', fakeRequest());
    // Still a valid document; just no method advertised (nothing is falsely claimed).
    expect(meta.issuer).toBe('https://scim.example.com/scim/endpoints/ep-123');
    expect(meta.token_endpoint_auth_methods_supported).toEqual([]);
  });

  it('honors x-forwarded-proto / x-forwarded-host (behind a proxy)', async () => {
    const meta = await build([]).getMetadata(
      'ep-9',
      fakeRequest(
        { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'public.example.net' },
        'http',
        'internal:3000',
      ),
    );
    expect(meta.issuer).toBe('https://public.example.net/scim/endpoints/ep-9');
  });
});
