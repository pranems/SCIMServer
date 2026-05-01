/**
 * Tests for parseCorsOrigin - configurable CORS origin parsing.
 * Closes S-4 (DELIVERY_PLAN.md section 3.2).
 */
import { parseCorsOrigin } from './cors-origin';

describe('parseCorsOrigin', () => {
  it('returns true when env var is undefined (backward-compat default)', () => {
    expect(parseCorsOrigin(undefined)).toBe(true);
  });

  it('returns true when env var is empty string (backward-compat default)', () => {
    expect(parseCorsOrigin('')).toBe(true);
  });

  it('returns true when env var is whitespace only', () => {
    expect(parseCorsOrigin('   ')).toBe(true);
  });

  it('returns true when env var is the literal "*" (explicit allow-all)', () => {
    expect(parseCorsOrigin('*')).toBe(true);
  });

  it('returns false when env var is the literal "false" (explicit no-CORS)', () => {
    expect(parseCorsOrigin('false')).toBe(false);
  });

  it('returns false when env var is the literal "none"', () => {
    expect(parseCorsOrigin('none')).toBe(false);
  });

  it('returns the single origin when env var is a single URL', () => {
    expect(parseCorsOrigin('https://app.example.com')).toBe('https://app.example.com');
  });

  it('strips surrounding whitespace on a single-origin value', () => {
    expect(parseCorsOrigin('  https://app.example.com  ')).toBe('https://app.example.com');
  });

  it('returns an array of origins when env var is comma-separated', () => {
    expect(parseCorsOrigin('https://a.example.com,https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('trims whitespace around each comma-separated origin', () => {
    expect(parseCorsOrigin('https://a.example.com , https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('drops empty entries (trailing comma, blank in the middle)', () => {
    expect(parseCorsOrigin('https://a.example.com,,https://b.example.com,')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('returns false when comma-separated list is entirely empty after trim', () => {
    expect(parseCorsOrigin(',,, ,')).toBe(false);
  });

  it('treats a single allowlisted entry as a single string, not an array', () => {
    // Express-style cors() accepts string | string[] | boolean | RegExp.
    // Returning a single string when there is exactly one entry is more idiomatic.
    expect(parseCorsOrigin('https://only.example.com,')).toBe('https://only.example.com');
  });
});
