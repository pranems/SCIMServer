import type { Request } from 'express';
import { EndpointOAuthMetadataController } from './endpoint-oauth-metadata.controller';

/**
 * WI-12 - per-endpoint RFC 8414 OAuth AS metadata unit tests. The controller is
 * a pure URL assembler (no injected deps), so it is constructed directly.
 */
describe('EndpointOAuthMetadataController (WI-12)', () => {
  const controller = new EndpointOAuthMetadataController();

  function fakeRequest(headers: Record<string, string> = {}, protocol = 'https', host = 'scim.example.com'): Request {
    return {
      headers,
      protocol,
      get: (name: string) => (name.toLowerCase() === 'host' ? host : undefined),
    } as unknown as Request;
  }

  it('builds the issuer as the bare per-endpoint identifier (RFC 8414 section 3.3)', () => {
    const meta = controller.getMetadata('ep-123', fakeRequest());
    expect(meta.issuer).toBe('https://scim.example.com/scim/endpoints/ep-123');
  });

  it('advertises the per-endpoint token endpoint, appended to the issuer (self-consistent)', () => {
    const meta = controller.getMetadata('ep-123', fakeRequest());
    expect(meta.token_endpoint).toBe('https://scim.example.com/scim/endpoints/ep-123/oauth/token');
    expect((meta.token_endpoint as string).startsWith(meta.issuer as string)).toBe(true);
  });

  it('advertises the SHARED global jwks_uri (one signing key today)', () => {
    const meta = controller.getMetadata('ep-123', fakeRequest());
    expect(meta.jwks_uri).toBe('https://scim.example.com/scim/oauth/jwks');
  });

  it('advertises client_credentials + token-exchange grant types', () => {
    const meta = controller.getMetadata('ep-123', fakeRequest());
    expect(meta.grant_types_supported).toEqual([
      'client_credentials',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ]);
  });

  it('honors x-forwarded-proto / x-forwarded-host (behind a proxy)', () => {
    const meta = controller.getMetadata(
      'ep-9',
      fakeRequest({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'public.example.net' }, 'http', 'internal:3000'),
    );
    expect(meta.issuer).toBe('https://public.example.net/scim/endpoints/ep-9');
  });
});
