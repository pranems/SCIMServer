import { decodeJwt, looksLikeJwt } from './jwt-decode.util';

function makeJwt(header: object, payload: object, sig = 'sigbytes'): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${sig}`;
}

describe('decodeJwt', () => {
  it('decodes a well-formed JWT header + payload (no verification)', () => {
    const token = makeJwt({ alg: 'RS256', kid: 'k1', typ: 'JWT' }, { sub: 'u1', aud: 'api://x', iat: 1 });
    const out = decodeJwt(token);
    expect(out.isJwt).toBe(true);
    expect(out.header).toMatchObject({ alg: 'RS256', kid: 'k1' });
    expect(out.payload).toMatchObject({ sub: 'u1', aud: 'api://x' });
    expect(out.signaturePresent).toBe(true);
  });

  it('accepts a Bearer-prefixed header value', () => {
    const token = 'Bearer ' + makeJwt({ alg: 'RS256' }, { sub: 'u2' });
    const out = decodeJwt(token);
    expect(out.isJwt).toBe(true);
    expect(out.payload).toMatchObject({ sub: 'u2' });
  });

  it('reports signaturePresent=false for an unsigned (alg=none) token with empty sig', () => {
    const out = decodeJwt(makeJwt({ alg: 'none' }, { sub: 'u3' }, ''));
    expect(out.isJwt).toBe(true);
    expect(out.signaturePresent).toBe(false);
  });

  it('returns isJwt=false for a non-JWT string', () => {
    expect(decodeJwt('not-a-jwt').isJwt).toBe(false);
    expect(decodeJwt('a.b').isJwt).toBe(false);
    expect(decodeJwt('').isJwt).toBe(false);
    expect(decodeJwt(undefined).isJwt).toBe(false);
  });

  it('returns isJwt=false for a 3-segment string that is not valid base64url JSON', () => {
    const out = decodeJwt('eyJ.@@@.sig');
    expect(out.isJwt).toBe(false);
    expect(out.reason).toBeDefined();
  });

  it('never throws on hostile input', () => {
    expect(() => decodeJwt({} as unknown)).not.toThrow();
    expect(() => decodeJwt('....')).not.toThrow();
  });
});

describe('looksLikeJwt', () => {
  it('matches a real JWT shape', () => {
    expect(looksLikeJwt(makeJwt({ alg: 'RS256' }, { sub: 'u' }))).toBe(true);
    expect(looksLikeJwt('Bearer ' + makeJwt({ alg: 'RS256' }, { sub: 'u' }))).toBe(true);
  });
  it('rejects non-JWT strings', () => {
    expect(looksLikeJwt('hello')).toBe(false);
    expect(looksLikeJwt('a.b.c')).toBe(false);
    expect(looksLikeJwt(42)).toBe(false);
  });
});
