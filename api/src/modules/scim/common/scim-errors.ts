import { HttpException } from '@nestjs/common';

import { SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN } from './scim-constants';
import { getCorrelationContext } from '../../logging/scim-logger.service';

/**
 * Optional diagnostics metadata for SCIM error responses.
 * When provided, a `urn:scimserver:api:messages:2.0:Diagnostics` extension
 * is added to the error body, enabling self-service RCA.
 */
export interface ScimErrorDiagnostics {
  /** Which config flag activated this validation path (e.g., 'StrictSchemaValidation') */
  triggeredBy?: string;

  // ── Attribute-level RCA context ────────────────────────────────────

  /** SCIM operation that triggered the error: create, replace, patch, delete */
  operation?: string;
  /** Attribute path (dot-notation or URN-qualified) that caused the error */
  attributePath?: string;
  /** Schema URN where the failing attribute is defined */
  schemaUrn?: string;

  // ── Uniqueness conflict context ───────────────────────────────────

  /** scimId of the existing resource that conflicts */
  conflictingResourceId?: string;
  /** Which attribute caused the conflict (e.g., 'userName', 'externalId') */
  conflictingAttribute?: string;
  /** The incoming value that collided */
  incomingValue?: string;

  // ── PATCH operation context ───────────────────────────────────────

  /** Zero-based index of the failing operation in the PATCH request */
  failedOperationIndex?: number;
  /** The path from the failing PATCH operation */
  failedPath?: string;
  /** The op type from the failing operation (add/replace/remove) */
  failedOp?: string;

  // ── ETag context ──────────────────────────────────────────────────

  /** Current server-side ETag value (for 428 responses) */
  currentETag?: string;

  // ── Filter context ────────────────────────────────────────────────

  /** Original parse error detail (for invalidFilter) */
  parseError?: string;

  /** Additional diagnostic context (catch-all) */
  extra?: Record<string, unknown>;
}

export interface ScimErrorOptions {
  status: number;
  detail: string;
  scimType?: string;
  /** Optional diagnostics — auto-enriched with requestId and endpointId from correlation context */
  diagnostics?: ScimErrorDiagnostics;
}

/**
 * Create a SCIM-compliant HttpException per RFC 7644 §3.12.
 *
 * When `diagnostics` is provided (or when called within a request context),
 * the error body includes a `urn:scimserver:api:messages:2.0:Diagnostics`
 * extension with `requestId`, `endpointId`, `triggeredBy`, and `logsUrl`
 * for zero-friction RCA.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.12
 */
export function createScimError({ status, detail, scimType, diagnostics }: ScimErrorOptions): HttpException {
  const body: Record<string, unknown> = {
    schemas: [SCIM_ERROR_SCHEMA],
    detail,
    scimType,
    // RFC 7644 §3.12: "status" MUST be a string (the HTTP status code as text)
    status: String(status),
  };

  // Auto-enrich with diagnostics from correlation context when available
  const ctx = getCorrelationContext();
  if (diagnostics || ctx) {
    const diag: Record<string, unknown> = {};

    if (ctx?.requestId) diag.requestId = ctx.requestId;
    if (ctx?.endpointId) diag.endpointId = ctx.endpointId;
    if (diagnostics?.triggeredBy) diag.triggeredBy = diagnostics.triggeredBy;

    // Build logsUrl pointing to endpoint-scoped or admin log endpoint
    if (ctx?.requestId) {
      diag.logsUrl = ctx.endpointId
        ? `/scim/endpoints/${ctx.endpointId}/logs/recent?requestId=${ctx.requestId}`
        : `/scim/admin/log-config/recent?requestId=${ctx.requestId}`;
    }

    // Attribute-level RCA context
    if (diagnostics?.operation) diag.operation = diagnostics.operation;
    if (diagnostics?.attributePath) diag.attributePath = diagnostics.attributePath;
    if (diagnostics?.schemaUrn) diag.schemaUrn = diagnostics.schemaUrn;

    // Uniqueness conflict context
    if (diagnostics?.conflictingResourceId) diag.conflictingResourceId = diagnostics.conflictingResourceId;
    if (diagnostics?.conflictingAttribute) diag.conflictingAttribute = diagnostics.conflictingAttribute;
    if (diagnostics?.incomingValue) diag.incomingValue = diagnostics.incomingValue;

    // PATCH operation context
    if (diagnostics?.failedOperationIndex !== undefined) diag.failedOperationIndex = diagnostics.failedOperationIndex;
    if (diagnostics?.failedPath) diag.failedPath = diagnostics.failedPath;
    if (diagnostics?.failedOp) diag.failedOp = diagnostics.failedOp;

    // ETag / filter context
    if (diagnostics?.currentETag) diag.currentETag = diagnostics.currentETag;
    if (diagnostics?.parseError) diag.parseError = diagnostics.parseError;

    if (diagnostics?.extra) {
      Object.assign(diag, diagnostics.extra);
    }

    // Only add the extension if there's meaningful content
    if (Object.keys(diag).length > 0) {
      body[SCIM_DIAGNOSTICS_URN] = diag;
    }
  }

  return new HttpException(body, status);
}
