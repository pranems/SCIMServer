import { buildGenericFilter, buildGroupFilter, buildUserFilter } from './apply-scim-filter';

describe('Query push-down respects schema caseExact (P6b)', () => {
  it.each([buildUserFilter, buildGroupFilter, buildGenericFilter])(
    '%p keeps exact string comparisons out of CITEXT',
    (build) => {
      const filter = build('displayName ne "abc"', new Set(['displayname']));
      expect(filter.fetchAll).toBe(true);
      expect(filter.dbWhere).toEqual({});
      expect(filter.inMemoryFilter?.({ displayName: 'AbC' })).toBe(true);
      expect(filter.inMemoryFilter?.({ displayName: 'abc' })).toBe(false);
    },
  );
});
