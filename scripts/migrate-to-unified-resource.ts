#!/usr/bin/env npx ts-node
/**
 * Phase 2 Data Migration Script — Unified scim_resource Table
 *
 * Migrates existing data from the legacy ScimUser/ScimGroup/GroupMember tables
 * to the unified ScimResource/ResourceMember tables.
 *
 * Usage:
 *   cd api
 *   npx ts-node ../scripts/migrate-to-unified-resource.ts
 *
 * Safety:
 *   - Additive only — does NOT delete data from legacy tables
 *   - Idempotent — skips resources that already exist in scim_resource
 *   - Logs progress to stdout
 */

import { PrismaClient } from '../api/src/generated/prisma/client';

const prisma = new PrismaClient();

async function migrateUsers(): Promise<number> {
  const users = await prisma.scimUser.findMany();
  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    // Check if already migrated (idempotent)
    const existing = await prisma.scimResource.findFirst({
      where: { endpointId: user.endpointId, scimId: user.scimId, resourceType: 'User' },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.scimResource.create({
      data: {
        endpointId: user.endpointId,
        resourceType: 'User',
        scimId: user.scimId,
        externalId: user.externalId,
        userName: user.userName,
        userNameLower: user.userNameLower,
        active: user.active,
        rawPayload: user.rawPayload,
        meta: user.meta,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
    migrated++;
  }

  console.log(`  Users: ${migrated} migrated, ${skipped} skipped (already exists)`);
  return migrated;
}

async function migrateGroups(): Promise<number> {
  const groups = await prisma.scimGroup.findMany({ include: { members: true } });
  let groupsMigrated = 0;
  let groupsSkipped = 0;
  let membersMigrated = 0;

  for (const group of groups) {
    // Check if already migrated (idempotent)
    const existing = await prisma.scimResource.findFirst({
      where: { endpointId: group.endpointId, scimId: group.scimId, resourceType: 'Group' },
    });

    let groupResourceId: string;

    if (existing) {
      groupsSkipped++;
      groupResourceId = existing.id;
    } else {
      const resource = await prisma.scimResource.create({
        data: {
          endpointId: group.endpointId,
          resourceType: 'Group',
          scimId: group.scimId,
          externalId: group.externalId,
          displayName: group.displayName,
          displayNameLower: group.displayNameLower,
          rawPayload: group.rawPayload,
          meta: group.meta,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        },
      });
      groupResourceId = resource.id;
      groupsMigrated++;
    }

    // Migrate members for this group
    for (const member of group.members) {
      // Check if this member relationship already exists
      const existingMember = await prisma.resourceMember.findFirst({
        where: { groupResourceId, value: member.value },
      });
      if (existingMember) continue;

      // Resolve the member's ScimResource id (if it's a user that was migrated)
      let memberResourceId: string | null = null;
      if (member.value) {
        const memberResource = await prisma.scimResource.findFirst({
          where: { endpointId: group.endpointId, scimId: member.value },
        });
        memberResourceId = memberResource?.id ?? null;
      }

      await prisma.resourceMember.create({
        data: {
          groupResourceId,
          memberResourceId,
          value: member.value,
          type: member.type,
          display: member.display,
          createdAt: member.createdAt,
        },
      });
      membersMigrated++;
    }
  }

  console.log(`  Groups: ${groupsMigrated} migrated, ${groupsSkipped} skipped`);
  console.log(`  Members: ${membersMigrated} migrated`);
  return groupsMigrated;
}

async function main() {
  console.log('=== Phase 2: Data Migration to Unified scim_resource Table ===\n');

  // Verify tables exist
  const userCount = await prisma.scimUser.count();
  const groupCount = await prisma.scimGroup.count();
  const memberCount = await prisma.groupMember.count();
  console.log(`Legacy data: ${userCount} users, ${groupCount} groups, ${memberCount} members\n`);

  const resourceCount = await prisma.scimResource.count();
  const resMemberCount = await prisma.resourceMember.count();
  console.log(`Unified table (before): ${resourceCount} resources, ${resMemberCount} members\n`);

  console.log('Migrating users...');
  await migrateUsers();

  console.log('Migrating groups and members...');
  await migrateGroups();

  // Final counts
  const finalResourceCount = await prisma.scimResource.count();
  const finalMemberCount = await prisma.resourceMember.count();
  console.log(`\nUnified table (after): ${finalResourceCount} resources, ${finalMemberCount} members`);
  console.log('\n✅ Migration complete. Legacy tables are untouched.');
  console.log('   To verify: run the full test suite (npm run test:ci)');
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
