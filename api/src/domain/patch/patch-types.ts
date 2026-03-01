/**
 * Domain-Layer PATCH Types (Phase 5)
 *
 * Pure domain types for SCIM PATCH operations — zero framework/DB imports.
 * These types are the contract between the SCIM service layer and the
 * standalone PatchEngine that performs all data transformations.
 *
 * @see RFC 7644 §3.5.2 for PATCH operation semantics
 */

// ─── PATCH Operation ─────────────────────────────────────────────────────────

/** A single SCIM PATCH operation (RFC 7644 §3.5.2) */
export interface PatchOperation {
  /** The operation type: add, replace, or remove */
  op: string;
  /** Optional attribute path (simple, valuePath, or URN-prefixed) */
  path?: string;
  /** The value to apply (required for add/replace, forbidden for remove) */
  value?: unknown;
}

// ─── PATCH Config ────────────────────────────────────────────────────────────

/** Configuration flags that control PATCH engine behavior */
export interface PatchConfig {
  /** Enable dot-notation path resolution (e.g., name.givenName) */
  verbosePatch: boolean;
  /** Extension URNs registered for this endpoint (for PATCH path resolution) */
  extensionUrns?: readonly string[];
}

/** Configuration flags for group member PATCH behavior */
export interface GroupMemberPatchConfig {
  /** Allow adding multiple members in a single PATCH operation */
  allowMultiMemberAdd: boolean;
  /** Allow removing multiple members in a single PATCH operation */
  allowMultiMemberRemove: boolean;
  /** Allow removing all members via path=members (no value filter) */
  allowRemoveAllMembers: boolean;
  /** Extension URNs registered for this endpoint (for PATCH path resolution) */
  extensionUrns?: readonly string[];
}

// ─── PATCH Result ────────────────────────────────────────────────────────────

/**
 * The result of applying PATCH operations to a user resource payload.
 *
 * Contains both the updated rawPayload and any extracted first-class
 * DB column values that changed during the PATCH.
 */
export interface UserPatchResult {
  /** The updated rawPayload (JSON-ready object) */
  payload: Record<string, unknown>;
  /** First-class DB fields that were modified during PATCH */
  extractedFields: UserExtractedFields;
}

/** First-class DB column values extracted during user PATCH operations */
export interface UserExtractedFields {
  userName?: string;
  displayName?: string | null;
  externalId?: string | null;
  active?: boolean;
}

/**
 * The result of applying PATCH operations to a group resource.
 *
 * Group PATCH produces updated display fields plus a new member list.
 */
export interface GroupPatchResult {
  displayName: string;
  externalId: string | null;
  /** Updated rawPayload for non-first-class attributes */
  payload: Record<string, unknown>;
  /** The complete set of members after all operations are applied */
  members: GroupMemberDto[];
}

/** A group member DTO (value = SCIM user id) */
export interface GroupMemberDto {
  value: string;
  display?: string;
  type?: string;
}
