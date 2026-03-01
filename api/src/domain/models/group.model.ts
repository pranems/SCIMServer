/**
 * Domain models for SCIM Group resources plus group membership.
 *
 * Phase 3: Removed displayNameLower — PostgreSQL CITEXT handles case-insensitive
 * matching natively. The rawPayload field remains a JSON string at the domain
 * boundary; Prisma repositories convert to/from JSONB transparently.
 */
export interface GroupRecord {
  id: string;
  endpointId: string;
  scimId: string;
  externalId: string | null;
  displayName: string;
  active: boolean;
  deletedAt: Date | null;
  rawPayload: string;
  version: number;
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
  active: boolean;
  rawPayload: string;
  meta: string;
}

export interface GroupUpdateInput {
  displayName?: string;
  externalId?: string | null;
  active?: boolean;
  deletedAt?: Date | null;
  rawPayload?: string;
  meta?: string;
}

export interface MemberCreateInput {
  userId: string | null;
  value: string;
  type: string | null;
  display: string | null;
}
