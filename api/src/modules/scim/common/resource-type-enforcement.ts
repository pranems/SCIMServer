/**
 * Resource-type enforcement relaxation (EnforceResourceTypes flag).
 *
 * By default (`EnforceResourceTypes = true`) a LIST/query on a resource type the
 * endpoint profile does not declare returns 404 `RESOURCE_TYPE_NOT_SUPPORTED`
 * (v0.53.3 Gap-1 enforcement). Some SCIM clients - notably Microsoft Entra's
 * Test Connection - probe BOTH `/Users` and `/Groups` and expect a `200` empty
 * `ListResponse` for a supported endpoint (RFC 7644 §3.4.2); a 404 on `/Groups`
 * for a user-only endpoint makes Entra report the whole endpoint as
 * "SystemForCrossDomainIdentityManagementServiceIncompatible".
 *
 * When `EnforceResourceTypes = false`, a LIST/query on an un-served resource
 * type instead returns a `200` empty `ListResponse` PLUS a non-fatal warning
 * surfaced on three channels so it is discoverable no matter where a consumer
 * looks:
 *
 *   W1 - a structured `LogCategory` warning (server logs / Logs tab), for the
 *        admin who owns the endpoint;
 *   W2 - a `urn:scimserver:api:messages:2.0:Warning` member in the response body
 *        (an array), for programmatic clients + our own UI;
 *   W3 - an `X-SCIM-Warning` response header (short code + message), for proxies
 *        / curl / devtools inspection.
 *
 * All three project from ONE warning object built here, so they cannot drift.
 * Item-by-id reads and all writes (POST/PUT/PATCH/DELETE) still reject with 404
 * regardless of the flag - only LIST/query is relaxed, because a query for zero
 * resources of an un-served type is semantically empty, but creating one is not.
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.2
 * @see RFC 7644 §3.4.2 - Querying resources
 */
import { SCIM_WARNING_URN } from './scim-service-helpers';

/** Short, stable machine code for the relaxed-empty-list warning. */
export const RESOURCE_TYPE_NOT_SERVED_CODE = 'RESOURCE_TYPE_NOT_SERVED';

/** W3 - custom vendor warning header (NOT the deprecated RFC 9111 `Warning`). */
export const SCIM_WARNING_HEADER = 'X-SCIM-Warning';

/** The single warning object projected onto all three channels (W1/W2/W3). */
export interface ResourceTypeWarning {
  /** Stable machine code. */
  readonly code: typeof RESOURCE_TYPE_NOT_SERVED_CODE;
  /** The resource type that was queried but is not served (e.g. "Group"). */
  readonly resourceType: string;
  /** The endpoint id, for correlation. */
  readonly endpointId: string;
  /** Human-readable, single-line explanation. */
  readonly message: string;
}

/**
 * Build the one warning object for an un-served resource-type LIST/query.
 */
export function buildResourceTypeWarning(
  resourceType: string,
  endpointName: string,
  endpointId: string,
): ResourceTypeWarning {
  return {
    code: RESOURCE_TYPE_NOT_SERVED_CODE,
    resourceType,
    endpointId,
    message:
      `Resource type "${resourceType}" is not served by endpoint "${endpointName}"; ` +
      `returned an empty list because EnforceResourceTypes is false.`,
  };
}

/**
 * W3 - format the warning as a single-line ASCII header value.
 * `<code>; <message>` - the full structured detail lives in W1 (logs) and W2 (body).
 */
export function formatWarningHeader(warning: ResourceTypeWarning): string {
  // Collapse any stray whitespace to keep the header single-line.
  const message = warning.message.replace(/\s+/g, ' ').trim();
  return `${warning.code}; ${message}`;
}

/**
 * Build a `200` empty SCIM `ListResponse` body carrying the W2 warning member.
 * The warning is an ARRAY member (multiple warnings can compose) under the same
 * `urn:scimserver:api:messages:2.0:Warning` URN used by the readOnly-strip
 * warning, added to `schemas[]` so the extension is self-describing.
 */
export function buildEmptyListResponseWithWarning(
  warning: ResourceTypeWarning,
): Record<string, unknown> {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse', SCIM_WARNING_URN],
    totalResults: 0,
    Resources: [],
    startIndex: 1,
    itemsPerPage: 0,
    [SCIM_WARNING_URN]: { warnings: [warning] },
  };
}
