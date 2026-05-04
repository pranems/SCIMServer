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
  USER_DELETED: 'scim.user.deleted',
  GROUP_CREATED: 'scim.group.created',
  GROUP_DELETED: 'scim.group.deleted',
  RESOURCE_CREATED: 'scim.resource.created',
  RESOURCE_DELETED: 'scim.resource.deleted',
  /** Fired on user active status change (PATCH active=false/true) */
  USER_STATUS_CHANGED: 'scim.user.statusChanged',
  /** Fired on group active status change */
  GROUP_STATUS_CHANGED: 'scim.group.statusChanged',
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
