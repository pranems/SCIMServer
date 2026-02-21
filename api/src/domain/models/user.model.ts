/**
 * Domain model for SCIM User resources.
 *
 * Phase 3: Removed userNameLower — PostgreSQL CITEXT handles case-insensitive
 * uniqueness natively. The rawPayload field remains a JSON string at the domain
 * boundary; Prisma repositories convert to/from JSONB transparently.
 */
export interface UserRecord {
  id: string;
  endpointId: string;
  scimId: string;
  externalId: string | null;
  userName: string;
  active: boolean;
  rawPayload: string;
  meta: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCreateInput {
  endpointId: string;
  scimId: string;
  externalId: string | null;
  userName: string;
  active: boolean;
  rawPayload: string;
  meta: string;
}

export interface UserUpdateInput {
  externalId?: string | null;
  userName?: string;
  active?: boolean;
  rawPayload?: string;
  meta?: string;
}

export interface UserConflictResult {
  scimId: string;
  userName: string;
  externalId: string | null;
}
