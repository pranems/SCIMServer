/**
 * uuid-guard — Unit tests for the PostgreSQL UUID format validation guard.
 *
 * Ensures `isValidUuid` correctly accepts valid UUID v1-v7 strings and
 * rejects malformed / non-UUID inputs that would cause PostgreSQL P2007
 * errors when passed to a @db.Uuid column.
 */
import { isValidUuid } from './uuid-guard';

describe('isValidUuid', () => {
  // ─── Valid UUIDs ─────────────────────────────────────────────────────

  it('should accept a canonical v4 UUID (lowercase)', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('should accept a canonical v4 UUID (uppercase)', () => {
    expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('should accept mixed-case UUID', () => {
    expect(isValidUuid('550e8400-E29B-41d4-a716-446655440000')).toBe(true);
  });

  it('should accept UUID v1', () => {
    expect(isValidUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
  });

  it('should accept UUID v7 (timestamp-ordered)', () => {
    expect(isValidUuid('019048e8-7d2a-7000-8000-000000000001')).toBe(true);
  });

  it('should accept the nil-equivalent UUID with valid variant', () => {
    expect(isValidUuid('00000000-0000-4000-a000-000000000001')).toBe(true);
  });

  // ─── Invalid inputs ─────────────────────────────────────────────────

  it('should reject empty string', () => {
    expect(isValidUuid('')).toBe(false);
  });

  it('should reject plain text (nonexistent)', () => {
    expect(isValidUuid('nonexistent')).toBe(false);
  });

  it('should reject slug-like IDs', () => {
    expect(isValidUuid('does-not-exist')).toBe(false);
  });

  it('should reject UUID without hyphens', () => {
    expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('should reject UUID with extra characters', () => {
    expect(isValidUuid('{550e8400-e29b-41d4-a716-446655440000}')).toBe(false);
  });

  it('should reject UUID with wrong segment length', () => {
    expect(isValidUuid('550e840-0e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('should reject UUID with invalid hex characters', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
  });

  it('should reject numeric-only strings', () => {
    expect(isValidUuid('12345678')).toBe(false);
  });

  it('should reject strings with spaces', () => {
    expect(isValidUuid('550e8400 e29b 41d4 a716 446655440000')).toBe(false);
  });
});
