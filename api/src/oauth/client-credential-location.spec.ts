import { parseBasicAuthHeader, resolveClientCredentials } from './client-credential-location';

describe('client-credential-location (RFC 6749 section 2.3.1)', () => {
  describe('parseBasicAuthHeader', () => {
    it('parses a well-formed Basic header', () => {
      const header = `Basic ${Buffer.from('my-client:my-secret').toString('base64')}`;
      expect(parseBasicAuthHeader(header)).toEqual({
        clientId: 'my-client',
        clientSecret: 'my-secret',
      });
    });

    it('is case-insensitive on the "Basic" scheme', () => {
      const header = `basic ${Buffer.from('id:secret').toString('base64')}`;
      expect(parseBasicAuthHeader(header)).toEqual({ clientId: 'id', clientSecret: 'secret' });
    });

    it('url-decodes each half (form-urlencoded per the RFC)', () => {
      const header = `Basic ${Buffer.from('cli%40ent:se%3Acret').toString('base64')}`;
      expect(parseBasicAuthHeader(header)).toEqual({
        clientId: 'cli@ent',
        clientSecret: 'se:cret',
      });
    });

    it('keeps only the first colon as the separator', () => {
      const header = `Basic ${Buffer.from('id:a:b:c').toString('base64')}`;
      expect(parseBasicAuthHeader(header)).toEqual({ clientId: 'id', clientSecret: 'a:b:c' });
    });

    it('returns empty for missing / non-Basic / malformed headers', () => {
      expect(parseBasicAuthHeader(undefined)).toEqual({});
      expect(parseBasicAuthHeader('')).toEqual({});
      expect(parseBasicAuthHeader('Bearer abc')).toEqual({});
      expect(parseBasicAuthHeader(`Basic ${Buffer.from('no-colon').toString('base64')}`)).toEqual({});
    });
  });

  describe('resolveClientCredentials', () => {
    it('uses body values (client_secret_post) when present', () => {
      const header = `Basic ${Buffer.from('header-id:header-secret').toString('base64')}`;
      expect(
        resolveClientCredentials({ clientId: 'body-id', clientSecret: 'body-secret' }, header),
      ).toEqual({ clientId: 'body-id', clientSecret: 'body-secret' });
    });

    it('falls back to header values (client_secret_basic) when body is empty', () => {
      const header = `Basic ${Buffer.from('header-id:header-secret').toString('base64')}`;
      expect(resolveClientCredentials({}, header)).toEqual({
        clientId: 'header-id',
        clientSecret: 'header-secret',
      });
    });

    it('returns undefined fields when neither source supplies them', () => {
      expect(resolveClientCredentials({})).toEqual({
        clientId: undefined,
        clientSecret: undefined,
      });
    });
  });
});
