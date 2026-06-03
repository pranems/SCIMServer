import { buildBaseUrl } from './base-url.util';

describe('buildBaseUrl', () => {
  function mockRequest(overrides: Partial<{
    protocol: string;
    headers: Record<string, string>;
    host: string;
  }> = {}) {
    return {
      protocol: overrides.protocol ?? 'http',
      headers: overrides.headers ?? {},
      get: jest.fn((header: string) => {
        if (header === 'host') return overrides.host ?? 'localhost:3000';
        return undefined;
      }),
    } as any;
  }

  afterEach(() => {
    delete process.env.API_PREFIX;
  });

  it('should build base URL from request protocol and host', () => {
    const req = mockRequest({ protocol: 'http', host: 'localhost:3000' });
    const result = buildBaseUrl(req);
    expect(result).toBe('http://localhost:3000/scim/v2');
  });

  it('should use https protocol when set', () => {
    const req = mockRequest({ protocol: 'https', host: 'api.example.com' });
    const result = buildBaseUrl(req);
    expect(result).toBe('https://api.example.com/scim/v2');
  });

  it('should prefer x-forwarded-proto header over request protocol', () => {
    const req = mockRequest({
      protocol: 'http',
      host: 'api.example.com',
      headers: { 'x-forwarded-proto': 'https' },
    });
    const result = buildBaseUrl(req);
    expect(result).toBe('https://api.example.com/scim/v2');
  });

  it('should prefer x-forwarded-host header over request host', () => {
    const req = mockRequest({
      protocol: 'https',
      host: 'internal:8080',
      headers: { 'x-forwarded-host': 'public.example.com' },
    });
    const result = buildBaseUrl(req);
    expect(result).toBe('https://public.example.com/scim/v2');
  });

  it('should use both x-forwarded-proto and x-forwarded-host when present', () => {
    const req = mockRequest({
      protocol: 'http',
      host: 'internal:8080',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.external.com',
      },
    });
    const result = buildBaseUrl(req);
    expect(result).toBe('https://api.external.com/scim/v2');
  });

  it('should use custom API_PREFIX when set', () => {
    process.env.API_PREFIX = 'custom-prefix';
    const req = mockRequest({ protocol: 'http', host: 'localhost:3000' });
    const result = buildBaseUrl(req);
    expect(result).toBe('http://localhost:3000/custom-prefix/v2');
  });

  it('should default to scim prefix when API_PREFIX is not set', () => {
    delete process.env.API_PREFIX;
    const req = mockRequest({ protocol: 'http', host: 'localhost:8080' });
    const result = buildBaseUrl(req);
    expect(result).toBe('http://localhost:8080/scim/v2');
  });
});
