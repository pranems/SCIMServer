/**
 * Domain model for SCIM User resources.
 *
 * Mirrors the current Prisma ScimUser shape so services can swap from
 * generated types to this interface without changing business logic.
 * When the table structure changes (Phase 2 — unified scim_resource),
 * only the repository implementations need updating.
 */
export interface UserRecord {
  id: string;
  endpointId: string;
  scimId: string;
  externalId: string | null;
  userName: string;
  userNameLower: string;
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
  userNameLower: string;
  active: boolean;
  rawPayload: string;
  meta: string;
}

export interface UserUpdateInput {
  externalId?: string | null;
  userName?: string;
  userNameLower?: string;
  active?: boolean;
  rawPayload?: string;
  meta?: string;
}

export interface UserConflictResult {
  scimId: string;
  userName: string;
  externalId: string | null;
}
