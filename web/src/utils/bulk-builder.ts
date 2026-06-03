/**
 * Phase M2 - bulk-builder (pure RFC 7644 §3.7 BulkRequest assembler).
 *
 * Turns parsed CSV rows + a column mapping into a SCIM BulkRequest
 * envelope ready to POST to /scim/endpoints/:id/Bulk.
 *
 * Three modes:
 *   - POST:   each row -> POST /Users (or /Groups) with mapped data
 *   - PATCH:  each row -> PATCH /Users/{id} with mapped data as PatchOp
 *             replace ops; rows missing the id column are skipped
 *   - DELETE: each row -> DELETE /Users/{id}; no data
 *
 * Mirrors the API constants from
 * [api/src/modules/scim/dto/bulk-request.dto.ts](../../../api/src/modules/scim/dto/bulk-request.dto.ts).
 *
 * @see web/src/utils/bulk-builder.test.ts (TDD spec)
 * @see docs/PHASE_M2_BULK_OPERATIONS.md
 */

export const BULK_REQUEST_SCHEMA_URN = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest';
export const PATCH_OP_SCHEMA_URN = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const BULK_MAX_OPERATIONS = 1000;

export type BulkMode = 'POST' | 'PATCH' | 'DELETE';

/**
 * Mapping from CSV column name -> SCIM target attribute name.
 * Extension-style dotted/URN target keys are preserved verbatim.
 */
export type ColumnMapping = Record<string, string>;

export interface BulkBuildArgs {
  mode: BulkMode;
  /** Resource collection path, e.g. "/Users" or "/Groups". */
  resourcePath: string;
  /** Resource core schema URN (used in POST data.schemas). */
  resourceSchema: string;
  rows: Array<Record<string, string>>;
  mapping: ColumnMapping;
  /** PATCH/DELETE: the CSV column carrying the resource id. */
  idColumn?: string;
  /** RFC 7644 §3.7 failOnErrors threshold. Omitted from envelope when 0. */
  failOnErrors?: number;
}

export interface BulkOperationOut {
  method: BulkMode;
  path: string;
  bulkId?: string;
  data?: Record<string, unknown>;
}

export interface BulkRequestEnvelope {
  schemas: [typeof BULK_REQUEST_SCHEMA_URN];
  failOnErrors?: number;
  Operations: BulkOperationOut[];
}

function isAttributeSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.length === 0) return false;
  return true;
}

function buildPostData(
  resourceSchema: string,
  row: Record<string, string>,
  mapping: ColumnMapping,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    schemas: [resourceSchema],
  };
  for (const [sourceCol, targetKey] of Object.entries(mapping)) {
    const v = row[sourceCol];
    if (isAttributeSet(v)) {
      data[targetKey] = v;
    }
  }
  return data;
}

function buildPatchData(
  row: Record<string, string>,
  mapping: ColumnMapping,
): Record<string, unknown> {
  const operations: Array<Record<string, unknown>> = [];
  for (const [sourceCol, targetKey] of Object.entries(mapping)) {
    const v = row[sourceCol];
    if (isAttributeSet(v)) {
      operations.push({ op: 'replace', path: targetKey, value: v });
    }
  }
  return {
    schemas: [PATCH_OP_SCHEMA_URN],
    Operations: operations,
  };
}

export function buildBulkRequest(args: BulkBuildArgs): BulkRequestEnvelope {
  if (args.rows.length > BULK_MAX_OPERATIONS) {
    throw new Error(
      `bulk-builder: row count ${args.rows.length} exceeds RFC 7644 §3.7 cap of ${BULK_MAX_OPERATIONS}`,
    );
  }

  const operations: BulkOperationOut[] = [];

  for (let i = 0; i < args.rows.length; i++) {
    const row = args.rows[i];
    const bulkId = `row-${i + 1}`;

    if (args.mode === 'POST') {
      operations.push({
        method: 'POST',
        path: args.resourcePath,
        bulkId,
        data: buildPostData(args.resourceSchema, row, args.mapping),
      });
      continue;
    }

    // PATCH / DELETE require an id column.
    const idCol = args.idColumn ?? 'id';
    const idValue = row[idCol];
    if (!isAttributeSet(idValue)) {
      // Defensive skip: row has no id, cannot target.
      continue;
    }

    if (args.mode === 'PATCH') {
      operations.push({
        method: 'PATCH',
        path: `${args.resourcePath}/${idValue}`,
        bulkId,
        data: buildPatchData(row, args.mapping),
      });
      continue;
    }

    // DELETE
    operations.push({
      method: 'DELETE',
      path: `${args.resourcePath}/${idValue}`,
      bulkId,
    });
  }

  const envelope: BulkRequestEnvelope = {
    schemas: [BULK_REQUEST_SCHEMA_URN],
    Operations: operations,
  };
  if (args.failOnErrors !== undefined && args.failOnErrors > 0) {
    envelope.failOnErrors = args.failOnErrors;
  }
  return envelope;
}
