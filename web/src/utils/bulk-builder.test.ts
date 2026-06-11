/**
 * Phase M2 - bulk-builder pure module tests.
 *
 * Turns parsed CSV rows + a column mapping into a SCIM BulkRequest
 * envelope (RFC 7644 §3.7) ready to POST to
 * /scim/endpoints/:id/Bulk.
 *
 * Properties under test:
 *   1. Empty rows -> empty Operations + canonical schemas URN
 *   2. POST mapping: each CSV row becomes a POST op with bulkId +
 *      data carrying the mapped attribute key/value pairs
 *   3. POST schemas array always includes the resource-type core URN
 *   4. PATCH mapping: each row becomes a PATCH op with the row id
 *      injected into path; data is a SCIM PatchOp envelope
 *   5. DELETE mapping: each row becomes a DELETE op with id in path
 *   6. Missing source columns produce undefined values (omitted)
 *   7. Empty string values are treated as not-set (omitted)
 *   8. failOnErrors threshold is included only when > 0
 *   9. Cap at BULK_MAX_OPERATIONS - throws when exceeded
 *  10. Schema-extension-style dotted keys work (e.g. enterprise.department)
 */
import { describe, it, expect } from 'vitest';
import {
  buildBulkRequest,
  BULK_REQUEST_SCHEMA_URN,
  BULK_MAX_OPERATIONS,
  type BulkBuildArgs,
  type ColumnMapping,
} from './bulk-builder';

const userRows = [
  { user: 'alice@x.com', name: 'Alice', extId: 'ext-1' },
  { user: 'bob@y.com', name: 'Bob', extId: 'ext-2' },
];

describe('Phase M2 - buildBulkRequest (pure RFC 7644 §3.7 BulkRequest assembler)', () => {
  it('exposes the canonical BulkRequest URN and 1000-op cap', () => {
    expect(BULK_REQUEST_SCHEMA_URN).toBe('urn:ietf:params:scim:api:messages:2.0:BulkRequest');
    expect(BULK_MAX_OPERATIONS).toBe(1000);
  });

  it('empty rows -> envelope with empty Operations', () => {
    const env = buildBulkRequest({
      mode: 'POST',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [],
      mapping: {},
    });
    expect(env).toEqual({
      schemas: [BULK_REQUEST_SCHEMA_URN],
      Operations: [],
    });
  });

  it('POST mode: each row becomes a POST op with auto-assigned bulkId', () => {
    const env = buildBulkRequest({
      mode: 'POST',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: userRows,
      mapping: { user: 'userName', name: 'displayName' },
    });
    expect(env.Operations).toHaveLength(2);
    expect(env.Operations[0]).toEqual({
      method: 'POST',
      path: '/Users',
      bulkId: 'row-1',
      data: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'alice@x.com',
        displayName: 'Alice',
      },
    });
    expect(env.Operations[1].bulkId).toBe('row-2');
    expect((env.Operations[1].data as Record<string, unknown>).userName).toBe('bob@y.com');
  });

  it('POST mode: data carries the resource-type core URN in schemas', () => {
    const env = buildBulkRequest({
      mode: 'POST',
      resourcePath: '/Groups',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      rows: [{ d: 'Eng' }],
      mapping: { d: 'displayName' },
    });
    const data = env.Operations[0].data as Record<string, unknown>;
    expect(data.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:Group']);
    expect(data.displayName).toBe('Eng');
  });

  it('POST mode: missing source column -> attribute omitted (no undefined-string)', () => {
    const env = buildBulkRequest({
      mode: 'POST',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [{ user: 'alice@x.com' }],
      mapping: { user: 'userName', missing: 'displayName' },
    });
    const data = env.Operations[0].data as Record<string, unknown>;
    expect(data.userName).toBe('alice@x.com');
    expect(data).not.toHaveProperty('displayName');
  });

  it('POST mode: empty-string value -> attribute omitted (no empty-string-as-data)', () => {
    const env = buildBulkRequest({
      mode: 'POST',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [{ user: 'alice@x.com', name: '' }],
      mapping: { user: 'userName', name: 'displayName' },
    });
    const data = env.Operations[0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('displayName');
  });

  it('PATCH mode: each row becomes a PATCH op with id injected into path', () => {
    const env = buildBulkRequest({
      mode: 'PATCH',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [
        { id: 'u1', name: 'NewName' },
        { id: 'u2', name: 'Other' },
      ],
      mapping: { name: 'displayName' },
      idColumn: 'id',
    });
    expect(env.Operations[0].method).toBe('PATCH');
    expect(env.Operations[0].path).toBe('/Users/u1');
    const data = env.Operations[0].data as Record<string, unknown>;
    expect(data.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:PatchOp']);
    expect(data.Operations).toEqual([
      { op: 'replace', path: 'displayName', value: 'NewName' },
    ]);
  });

  it('DELETE mode: each row becomes a DELETE op with id-in-path; no data', () => {
    const env = buildBulkRequest({
      mode: 'DELETE',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [{ id: 'u1' }, { id: 'u2' }],
      mapping: {},
      idColumn: 'id',
    });
    expect(env.Operations).toHaveLength(2);
    expect(env.Operations[0]).toEqual({
      method: 'DELETE',
      path: '/Users/u1',
      bulkId: 'row-1',
    });
    expect(env.Operations[0]).not.toHaveProperty('data');
  });

  it('failOnErrors threshold included only when > 0', () => {
    const baseArgs: BulkBuildArgs = {
      mode: 'POST',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [{ u: 'a@x.com' }],
      mapping: { u: 'userName' },
    };
    const env0 = buildBulkRequest({ ...baseArgs });
    expect(env0).not.toHaveProperty('failOnErrors');

    const env5 = buildBulkRequest({ ...baseArgs, failOnErrors: 5 });
    expect(env5).toHaveProperty('failOnErrors', 5);

    const envExplicit0 = buildBulkRequest({ ...baseArgs, failOnErrors: 0 });
    expect(envExplicit0).not.toHaveProperty('failOnErrors');
  });

  it('throws when row count exceeds BULK_MAX_OPERATIONS', () => {
    const tooMany = Array.from({ length: BULK_MAX_OPERATIONS + 1 }, (_, i) => ({ u: `a${i}@x.com` }));
    expect(() =>
      buildBulkRequest({
        mode: 'POST',
        resourcePath: '/Users',
        resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
        rows: tooMany,
        mapping: { u: 'userName' },
      }),
    ).toThrow(/1000|cap|max/i);
  });

  it('PATCH mode: rows missing the id column are skipped (defensive)', () => {
    const env = buildBulkRequest({
      mode: 'PATCH',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [{ id: 'u1', name: 'NewName' }, { name: 'NoId' }],
      mapping: { name: 'displayName' },
      idColumn: 'id',
    });
    expect(env.Operations).toHaveLength(1);
    expect(env.Operations[0].path).toBe('/Users/u1');
  });

  it('schema-extension-style dotted target keys are preserved in data', () => {
    const env = buildBulkRequest({
      mode: 'POST',
      resourcePath: '/Users',
      resourceSchema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      rows: [{ u: 'alice@x.com', dept: 'Eng' }],
      mapping: {
        u: 'userName',
        dept: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
      } satisfies ColumnMapping,
    });
    const data = env.Operations[0].data as Record<string, unknown>;
    expect(data['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department']).toBe('Eng');
  });
});
