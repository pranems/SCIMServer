import { describe, it, expect } from 'vitest';
import { isKeepaliveLog, looksLikeKeepaliveFromUrl } from './keepalive';

describe('isKeepaliveLog', () => {
  it('returns false for undefined/null', () => {
    expect(isKeepaliveLog(undefined)).toBe(false);
    expect(isKeepaliveLog(null)).toBe(false);
  });

  it('returns false for non-GET methods', () => {
    expect(isKeepaliveLog({
      method: 'POST',
      url: '/scim/endpoints/abc/Users?filter=userName+eq+"a1b2c3d4-e5f6-7890-abcd-ef1234567890"',
      status: 200,
    })).toBe(false);
  });

  it('returns false for non-Users URLs', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Groups?filter=userName+eq+"a1b2c3d4-e5f6-7890-abcd-ef1234567890"',
      status: 200,
    })).toBe(false);
  });

  it('returns true for typical Entra keepalive probe', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Users?filter=userName+eq+%22a1b2c3d4-e5f6-7890-abcd-ef1234567890%22',
      status: 200,
    })).toBe(true);
  });

  it('returns true with unencoded UUID filter', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Users?filter=userName eq "a1b2c3d4-e5f6-7890-abcd-ef1234567890"',
      status: 200,
    })).toBe(true);
  });

  it('returns false when userName filter is not a UUID', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Users?filter=userName+eq+"jdoe@example.com"',
      status: 200,
    })).toBe(false);
  });

  it('returns false when identifier is present', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Users?filter=userName+eq+"a1b2c3d4-e5f6-7890-abcd-ef1234567890"',
      status: 200,
      reportableIdentifier: 'some-user',
    })).toBe(false);
  });

  it('returns false for error status codes', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Users?filter=userName+eq+"a1b2c3d4-e5f6-7890-abcd-ef1234567890"',
      status: 401,
    })).toBe(false);
  });

  it('returns true when status is undefined (no status recorded)', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Users?filter=userName+eq+"a1b2c3d4-e5f6-7890-abcd-ef1234567890"',
    })).toBe(true);
  });

  it('returns false when no filter parameter', () => {
    expect(isKeepaliveLog({
      method: 'GET',
      url: '/scim/endpoints/abc/Users',
      status: 200,
    })).toBe(false);
  });

  it('is case-insensitive for method', () => {
    expect(isKeepaliveLog({
      method: 'get',
      url: '/scim/endpoints/abc/Users?filter=userName+eq+"a1b2c3d4-e5f6-7890-abcd-ef1234567890"',
      status: 200,
    })).toBe(true);
  });
});

describe('looksLikeKeepaliveFromUrl', () => {
  it('returns false for null/undefined', () => {
    expect(looksLikeKeepaliveFromUrl(null)).toBe(false);
    expect(looksLikeKeepaliveFromUrl(undefined)).toBe(false);
  });

  it('returns true for URL with UUID userName filter', () => {
    expect(looksLikeKeepaliveFromUrl(
      '/Users?filter=userName+eq+"a1b2c3d4-e5f6-7890-abcd-ef1234567890"'
    )).toBe(true);
  });

  it('returns false for URL with email userName filter', () => {
    expect(looksLikeKeepaliveFromUrl(
      '/Users?filter=userName+eq+"user@example.com"'
    )).toBe(false);
  });

  it('returns false for URL without filter', () => {
    expect(looksLikeKeepaliveFromUrl('/Users')).toBe(false);
  });
});
