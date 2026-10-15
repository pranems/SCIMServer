import { describe, expect, it } from 'vitest';
import { formatDateTime } from './date-time';

describe('formatDateTime', () => {
  it.each([
    ['2026-10-14T23:59:58.123Z', '2026-10-14 23:59:58.123 UTC'],
    ['2026-10-15T01:59:58.123+02:00', '2026-10-14 23:59:58.123 UTC'],
    [new Date('2026-10-15T12:34:56Z'), '2026-10-15 12:34:56.000 UTC'],
    [0, '1970-01-01 00:00:00.000 UTC'],
  ])('retains the date, time, milliseconds and explicit timezone for %s', (value, text) => {
    const result = formatDateTime(value);
    expect(result.text).toBe(text);
    expect(result.iso).toBeDefined();
    expect(new Date(result.iso!).toISOString().replace('T', ' ').replace('Z', ' UTC')).toBe(text);
  });

  it.each([null, undefined, ''])(
    'distinguishes missing timestamp %s from invalid data',
    (value) => {
      expect(formatDateTime(value)).toEqual({ text: '-' });
    },
  );

  it.each(['not-a-date', '2026-10-15', '2026-10-15T12:34:56', new Date(NaN), NaN])(
    'does not invent an instant for invalid or ambiguous input %s',
    (value) =>
      expect(formatDateTime(value)).toEqual({
        text: `Invalid timestamp: ${String(value)}`,
      }),
  );
});
