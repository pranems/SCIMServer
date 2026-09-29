import { assertUnique, compileUniquenessPolicy, uniquenessPayload } from './uniqueness-policy';
import type { SchemaAttributeDefinition } from '../validation/validation-types';
import { InMemoryUserRepository } from '../../infrastructure/repositories/inmemory/inmemory-user.repository';
import { InMemoryGroupRepository } from '../../infrastructure/repositories/inmemory/inmemory-group.repository';
import { InMemoryGenericResourceRepository } from '../../infrastructure/repositories/inmemory/inmemory-generic-resource.repository';

const urn = 'urn:example:unique';
function policy(attr: Partial<SchemaAttributeDefinition> = {}, core = false) {
  return compileUniquenessPolicy([{ id: urn, isCoreSchema: core, attributes: [
    { name: 'code', type: 'string', uniqueness: 'server', multiValued: false, required: false, ...attr },
  ] }]);
}

describe('typed uniqueness policy', () => {
  it('does not infer an extension to be core from a substring in its URN', () => {
    const extension = 'urn:example:core:DeviceExtension';
    const unique = compileUniquenessPolicy([{ id: extension, attributes: [
      { name: 'badge', type: 'string', required: false, multiValued: false, uniqueness: 'server' },
    ] }]);
    expect(unique[0].schemaUrn).toBe(extension);
    expect(() => assertUnique(unique, { [extension]: { badge: 'x' } }, [{ [extension]: { badge: 'x' } }])).toThrow('already owned');
  });
  it.each([
    { code: [{ leaf: 'free', LEAF: 'taken' }] },
    { code: [{ LEAF: 'taken', leaf: 'free' }] },
  ])('rejects ambiguous aliases before JSONB can reorder them: %j', (value) => {
    const unique = policy({ type: 'complex', uniqueness: 'none', multiValued: true, subAttributes: [
      { name: 'leaf', type: 'string', required: false, multiValued: false, uniqueness: 'server' },
    ] });
    expect(() => assertUnique(unique, { [urn]: value }, [{ [urn]: { code: [{ leaf: 'taken' }] } }]))
      .toThrow('case-insensitive');
  });
  it('collects all scalar leaves, including extension names matching promoted columns', () => {
    expect(policy({ name: 'displayName' })[0]).toEqual({
      schemaUrn: urn, path: [{ name: 'displayName', multiValued: false }], type: 'string', caseExact: false,
    });
    expect(policy({ type: 'complex', uniqueness: 'none', multiValued: true, subAttributes: [
      { name: 'leaf', type: 'integer', uniqueness: 'server', multiValued: false, required: false },
    ] })[0].path).toEqual([{ name: 'code', multiValued: true }, { name: 'leaf', multiValued: false }]);
  });
  it.each(['none', undefined] as const)('does not impose uniqueness for %s', (uniqueness) => {
    expect(policy({ uniqueness })).toEqual([]);
  });
  it.each([
    { uniqueness: 'global' }, { type: 'complex' }, { type: 'boolean' },
    { type: 'dateTime' }, { type: 'binary' },
  ] as const)('fails closed for unsupported %j', (attr) => {
    expect(() => policy(attr)).toThrow('Unsupported uniqueness declaration');
  });
  it.each([
    { name: 'displayName', type: 'integer' }, { name: 'externalId', multiValued: true },
    { name: 'active', type: 'string' },
    { name: 'meta', type: 'complex', uniqueness: 'none', subAttributes: [
      { name: 'location', type: 'reference', uniqueness: 'server', multiValued: false, required: false },
    ] },
  ])('does not promise unsupported promoted/computed core shape %j', (attr) => {
    expect(() => policy(attr, true)).toThrow('Unsupported uniqueness declaration');
  });
  it('does not ignore malformed complex ancestry', () => {
    const unique = policy({ type: 'complex', uniqueness: 'none', subAttributes: [
      { name: 'leaf', type: 'string', uniqueness: 'server', multiValued: false, required: false },
    ] });
    expect(() => assertUnique(unique, { [urn]: { code: 'not-an-object' } }, [])).toThrow();
  });
  it.each([
    ['string', 'X', 'x'], ['integer', 0, -0], ['decimal', 4.0, 4],
    ['reference', 'https://example.com/Resource', 'https://example.com/Resource'],
  ])('compares %s values by typed equality', (type, first, second) => {
    expect(() => assertUnique(policy({ type }), { [urn]: { code: first } }, [{ [urn]: { code: second } }])).toThrow('already owned');
  });
  it.each([undefined, false, true])('reference equality is intrinsically exact despite caseExact %s', (caseExact) => {
    expect(() => assertUnique(policy({ type: 'reference', caseExact }), { [urn]: { code: 'https://example.com/Resource' } },
      [{ [urn]: { code: 'https://example.com/resource' } }])).not.toThrow();
  });
  it('caseExact true preserves case, insensitive keys preserve attribute identity', () => {
    expect(() => assertUnique(policy({ caseExact: true }), { [urn.toUpperCase()]: { CODE: 'X' } },
      [{ [urn]: { code: 'x' } }])).not.toThrow();
    expect(() => assertUnique(policy(), { [urn.toUpperCase()]: { CODE: 'X' } },
      [{ [urn]: { code: 'x' } }])).toThrow('already owned');
  });
  it.each([null, undefined, []])('absent/null/empty MV does not reserve a value: %j', (value) => {
    expect(() => assertUnique(policy({ multiValued: true }), { [urn]: { code: value } },
      [{ [urn]: { code: value } }])).not.toThrow();
  });
  it('MV conflicts use element overlap, not whole-array equality; duplicates within owner are not other owners', () => {
    expect(() => assertUnique(policy({ multiValued: true }), { [urn]: { code: ['a', 'a'] } }, [])).not.toThrow();
    expect(() => assertUnique(policy({ multiValued: true }), { [urn]: { code: ['a', 'b'] } },
      [{ [urn]: { code: ['c', 'B'] } }])).toThrow('already owned');
  });
  it.each([
    { code: 2 }, { code: ['a'] },
  ])('rejects malformed single-valued unique values even without strict schema validation', (value) => {
    expect(() => assertUnique(policy(), { [urn]: value }, [])).toThrow();
  });
  it('columns and extensions with colliding names are independent', () => {
    const p = uniquenessPayload({ scimId: 'id', externalId: null, displayName: 'actual',
      rawPayload: JSON.stringify({ DISPLAYNAME: 'stale', [urn]: { displayName: 'extension' } }) });
    expect(p.displayName).toBe('actual');
    expect(p[urn]).toEqual({ displayName: 'extension' });
    expect(p).not.toHaveProperty('DISPLAYNAME');
  });
});

describe('InMemory repository commit invariants', () => {
  const unique = policy();
  const input = (scimId: string, code: unknown, endpointId = 'ep') => ({
    scimId, endpointId, resourceType: 'Device', userName: scimId, displayName: scimId,
    externalId: null, active: true, rawPayload: JSON.stringify({ [urn]: { code } }), meta: '{}',
  });
  for (const family of ['User', 'Group', 'Device']) {
    it(`${family}: competing creates, renames, release and self-write are atomic`, async () => {
      const repo = family === 'User' ? new InMemoryUserRepository()
        : family === 'Group' ? new InMemoryGroupRepository() : new InMemoryGenericResourceRepository();
      const create = (id: string, code: unknown, ep = 'ep') => repo instanceof InMemoryGroupRepository
        ? repo.create(input(id, code, ep), [], unique) : repo.create(input(id, code, ep), unique);
      const races = await Promise.allSettled([create('a', 'same'), create('b', 'SAME')]);
      expect(races.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const winner = races.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof create>>>;
      const other = await create('c', 'other');
      await expect(repo.update(winner.value.id, { rawPayload: input('', 'same').rawPayload }, undefined, unique)).resolves.toMatchObject({ version: 2 });
      const updates = await Promise.allSettled([winner.value.id, other.id].map((id) =>
        repo.update(id, { rawPayload: input('', 'target').rawPayload }, undefined, unique)));
      expect(updates.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const updated = updates.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof create>>>;
      await repo.update(updated.value.id, { rawPayload: input('', null).rawPayload }, undefined, unique);
      await expect(create('d', 'target')).resolves.toMatchObject({ version: 1 });
      await expect(create('e', 'target', 'other-ep')).resolves.toMatchObject({ endpointId: 'other-ep' });
    });
  }
  it('Group member subattributes are evaluated against the complete committed aggregate', async () => {
    const repo = new InMemoryGroupRepository();
    const memberPolicy = policy({ name: 'members', type: 'complex', uniqueness: 'none', multiValued: true,
      subAttributes: [{ name: 'value', type: 'string', uniqueness: 'server', multiValued: false, required: false }] }, true);
    const members = [{ userId: null, value: 'shared', type: null, display: null }];
    await repo.create(input('a', null), members, memberPolicy);
    await expect(repo.create(input('b', null), members, memberPolicy)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repo.findByScimId('ep', 'b')).toBeNull();
    const b = await repo.create(input('b', null), [], memberPolicy);
    await expect(repo.updateGroupWithMembers(b.id, { displayName: 'changed' }, members, 1, memberPolicy))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(Reflect.apply(repo.addMembers, repo, [b.id, members, memberPolicy])).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repo.findWithMembers('ep', 'b')).toMatchObject({ displayName: 'b', version: 1, members: [] });
  });
});
