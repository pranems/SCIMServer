import { InMemoryUserRepository } from './inmemory-user.repository';
import { InMemoryGroupRepository } from './inmemory-group.repository';
import { InMemoryGenericResourceRepository } from './inmemory-generic-resource.repository';
import { repositoryErrorToHttpStatus } from '../../../domain/errors/repository-error';

const input = {
  endpointId: 'endpoint-a', scimId: 'resource-a', userName: 'Alice',
  displayName: 'Before', active: true, externalId: null, meta: '{}',
  rawPayload: '{}', resourceType: 'Device',
};

describe.each([
  ['User', () => new InMemoryUserRepository()],
  ['Group', () => new InMemoryGroupRepository()],
  ['Generic', () => new InMemoryGenericResourceRepository()],
] as const)('%s atomic repository writes', (_name, factory) => {
  it('checks expected version in the same synchronous mutation and increments once', async () => {
    const repo = factory();
    const row = await repo.create(input);
    const write = (name: string) => Reflect.apply(repo.update, repo, [row.id, { displayName: name }, 1]);
    const results = await Promise.allSettled([write('winner'), write('loser')]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { version: 2, displayName: 'winner' } });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'PRECONDITION_FAILED' } });
    await expect(Reflect.apply(repo.delete, repo, [row.id, 1]))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(Reflect.apply(repo.delete, repo, [row.id, 2])).resolves.toBeUndefined();
    await expect(Reflect.apply(repo.delete, repo, [row.id, '*']))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(repo.delete(row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('wildcard means existence, not a snapshot version', async () => {
    const repo = factory();
    const row = await repo.create(input);
    await repo.update(row.id, { displayName: 'first' });
    await expect(Reflect.apply(repo.update, repo, [row.id, { displayName: 'second' }, '*']))
      .resolves.toMatchObject({ version: 3 });
    await repo.delete(row.id);
    await expect(Reflect.apply(repo.update, repo, [row.id, {}, 3]))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

it('group conditional failure leaves scalar data and members untouched', async () => {
  const repo = new InMemoryGroupRepository();
  const row = await repo.create(input);
  const member = { userId: null, value: 'member-a', type: 'User', display: null };
  await repo.updateGroupWithMembers(row.id, { displayName: 'winner' }, [member]);
  const before = await repo.findWithMembers(input.endpointId, input.scimId);
  await expect(Reflect.apply(repo.updateGroupWithMembers, repo,
    [row.id, { displayName: 'loser' }, [], 1])).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(await repo.findWithMembers(input.endpointId, input.scimId)).toEqual(before);
});

it('User uniqueness is endpoint-scoped and case-insensitive on create and update', async () => {
  const repo = new InMemoryUserRepository();
  const first = await repo.create(input);
  await expect(repo.create({ ...input, scimId: 'second', userName: 'ALICE' }))
    .rejects.toMatchObject({ code: 'CONFLICT' });
  await repo.create({ ...input, endpointId: 'endpoint-b', scimId: 'elsewhere' });
  const other = await repo.create({ ...input, scimId: 'other', userName: 'Bob' });
  await expect(repo.update(other.id, { userName: 'ALICE' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await repo.findByScimId(input.endpointId, 'other')).toMatchObject({ userName: 'Bob', version: 1 });
  await expect(repo.update(first.id, { userName: 'ALICE' })).resolves.toMatchObject({ version: 2 });
});

it('maps a failed persistence precondition to HTTP 412', () => {
  expect(repositoryErrorToHttpStatus('PRECONDITION_FAILED')).toBe(412);
});
