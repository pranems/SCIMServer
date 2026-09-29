import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import type { IUserRepository } from '../../src/domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../src/domain/repositories/group.repository.interface';
import type { IGenericResourceRepository } from '../../src/domain/repositories/generic-resource.repository.interface';
import type { IEndpointCredentialRepository } from '../../src/domain/repositories/endpoint-credential.repository.interface';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY, ENDPOINT_CREDENTIAL_REPOSITORY } from '../../src/domain/repositories/repository.tokens';
import { InMemoryGroupRepository } from '../../src/infrastructure/repositories/inmemory/inmemory-group.repository';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

export function deletionRepositories(app: INestApplicationContext) {
  return {
    users: app.get<IUserRepository>(USER_REPOSITORY),
    groups: app.get<IGroupRepository>(GROUP_REPOSITORY),
    resources: app.get<IGenericResourceRepository>(GENERIC_RESOURCE_REPOSITORY),
    credentials: app.get<IEndpointCredentialRepository>(ENDPOINT_CREDENTIAL_REPOSITORY),
  };
}

export async function seedDeletionRows(app: INestApplicationContext, endpointId: string) {
  const { users, groups, resources, credentials } = deletionRepositories(app);
  const base = { endpointId, externalId: null, active: true, rawPayload: '{}', meta: '{}' };
  const userInput = { ...base, scimId: randomUUID(), userName: 'owned-user', displayName: null };
  const user = await users.create(userInput);
  const groupInput = { ...base, scimId: randomUUID(), displayName: 'child' };
  const child = await groups.create(groupInput);
  const parent = await groups.create({ ...groupInput, scimId: randomUUID(), displayName: 'parent' });
  await groups.addMembers(child.id, [{ userId: user.id, value: user.scimId, type: 'User', display: null }]);
  await groups.addMembers(parent.id, [
    { userId: child.id, value: child.scimId, type: 'Group', display: null },
    { userId: null, value: 'external-reference', type: null, display: null },
  ]);
  const customInput = { ...base, resourceType: 'Device', scimId: randomUUID(), displayName: 'owned-device' };
  const custom = await resources.create(customInput);
  await resources.create({ ...customInput, resourceType: 'Application', scimId: randomUUID() });
  const credentialInput = {
    endpointId, credentialType: 'bearer', credentialHash: 'test-only',
    lookupKey: randomUUID(), secretEnvelope: 'test-only-envelope',
  };
  const active = await credentials.create(credentialInput);
  const revoked = await credentials.create({ ...credentialInput, credentialType: 'oauth_client', lookupKey: randomUUID() });
  await credentials.deactivate(revoked.id);
  const wif = await credentials.create({
    ...credentialInput, credentialType: 'wif', lookupKey: null,
    metadata: { expectedIssuer: 'https://issuer.example.test', expectedSubject: 'test-subject' },
  });
  const expired = await credentials.create({ ...credentialInput, lookupKey: randomUUID(), expiresAt: new Date(0) });
  return { endpointId, userInput, user, groupInput, child, parent, customInput, custom, credentialInput, active, revoked, wif, expired };
}

export type DeletionFixture = Awaited<ReturnType<typeof seedDeletionRows>>;
export const SEEDED_COUNTS = { users: 1, groups: 2, custom: 2, members: 3, credentials: 4 };
export const EMPTY_COUNTS = { users: 0, groups: 0, custom: 0, members: 0, credentials: 0 };

export async function deletionCounts(app: INestApplicationContext, fixture: DeletionFixture) {
  const { users, groups, resources, credentials } = deletionRepositories(app);
  const { endpointId } = fixture;
  const groupIds = [fixture.child.id, fixture.parent.id];
  // Read raw membership storage, not findWithMembers: missing parent rows must
  // not hide orphan membership rows from this regression assertion.
  const members = groups instanceof InMemoryGroupRepository
    ? [...groups['members'].values()].filter(row => groupIds.includes(row.groupId)).length
    : await app.get(PrismaService).resourceMember.count({ where: { groupResourceId: { in: groupIds } } });
  return {
    users: (await users.findAll(endpointId)).length,
    groups: (await groups.findAllWithMembers(endpointId)).length,
    custom: (await Promise.all(['Device', 'Application'].map(type => resources.findAll(endpointId, type))))
      .reduce((count, rows) => count + rows.length, 0),
    members,
    credentials: (await credentials.findByEndpoint(endpointId)).length,
  };
}
