/**
 * Tests for safeCompare - timing-safe string comparison.
 * Closes S-2 (DELIVERY_PLAN.md section 3.2).
 *
 * What we assert:
 *   1. Equal strings of equal length return true.
 *   2. Unequal strings of equal length return false.
 *   3. Different-length inputs return false (without throwing - the underlying
 *      crypto.timingSafeEqual throws on length mismatch).
 *   4. Non-string inputs (null, undefined, number) return false (defensive).
 *   5. The implementation actually uses crypto.timingSafeEqual for equal-length
 *      inputs (verified via spy) - guarantees timing-safety property holds.
 *      We do NOT attempt a statistical timing test - those are flaky in CI.
 */
import { safeCompare } from './safe-compare';

describe('safeCompare', () => {
  it('returns true for two identical strings', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
  });

  it('returns true for two identical empty strings', () => {
    expect(safeCompare('', '')).toBe(true);
  });

  it('returns true for two identical long strings', () => {
    const s = 'a'.repeat(1024);
    expect(safeCompare(s, s)).toBe(true);
  });

  it('returns false for two different strings of the same length', () => {
    expect(safeCompare('abc', 'abd')).toBe(false);
  });

  it('returns false when first string is shorter', () => {
    expect(safeCompare('abc', 'abcd')).toBe(false);
  });

  it('returns false when second string is shorter', () => {
    expect(safeCompare('abcd', 'abc')).toBe(false);
  });

  it('returns false (does not throw) for length mismatch', () => {
    expect(() => safeCompare('a', 'longer-string-value')).not.toThrow();
    expect(safeCompare('a', 'longer-string-value')).toBe(false);
  });

  it('returns false for utf8 strings of different byte lengths but same character length', () => {
    // 'a' is 1 byte; 'ä' is 2 bytes in UTF-8 - both length-1 strings but
    // different byte lengths; safeCompare must compare bytes, not chars.
    expect(safeCompare('a', 'ä')).toBe(false);
  });

  it('returns true for matching utf8 multi-byte strings', () => {
    expect(safeCompare('café', 'café')).toBe(true);
  });

  it('returns false for null inputs', () => {
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare(null, 'abc')).toBe(false);
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare('abc', null)).toBe(false);
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare(null, null)).toBe(false);
  });

  it('returns false for undefined inputs', () => {
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare(undefined, 'abc')).toBe(false);
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare('abc', undefined)).toBe(false);
  });

  it('returns false for non-string inputs (number, object, array)', () => {
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare(123, '123')).toBe(false);
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare({}, {})).toBe(false);
    // @ts-expect-error - testing runtime guard against bad inputs
    expect(safeCompare([], [])).toBe(false);
  });

  it('uses node:crypto.timingSafeEqual for equal-length inputs', () => {
    // This guarantees the timing-safety property holds. If a future maintainer
    // accidentally replaces the implementation with === they will fail this.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    try {
      safeCompare('match-this', 'match-this');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('does NOT call timingSafeEqual when lengths differ (would throw)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    try {
      safeCompare('a', 'abc');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
