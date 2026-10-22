import { Prisma, type ResourceMember } from '../../../generated/prisma/client';
import type { MemberCreateInput } from '../../../domain/models/group.model';

export function toMemberData(groupId: string, members: MemberCreateInput[]): Prisma.ResourceMemberCreateManyInput[] {
  return members.map(m => ({
    groupResourceId: groupId,
    memberResourceId: m.userId,
    value: m.value,
    type: m.type,
    display: m.display,
    reference: m.reference ?? null,
    createdAt: new Date(),
  }));
}

export async function replaceGroupMembers(
  tx: Prisma.TransactionClient, groupId: string, members: MemberCreateInput[],
): Promise<ResourceMember[]> {
  const data = JSON.stringify(toMemberData(groupId, members));
  return tx.$queryRaw<ResourceMember[]>`
    WITH removed AS (
      DELETE FROM "public"."ResourceMember"
      WHERE "groupResourceId" = ${groupId}::uuid RETURNING 1
    )
    INSERT INTO "public"."ResourceMember"
      ("groupResourceId", "memberResourceId", "value", "type", "display", "reference", "createdAt")
    SELECT m."groupResourceId", m."memberResourceId", m."value", m."type",
           m."display", m."reference", m."createdAt"
    FROM jsonb_to_recordset(${data}::jsonb) AS m(
      "groupResourceId" uuid, "memberResourceId" uuid, "value" text,
      "type" text, "display" text, "reference" text, "createdAt" timestamptz
    )
    -- Consume the delete output before reinserting an existing unique value.
    WHERE (SELECT count(*) FROM removed) >= 0
    RETURNING *
  `;
}
