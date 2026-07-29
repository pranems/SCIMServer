import { randomUUID } from 'node:crypto';
import { toStorableRequestId } from './storable-request-id';
import { isUuid } from '../../shared/uuid';

/**
 * `RequestLog.requestId` is a `@db.Uuid` column. The correlation middleware runs
 * BEFORE guards and propagates the client's `X-Request-Id` verbatim, so ANY
 * caller can put arbitrary text on this path.
 *
 * Log rows flush in batches of up to 50 via one `createMany`; the batch is
 * drained from the buffer BEFORE the insert, and a failure is only logged - so
 * one poisoned row silently destroys up to 49 unrelated audit-log rows. These
 * tests lock the choke point that makes that impossible.
 */
describe('toStorableRequestId (audit-log integrity guard)', () => {
  it('keeps a valid UUID so genuine correlation still works', () => {
    const id = randomUUID();
    expect(toStorableRequestId(id)).toBe(id);
  });

  it('keeps a valid UUID regardless of case', () => {
    const id = randomUUID().toUpperCase();
    expect(toStorableRequestId(id)).toBe(id);
  });

  it('returns null for undefined or null', () => {
    expect(toStorableRequestId(undefined)).toBeNull();
    expect(toStorableRequestId(null)).toBeNull();
  });

  it('returns null for an empty or whitespace id', () => {
    expect(toStorableRequestId('')).toBeNull();
    expect(toStorableRequestId('   ')).toBeNull();
  });

  it('NULLS a non-UUID id rather than letting it poison the batch', () => {
    expect(toStorableRequestId('e2e-custom-request-id-12345')).toBeNull();
  });

  it('nulls values that merely look UUID-ish', () => {
    const nearMisses = [
      '00000000-0000-0000-0000-00000000000',
      '00000000-0000-0000-0000-0000000000000',
      '0000000-00000-0000-0000-000000000000',
      'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
      '00000000000000000000000000000000',
    ];
    for (const raw of nearMisses) expect(toStorableRequestId(raw)).toBeNull();
  });

  it('neutralises hostile header values', () => {
    const hostile = [
      "'; DROP TABLE \"RequestLog\"; --",
      '../../etc/passwd',
      'x'.repeat(10_000),
      '<script>alert(1)</script>',
    ];
    for (const raw of hostile) expect(toStorableRequestId(raw)).toBeNull();
  });
});

describe('isUuid', () => {
  it('accepts canonical UUIDs only', () => {
    expect(isUuid(randomUUID())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(12345)).toBe(false);
    // An array-valued header (duplicated X-Request-Id) must not throw.
    expect(isUuid(['a', 'b'])).toBe(false);
  });
});
