import { endpointETag, assertEndpointIfMatch } from './endpoint-etag';
import type { EndpointResponse } from '../services/endpoint.service';

/**
 * A9 - two operators editing one endpoint profile could silently clobber each
 * other: last write wins, with no signal to the loser that their change was
 * overwritten. These lock the optimistic-concurrency token.
 */
describe('endpoint ETag (A9)', () => {
  const base = {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'ep',
    displayName: 'Endpoint',
    description: 'desc',
    active: true,
    updatedAt: new Date('2026-08-19T10:00:00.000Z'),
    profile: { settings: { StrictSchemaValidation: 'True' } },
  } as unknown as EndpointResponse;

  describe('endpointETag', () => {
    it('A9-T1: is a weak ETag', () => {
      expect(endpointETag(base)).toMatch(/^W\/"[a-f0-9]+"$/);
    });

    it('A9-T2: is stable for identical content', () => {
      expect(endpointETag(base)).toBe(endpointETag({ ...base }));
    });

    it('A9-T3: changes when the profile changes', () => {
      const edited = { ...base, profile: { settings: { StrictSchemaValidation: 'False' } } } as unknown as EndpointResponse;
      expect(endpointETag(edited)).not.toBe(endpointETag(base));
    });

    it('A9-T4: changes when a scalar field changes', () => {
      expect(endpointETag({ ...base, displayName: 'Renamed' })).not.toBe(endpointETag(base));
      expect(endpointETag({ ...base, active: false })).not.toBe(endpointETag(base));
    });

    it('A9-T5: does NOT change for fields a caller cannot edit', () => {
      // `name` is immutable after create and `id` identifies the row, so neither
      // participates in a lost-update. Including them would only produce
      // spurious conflicts.
      expect(endpointETag({ ...base, id: 'other-id' })).toBe(endpointETag(base));
    });
  });

  describe('assertEndpointIfMatch', () => {
    it('A9-T6: allows the write when no If-Match is sent (backward compatible)', () => {
      expect(() => assertEndpointIfMatch(base, undefined)).not.toThrow();
    });

    it('A9-T7: allows the write when the If-Match matches', () => {
      expect(() => assertEndpointIfMatch(base, endpointETag(base))).not.toThrow();
    });

    it('A9-T8: allows the wildcard', () => {
      expect(() => assertEndpointIfMatch(base, '*')).not.toThrow();
    });

    it('A9-T9: rejects a stale If-Match with 412', () => {
      const stale = endpointETag(base);
      const moved = { ...base, profile: { settings: { StrictSchemaValidation: 'False' } } } as unknown as EndpointResponse;

      let status: number | undefined;
      try {
        assertEndpointIfMatch(moved, stale);
      } catch (err) {
        status = (err as { status?: number; getStatus?: () => number }).status
          ?? (err as { getStatus?: () => number }).getStatus?.();
      }
      expect(status).toBe(412);
    });

    it('A9-T10: the rejection names both sides so the caller can resolve it', () => {
      const stale = endpointETag(base);
      const moved = { ...base, active: false } as EndpointResponse;

      try {
        assertEndpointIfMatch(moved, stale);
        throw new Error('expected a 412');
      } catch (err) {
        // Assert on the response OBJECT, not a JSON blob: stringifying escapes
        // the quotes inside W/"..." so a substring match would never hit.
        const body = (err as { getResponse: () => Record<string, unknown> }).getResponse();
        expect(String(body.detail)).toContain(stale);
        expect(String(body.detail)).toContain(endpointETag(moved));
        expect(body.currentETag).toBe(endpointETag(moved));
        expect(body.scimType).toBe('versionMismatch');
      }
    });
  });
});

