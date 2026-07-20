import { redactSensitiveDeep, isSensitiveKey, REDACTED } from './redact-sensitive';

describe('redact-sensitive', () => {
  describe('isSensitiveKey', () => {
    it('flags secret-bearing key names (case-insensitive)', () => {
      for (const k of [
        'authorization',
        'Authorization',
        'client_secret',
        'clientSecret',
        'password',
        'access_token',
        'refresh_token',
        'client_assertion',
        'cookie',
        'credentialHash',
        'x-api-key',
        'apiKey',
        'Bearer',
      ]) {
        expect(isSensitiveKey(k)).toBe(true);
      }
    });

    it('leaves non-secret key names alone', () => {
      for (const k of ['userName', 'client_id', 'endpointId', 'displayName', 'status', 'grant_type']) {
        expect(isSensitiveKey(k)).toBe(false);
      }
    });
  });

  describe('redactSensitiveDeep', () => {
    it('redacts top-level secret keys, preserves the rest', () => {
      const out = redactSensitiveDeep({ client_id: 'abc', client_secret: 'shhh', scope: 'read' });
      expect(out).toEqual({ client_id: 'abc', client_secret: REDACTED, scope: 'read' });
    });

    it('redacts NESTED secret keys (the RequestLog body case)', () => {
      const out = redactSensitiveDeep({
        body: { grant_type: 'client_credentials', client_id: 'x', client_secret: 'shhh' },
        headers: { authorization: 'Basic abc123', 'content-type': 'application/json' },
      });
      expect(out).toEqual({
        body: { grant_type: 'client_credentials', client_id: 'x', client_secret: REDACTED },
        headers: { authorization: REDACTED, 'content-type': 'application/json' },
      });
    });

    it('redacts secret keys inside arrays', () => {
      const out = redactSensitiveDeep({
        creds: [
          { label: 'a', secret: 's1' },
          { label: 'b', secret: 's2' },
        ],
      });
      expect(out).toEqual({
        creds: [
          { label: 'a', secret: REDACTED },
          { label: 'b', secret: REDACTED },
        ],
      });
    });

    it('redacts a token response body (access_token / refresh_token)', () => {
      const out = redactSensitiveDeep({
        access_token: 'jwt.value.here',
        refresh_token: 'r.value',
        token_type: 'Bearer',
        expires_in: 3600,
      });
      expect(out).toEqual({
        access_token: REDACTED,
        refresh_token: REDACTED,
        // token_type contains "token" -> intentionally redacted (harmless, always "Bearer")
        token_type: REDACTED,
        expires_in: 3600,
      });
    });

    it('does not mutate the input object', () => {
      const input = { client_secret: 'shhh', nested: { password: 'p' } };
      const out = redactSensitiveDeep(input);
      expect(input.client_secret).toBe('shhh');
      expect(input.nested.password).toBe('p');
      expect(out.client_secret).toBe(REDACTED);
    });

    it('returns primitives, null, and undefined unchanged', () => {
      expect(redactSensitiveDeep('hello')).toBe('hello');
      expect(redactSensitiveDeep(42)).toBe(42);
      expect(redactSensitiveDeep(null)).toBeNull();
      expect(redactSensitiveDeep(undefined)).toBeUndefined();
    });

    it('is cycle-safe (does not throw or loop)', () => {
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;
      expect(() => redactSensitiveDeep(a)).not.toThrow();
      const out = redactSensitiveDeep(a);
      expect(out.name).toBe('a');
      expect(out.self).toBe('[Circular]');
    });
  });
});
