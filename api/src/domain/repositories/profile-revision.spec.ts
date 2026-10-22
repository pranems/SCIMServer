import {
  assertProfileRevision,
  assertProfileRevisionValue,
  endpointProfileRevision,
  profileRevisionArgument,
} from './profile-revision';

describe('endpoint profile revisions', () => {
  const snapshot = { endpointId: 'endpoint-a', snapshotRevision: 'revision-a' };
  const observation = {
    ...snapshot, contentRevision: endpointProfileRevision({ settings: { enabled: true } }),
  };

  it('does not inspect an omitted body when the exact scoped database snapshot is proven', () => {
    const unreadable = new Proxy({}, { ownKeys: () => { throw new Error('Profile body was traversed'); } });
    expect(() => assertProfileRevision(unreadable, observation, snapshot)).not.toThrow();
  });

  it.each([
    undefined,
    { ...snapshot, endpointId: 'endpoint-b' },
    { ...snapshot, snapshotRevision: 'revision-b' },
  ])('falls back to content checking when snapshot proof does not match: %j', actual => {
    expect(() => assertProfileRevision({ settings: { enabled: true } }, observation, actual)).not.toThrow();
    expect(() => assertProfileRevision({ settings: { enabled: false } }, observation, actual))
      .toThrow(expect.objectContaining({ code: 'PROFILE_CHANGED' }));
  });

  it('retains content equality for InMemory and legacy callers without snapshot authority', () => {
    expect(() => assertProfileRevisionValue(observation.contentRevision, observation)).not.toThrow();
    expect(() => assertProfileRevisionValue(observation, observation.contentRevision)).not.toThrow();
    expect(() => assertProfileRevisionValue('changed', observation))
      .toThrow(expect.objectContaining({ code: 'PROFILE_CHANGED' }));
    expect(profileRevisionArgument(observation)).toEqual([observation]);
  });

  it('uses exact key ordering even when distinct Unicode keys collate equally', () => {
    const first = '\u00e9';
    const second = 'e\u0301';
    const left = { [first]: 'first', [second]: 'second' };
    const right = { [second]: 'second', [first]: 'first' };
    expect(endpointProfileRevision(left)).toBe(endpointProfileRevision(right));
    expect(endpointProfileRevision(left)).not.toBe(endpointProfileRevision({ [first]: 'changed', [second]: 'second' }));
  });

  it('does not invoke locale collation while hashing exact JSON keys', () => {
    const compare = jest.spyOn(String.prototype, 'localeCompare');
    let comparisons: number;
    let revision: string;
    try {
      revision = endpointProfileRevision({
        settings: { StrictSchemaValidation: true, RequireIfMatch: false },
        serviceProviderConfig: { patch: { supported: true } },
      });
      comparisons = compare.mock.calls.length;
    } finally {
      compare.mockRestore();
    }
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(comparisons).toBe(0);
  });

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

  it('preserves exact prototype-shaped keys as content, not object behavior', () => {
    const left: unknown = JSON.parse('{"__proto__":{"enabled":true},"constructor":{"name":"test"}}');
    const right: unknown = JSON.parse('{"constructor":{"name":"test"},"__proto__":{"enabled":true}}');
    expect(endpointProfileRevision(left)).toBe(endpointProfileRevision(right));
    expect(endpointProfileRevision(left)).not.toBe(endpointProfileRevision({ constructor: { name: 'test' } }));
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

  it('ignores lazily-built runtime schema caches when computing the persisted profile revision', () => {
    const persisted = {
      settings: { StrictSchemaValidation: true },
      schemas: [{ id: 'urn:example:User', name: 'User', attributes: [] }],
    };
    const runtimeProfile = {
      ...persisted,
      _schemaCaches: {
        'urn:example:User': {
          booleansByParent: new Map([['root', new Set(['active'])]]),
          extensionUrns: ['urn:example:extension'],
        },
      },
    };

    expect(endpointProfileRevision(runtimeProfile)).toBe(endpointProfileRevision(persisted));
  });
});
