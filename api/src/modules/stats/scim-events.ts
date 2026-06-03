/**
 * SCIM event constants and payload types for EventEmitter2 integration.
 *
 * Events are emitted by SCIM services after successful DB commits and
 * consumed by StatsProjectionService to maintain in-memory counters.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S6.6
 * @see docs/DELIVERY_PLAN.md UI-B2
 */

// ---- Event name constants ------------------------------------------------

export const SCIM_EVENTS = {
  USER_CREATED: 'scim.user.created',
  /** Phase J (v0.48.1): emitted on PUT/PATCH (non-status-only) updates */
  USER_UPDATED: 'scim.user.updated',
  USER_DELETED: 'scim.user.deleted',
  GROUP_CREATED: 'scim.group.created',
  /** Phase J (v0.48.1): emitted on PUT/PATCH (non-status-only) updates */
  GROUP_UPDATED: 'scim.group.updated',
  GROUP_DELETED: 'scim.group.deleted',
  RESOURCE_CREATED: 'scim.resource.created',
  RESOURCE_DELETED: 'scim.resource.deleted',
  /** Fired on user active status change (PATCH active=false/true) */
  USER_STATUS_CHANGED: 'scim.user.statusChanged',
  /** Fired on group active status change */
  GROUP_STATUS_CHANGED: 'scim.group.statusChanged',
  /** Phase J (v0.48.1): per-endpoint credential admin events */
  CREDENTIAL_CREATED: 'scim.credential.created',
  CREDENTIAL_REVOKED: 'scim.credential.revoked',
  /** Phase J (v0.48.1): endpoint admin CRUD events */
  ENDPOINT_CREATED: 'scim.endpoint.created',
  ENDPOINT_UPDATED: 'scim.endpoint.updated',
  ENDPOINT_DELETED: 'scim.endpoint.deleted',
} as const;

// ---- Payload types -------------------------------------------------------

/** Base payload for user/group SCIM events */
export interface ScimEventPayload {
  endpointId: string;
  scimId: string;
  active?: boolean;
}

/** Payload for generic resource events (includes resourceType discriminator) */
export interface ScimResourceEventPayload extends ScimEventPayload {
  resourceType: string;
}

/** Payload for status-change events (carries old and new active values) */
export interface ScimStatusChangePayload {
  endpointId: string;
  scimId: string;
  previousActive: boolean;
  newActive: boolean;
}

/**
 * Phase J (v0.48.1): payload for per-endpoint credential admin events.
 * Mirrors the redacted shape returned by the admin credential controller -
 * NEVER includes the bcrypt hash or the plaintext token (that is exposed
 * once at create time on the HTTP response only).
 */
export interface ScimCredentialEventPayload {
  endpointId: string;
  credentialId: string;
  credentialType?: string;
  label?: string;
}

/**
 * Phase J (v0.48.1): payload for endpoint admin CRUD events.
 * `endpointId` is the only required field; `name` is included when
 * available so cross-tab UI can update list rows without a refetch.
 */
export interface ScimEndpointEventPayload {
  endpointId: string;
  name?: string;
}

// ---- Snapshot types (returned by StatsProjectionService) ------------------

/** Per-endpoint stats snapshot (zero DB queries to read) */
export interface EndpointStatsSnapshot {
  userCount: number;
  activeUserCount: number;
  groupCount: number;
  activeGroupCount: number;
  genericResourceCount: number;
}

/** Global aggregate stats (zero DB queries to read) */
export interface GlobalStatsSnapshot {
  totalEndpoints: number;
  totalUsers: number;
  totalGroups: number;
  totalGenericResources: number;
}
