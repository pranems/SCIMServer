import {
  assertProfileRevision,
  endpointProfileRevision,
  profileRevisionArgument,
} from './profile-revision';

describe('endpoint profile revisions', () => {
  it('is independent of recursive object-key order', () => {
    const left = {
      settings: { StrictSchemaValidation: true, RequireIfMatch: false },
      serviceProviderConfig: { patch: { supported: true } },
    };
    const right = {
      serviceProviderConfig: { patch: { supported: true } },
      settings: { RequireIfMatch: false, StrictSchemaValidation: true },
    };

    expect(endpointProfileRevision(left)).toBe(endpointProfileRevision(right));
  });

  it('preserves array order in the revision', () => {
    expect(endpointProfileRevision({ resourceTypes: ['User', 'Group'] }))
      .not.toBe(endpointProfileRevision({ resourceTypes: ['Group', 'User'] }));
  });

  it('raises the typed repository conflict when content changes', () => {
    const expected = endpointProfileRevision({ settings: { enabled: true } });

    expect(() => assertProfileRevision({ settings: { enabled: false } }, expected))
      .toThrow(expect.objectContaining({ code: 'PROFILE_CHANGED' }));
  });

  it('forwards only observable revisions to repository calls', () => {
    const revision = endpointProfileRevision(null);

    expect(profileRevisionArgument(undefined)).toEqual([]);
    expect(profileRevisionArgument(revision)).toEqual([revision]);
  });
});
