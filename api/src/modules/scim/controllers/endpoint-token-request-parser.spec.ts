/**
 * W2.2 - strict token-request parser unit tests.
 *
 * The parser turns the raw RFC 6749 form + Authorization header into exactly one
 * discriminated-union variant, free of crypto/DB. These tests lock the routing
 * (client_assertion vs client_secret), the credential-location normalization
 * (RFC 6749 section 2.3.1 Basic vs body, body wins), and every error shape
 * (grant_type / mutual-exclusion / assertion-type / missing-credentials).
 */
import { HttpStatus } from '@nestjs/common';
import { parseEndpointTokenRequest } from './endpoint-token-request-parser';

const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** Build an Authorization: Basic header for id:secret. */
function basic(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

describe('parseEndpointTokenRequest (W2.2)', () => {
  describe('client_secret route', () => {
    it('parses a body client_secret_post request', () => {
      const p = parseEndpointTokenRequest({
        grant_type: 'client_credentials',
        client_id: 'epc_1',
        client_secret: 's3cret',
        scope: 'scim.read',
      });
      expect(p).toEqual({
        kind: 'client_secret',
        clientId: 'epc_1',
        clientSecret: 's3cret',
        credentialLocation: 'client_secret_post',
        scope: 'scim.read',
      });
    });

    it('parses credentials from the Authorization: Basic header (client_secret_basic)', () => {
      const p = parseEndpointTokenRequest(
        { grant_type: 'client_credentials' },
        basic('epc_2', 'headersecret'),
      );
      expect(p).toEqual({
        kind: 'client_secret',
        clientId: 'epc_2',
        clientSecret: 'headersecret',
        credentialLocation: 'client_secret_basic',
      });
    });

    it('body credentials win over the Basic header (location stays post)', () => {
      const p = parseEndpointTokenRequest(
        { grant_type: 'client_credentials', client_id: 'body_id', client_secret: 'bodysecret' },
        basic('header_id', 'headersecret'),
      );
      expect(p.kind).toBe('client_secret');
      if (p.kind === 'client_secret') {
        expect(p.clientId).toBe('body_id');
        expect(p.clientSecret).toBe('bodysecret');
        expect(p.credentialLocation).toBe('client_secret_post');
      }
    });
  });

  describe('client_assertion route', () => {
    it('parses a valid client_assertion (WIF) request', () => {
      const p = parseEndpointTokenRequest({
        grant_type: 'client_credentials',
        client_assertion: 'eyJhbGciOiJSUzI1NiJ9.payload.sig',
        client_assertion_type: JWT_BEARER,
      });
      expect(p).toEqual({
        kind: 'client_assertion',
        assertion: 'eyJhbGciOiJSUzI1NiJ9.payload.sig',
        assertionType: JWT_BEARER,
      });
    });

    it('W3.4: captures the RFC 8707 resource parameter on the client_assertion variant', () => {
      const p = parseEndpointTokenRequest({
        grant_type: 'client_credentials',
        client_assertion: 'a.b.c',
        client_assertion_type: JWT_BEARER,
        resource: 'https://api.successfactors.com',
      });
      expect(p).toEqual({
        kind: 'client_assertion',
        assertion: 'a.b.c',
        assertionType: JWT_BEARER,
        resource: 'https://api.successfactors.com',
      });
    });

    it('rejects an unsupported client_assertion_type', () => {
      const p = parseEndpointTokenRequest({
        grant_type: 'client_credentials',
        client_assertion: 'a.b.c',
        client_assertion_type: 'urn:something:else',
      });
      expect(p).toMatchObject({
        kind: 'invalid',
        error: 'invalid_request',
        reasonCode: 'unsupported_assertion_type',
        status: HttpStatus.BAD_REQUEST,
      });
    });
  });

  describe('invalid shapes', () => {
    it('rejects a non client_credentials grant_type', () => {
      const p = parseEndpointTokenRequest({ grant_type: 'authorization_code' });
      expect(p).toMatchObject({
        kind: 'invalid',
        error: 'unsupported_grant_type',
        reasonCode: 'grant_type_unsupported',
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects both client_assertion AND client_secret (mutually exclusive)', () => {
      const p = parseEndpointTokenRequest({
        grant_type: 'client_credentials',
        client_id: 'epc_1',
        client_secret: 's',
        client_assertion: 'a.b.c',
        client_assertion_type: JWT_BEARER,
      });
      expect(p).toMatchObject({
        kind: 'invalid',
        error: 'invalid_request',
        reasonCode: 'mutually_exclusive_credentials',
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('detects mutual exclusion when the secret comes from the Basic header', () => {
      const p = parseEndpointTokenRequest(
        { grant_type: 'client_credentials', client_assertion: 'a.b.c', client_assertion_type: JWT_BEARER },
        basic('epc_1', 'headersecret'),
      );
      expect(p).toMatchObject({ kind: 'invalid', reasonCode: 'mutually_exclusive_credentials' });
    });

    it('rejects a missing client_id / client_secret', () => {
      const p = parseEndpointTokenRequest({ grant_type: 'client_credentials', client_id: 'epc_1' });
      expect(p).toMatchObject({
        kind: 'invalid',
        error: 'invalid_request',
        reasonCode: 'missing_credentials',
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('an empty body (no grant_type) is an unsupported_grant_type', () => {
      const p = parseEndpointTokenRequest({});
      expect(p).toMatchObject({ kind: 'invalid', reasonCode: 'grant_type_unsupported' });
    });
  });
});
