import { InMemoryGroupRepository } from './inmemory-group.repository';
import type { GroupCreateInput, MemberCreateInput } from '../../../domain/models/group.model';

const input = (scimId = 'group-a'): GroupCreateInput => ({
  endpointId: 'ep-a', scimId, displayName: scimId, externalId: null,
  rawPayload: '{"description":"original"}', meta: '{}',
});
const member = (value: string): MemberCreateInput => ({
  value, userId: null, type: 'User', display: value,
});

describe('InMemory Group aggregate publication', () => {
  let repo: InMemoryGroupRepository;
  beforeEach(() => { repo = new InMemoryGroupRepository(); });

  const create = (data: GroupCreateInput, members: MemberCreateInput[]) =>
    repo.create(data, members);

  it('creates the Group and initial members at version 1', async () => {
    const result = await create(input(), [member('one'), member('two')]);
    const stored = await repo.findWithMembers('ep-a', 'group-a');
    expect(stored?.members.map((m) => m.value)).toEqual(['one', 'two']);
    expect(stored).toMatchObject({ id: result.id, version: 1, rawPayload: input().rawPayload });
  });

  it('rejects duplicate initial member values without publishing a Group', async () => {
    await expect(create(input(), [member('same'), member('same')]))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repo.findAllWithMembers('ep-a')).toEqual([]);
  });

  it('stages a late throwing member before publishing any Group or member', async () => {
    const bad = member('two');
    Object.defineProperty(bad, 'display', { get: () => { throw new Error('injected member failure'); } });
    await expect(create(input(), [member('one'), bad])).rejects.toThrow('injected member failure');
    expect(await repo.findAllWithMembers('ep-a')).toEqual([]);
    expect((repo as unknown as { members: Map<string, unknown> }).members.size).toBe(0);
  });

  it('arbitrates concurrent creates of one scoped SCIM id without leaking loser members', async () => {
    const outcomes = await Promise.allSettled([
      create(input(), [member('winner-a')]),
      create(input('GROUP-A'), [member('winner-b')]),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const stored = await repo.findAllWithMembers('ep-a');
    expect(stored).toHaveLength(1);
    expect(stored[0].version).toBe(1);
    expect(stored[0].members).toHaveLength(1);
    expect(stored[0].members[0].value).toBe(outcomes[0].status === 'fulfilled' ? 'winner-a' : 'winner-b');
  });

  it('allows the same SCIM id and member value in another endpoint', async () => {
    await create(input(), [member('one')]);
    await create({ ...input(), endpointId: 'ep-b' }, [member('one')]);
    expect(await repo.findAllWithMembers('ep-a')).toHaveLength(1);
    expect(await repo.findAllWithMembers('ep-b')).toHaveLength(1);
  });

  it('keeps all fields, version, timestamps and existing members when replacement conflicts', async () => {
    const group = await repo.create(input());
    await repo.addMembers(group.id, [member('original')]);
    const before = await repo.findWithMembers('ep-a', 'group-a');
    await expect(repo.updateGroupWithMembers(group.id, {
      displayName: 'changed', rawPayload: '{"description":"changed"}', externalId: 'changed', meta: '{"changed":true}',
    }, [member('duplicate'), member('duplicate')], 1)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repo.findWithMembers('ep-a', 'group-a')).toEqual(before);
  });

  it('keeps the original aggregate on a late member-construction exception', async () => {
    const group = await repo.create(input());
    await repo.addMembers(group.id, [member('original')]);
    const before = await repo.findWithMembers('ep-a', 'group-a');
    const bad = member('bad');
    Object.defineProperty(bad, 'display', { get: () => { throw new Error('injected member failure'); } });
    await expect(repo.updateGroupWithMembers(group.id, { displayName: 'changed' },
      [member('first'), bad], 1)).rejects.toThrow('injected member failure');
    expect(await repo.findWithMembers('ep-a', 'group-a')).toEqual(before);
  });

  it('rejects a stale version before evaluating replacement members', async () => {
    const group = await repo.create(input());
    await repo.updateGroupWithMembers(group.id, { displayName: 'winner' }, [member('winner')], 1);
    const before = await repo.findWithMembers('ep-a', 'group-a');
    const bad = member('bad');
    Object.defineProperty(bad, 'value', { get: () => { throw new Error('must not stage'); } });
    await expect(repo.updateGroupWithMembers(group.id, { displayName: 'loser' }, [bad], 1))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await repo.findWithMembers('ep-a', 'group-a')).toEqual(before);
  });

  it('adds members atomically and rejects duplicates against existing membership', async () => {
    const group = await repo.create(input());
    await repo.addMembers(group.id, [member('existing')]);
    const before = await repo.findWithMembers('ep-a', 'group-a');
    await expect(repo.addMembers(group.id, [member('new'), member('existing')]))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repo.findWithMembers('ep-a', 'group-a')).toEqual(before);
  });

  it('does not create orphan members for an absent Group', async () => {
    await expect(repo.addMembers('missing', [member('one')])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((repo as unknown as { members: Map<string, unknown> }).members.size).toBe(0);
  });

  it('reads scalar and member state from one synchronous aggregate snapshot', async () => {
    const group = await repo.create(input());
    await repo.addMembers(group.id, [member('original')]);
    const reading = repo.findWithMembers('ep-a', 'group-a');
    await repo.updateGroupWithMembers(group.id, { displayName: 'changed' }, [member('changed')], 1);
    const snapshot = await reading;
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.displayName).toBe('group-a');
    expect(snapshot?.members.map((m) => m.value)).toEqual(['original']);
  });
});
