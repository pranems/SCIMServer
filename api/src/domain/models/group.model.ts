/**
 * Domain models for SCIM Group resources plus group membership.
 *
 * Mirrors the current Prisma ScimGroup + GroupMember shapes so services
 * can swap from generated types to these interfaces with minimal changes.
 */
export interface GroupRecord {
  id: string;
  endpointId: string;
  scimId: string;
  externalId: string | null;
  displayName: string;
  displayNameLower: string;
  rawPayload: string;
  meta: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberRecord {
  id: string;
  groupId: string;
  userId: string | null;
  value: string;
  type: string | null;
  display: string | null;
  createdAt: Date;
}

export interface GroupWithMembers extends GroupRecord {
  members: MemberRecord[];
}

export interface GroupCreateInput {
  endpointId: string;
  scimId: string;
  externalId: string | null;
  displayName: string;
  displayNameLower: string;
  rawPayload: string;
  meta: string;
}

export interface GroupUpdateInput {
  displayName?: string;
  displayNameLower?: string;
  externalId?: string | null;
  rawPayload?: string;
  meta?: string;
}

export interface MemberCreateInput {
  userId: string | null;
  value: string;
  type: string | null;
  display: string | null;
}
