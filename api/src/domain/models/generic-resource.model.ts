/**
 * GenericResource domain model — represents a custom SCIM resource stored
 * in the polymorphic ScimResource table with an arbitrary resourceType discriminator.
 *
 * Phase 8b: Generic resources are simpler than User/Group — they don't have
 * type-specific fields like userName or members. All attributes beyond the
 * SCIM core (id, externalId, meta, schemas) are stored in the JSONB payload.
 */

/** Persisted generic resource record (read from DB) */
export interface GenericResourceRecord {
  id: string;
  endpointId: string;
  resourceType: string;
  scimId: string;
  externalId: string | null;
  displayName: string | null;
  active: boolean;
  deletedAt: Date | null;
  rawPayload: string;
  version: number;
  meta: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new generic resource */
export interface GenericResourceCreateInput {
  endpointId: string;
  resourceType: string;
  scimId: string;
  externalId: string | null;
  displayName: string | null;
  active: boolean;
  rawPayload: string;
  meta: string;
}

/** Input for updating a generic resource */
export interface GenericResourceUpdateInput {
  externalId?: string | null;
  displayName?: string | null;
  active?: boolean;
  deletedAt?: Date | null;
  rawPayload?: string;
  meta?: string;
}
