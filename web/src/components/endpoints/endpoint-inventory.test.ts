import { describe, expect, it } from 'vitest';
import { matchesEndpoint, endpointProfileLabel } from './endpoint-inventory';

const active = { id: 'ep-1', name: 'tenant', displayName: 'Production', active: true };
const inactive = { ...active, id: 'ep-2', active: false };

describe('endpoint inventory identity', () => {
  it('treats Active and Inactive as exact status keywords', () => {
    expect(matchesEndpoint(active, ' Active ')).toBe(true);
    expect(matchesEndpoint(inactive, 'Active')).toBe(false);
    expect(matchesEndpoint(active, 'inactive')).toBe(false);
    expect(matchesEndpoint(inactive, 'inactive')).toBe(true);
  });
  it('matches display name, stable name and complete id without inventing a profile', () => {
    for (const query of ['production', 'TENANT', 'ep-1', '']) expect(matchesEndpoint(active, query)).toBe(true);
    expect(matchesEndpoint(active, 'missing')).toBe(false);
    expect(endpointProfileLabel(active)).toBe('No profile summary');
  });
});
