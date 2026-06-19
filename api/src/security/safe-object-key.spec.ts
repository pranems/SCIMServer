import { isUnsafeObjectKey } from './safe-object-key';

/**
 * Security - prototype-pollution key guard (CWE-1321).
 */
describe('isUnsafeObjectKey', () => {
  it('flags __proto__ as unsafe', () => {
    expect(isUnsafeObjectKey('__proto__')).toBe(true);
  });

  it('flags constructor as unsafe', () => {
    expect(isUnsafeObjectKey('constructor')).toBe(true);
  });

  it('flags prototype as unsafe', () => {
    expect(isUnsafeObjectKey('prototype')).toBe(true);
  });

  it('allows ordinary attribute names', () => {
    expect(isUnsafeObjectKey('userName')).toBe(false);
    expect(isUnsafeObjectKey('issuer')).toBe(false);
    expect(isUnsafeObjectKey('emails')).toBe(false);
    expect(isUnsafeObjectKey('')).toBe(false);
  });
});
