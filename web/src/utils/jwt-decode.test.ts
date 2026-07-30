import { describe, it, expect } from 'vitest';
import { decodeJwt, looksLikeJwt, findJwtsInValue } from './jwt-decode';

function makeJwt(header: object, payload: object, sig = 'sig'): string {
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc(header)}.${enc(payload)}.${sig}`;
}

describe('decodeJwt', () => {
  it('decodes header + payload', () => {
    const out = decodeJwt(makeJwt({ alg: 'RS256', kid: 'k' }, { sub: 'u1', aud: 'api://x' }));
    expect(out.isJwt).toBe(true);
    expect(out.header).toMatchObject({ alg: 'RS256', kid: 'k' });
    expect(out.payload).toMatchObject({ sub: 'u1' });
    expect(out.signaturePresent).toBe(true);
  });

  it('strips a Bearer prefix', () => {
    const out = decodeJwt('Bearer ' + makeJwt({ alg: 'RS256' }, { sub: 'u2' }));
    expect(out.isJwt).toBe(true);
    expect(out.payload).toMatchObject({ sub: 'u2' });
  });

  it('returns isJwt=false for non-JWT input, never throws', () => {
    expect(decodeJwt('nope').isJwt).toBe(false);
    expect(decodeJwt('').isJwt).toBe(false);
    expect(decodeJwt(undefined).isJwt).toBe(false);
    expect(() => decodeJwt({} as unknown)).not.toThrow();
  });
});

describe('looksLikeJwt', () => {
  it('matches a real JWT shape', () => {
    expect(looksLikeJwt(makeJwt({ alg: 'RS256' }, { sub: 'u' }))).toBe(true);
  });
  it('rejects non-JWT', () => {
    expect(looksLikeJwt('a.b.c')).toBe(false);
    expect(looksLikeJwt(42)).toBe(false);
  });
});

describe('findJwtsInValue', () => {
  it('finds JWTs nested in an object, keyed by path', () => {
    const jwt = makeJwt({ alg: 'RS256' }, { sub: 'u' });
    const found = findJwtsInValue({
      authorization: `Bearer ${jwt}`,
      nested: { access_token: jwt },
      plain: 'not-a-jwt',
    });
    const paths = found.map((f) => f.path);
    expect(paths).toContain('authorization');
    expect(paths).toContain('nested.access_token');
    expect(paths).not.toContain('plain');
  });

  it('finds JWTs inside arrays', () => {
    const jwt = makeJwt({ alg: 'RS256' }, { sub: 'u' });
    const found = findJwtsInValue({ Operations: [{ value: jwt }] });
    expect(found.map((f) => f.path)).toContain('Operations[0].value');
  });
});
