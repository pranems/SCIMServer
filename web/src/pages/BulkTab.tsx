/**
 * BulkTab (Phase M2) - Bulk Operations UI.
 *
 * Per [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S4.3], wires the
 * existing `POST /scim/endpoints/:id/Bulk` surface (RFC 7644 §3.7,
 * 1000-op cap, 1 MB payload limit) into a friendly UX. Pre-M2 the
 * only consumer was scripts/live-test.ps1.
 *
 * Mounted as a nested tab under EndpointDetailPage between Activity
 * and Schemas. Composed of:
 *
 *   - Mode picker (POST | PATCH | DELETE) + Resource picker (Users | Groups)
 *   - CSV file input (drop-zone-style; max 1 MB)
 *   - Mapping panel: each parsed CSV column gets a target-attribute
 *     select pre-populated to the column name (operator can override)
 *   - Preview pane: assembled BulkRequest envelope (first 10 ops)
 *   - failOnErrors numeric input
 *   - Submit button
 *   - Result viewer: success/failure totals + per-op rows + Download
 *     failures CSV button (with error.detail / error.scimType columns)
 *
 * @see docs/PHASE_M2_BULK_OPERATIONS.md
 * @see web/src/utils/csv-parse.ts
 * @see web/src/utils/bulk-builder.ts
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Subtitle1,
  Subtitle2,
  Caption1,
  Text,
  Badge,
  Button,
  Field,
  Input,
} from '@fluentui/react-components';
import {
  Send24Regular,
  ArrowDownload24Regular,
  Stack24Regular,
} from '@fluentui/react-icons';
import { useScimBulk, type ScimBulkOutcome } from '../api/queries';
import { parseCsv, type CsvParseResult } from '../utils/csv-parse';
import {
  buildBulkRequest,
  type BulkMode,
  type ColumnMapping,
} from '../utils/bulk-builder';
import { toCsv, triggerCsvDownload } from '../utils/csv-export';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import { CopyableJsonBlock, CopyJsonButton } from '../components/primitives';

type BulkResource = 'Users' | 'Groups';

const RESOURCE_SCHEMA: Record<BulkResource, string> = {
  Users: 'urn:ietf:params:scim:schemas:core:2.0:User',
  Groups: 'urn:ietf:params:scim:schemas:core:2.0:Group',
};

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  toolbar: {
    display: 'grid',
    gridTemplateColumns: '160px 160px 1fr 140px',
    gap: '12px',
    alignItems: 'end',
  },
  mappingGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    rowGap: '6px',
    columnGap: '8px',
    alignItems: 'center',
  },
  preview: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    margin: 0,
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
    maxHeight: '320px',
  },
  resultRow: {
    display: 'grid',
    gridTemplateColumns: '80px 80px 1fr 1fr',
    columnGap: '12px',
    padding: '6px 8px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    fontSize: tokens.fontSizeBase200,
    alignItems: 'center',
  },
});

interface BulkOperationResultLite {
  method?: string;
  bulkId?: string;
  status?: string;
  location?: string;
  response?: { scimType?: string; detail?: string; status?: string };
}

function statusBadgeColor(status: string | undefined): 'success' | 'warning' | 'danger' | 'subtle' {
  if (!status) return 'subtle';
  const n = parseInt(status, 10);
  if (n >= 200 && n < 300) return 'success';
  if (n >= 300 && n < 400) return 'warning';
  if (n >= 400) return 'danger';
  return 'subtle';
}

function isFailure(op: BulkOperationResultLite): boolean {
  if (!op.status) return false;
  const n = parseInt(op.status, 10);
  return n >= 400;
}

export interface BulkTabProps {
  endpointId: string;
}

export const BulkTab: React.FC<BulkTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const submit = useScimBulk(endpointId);

  const [mode, setMode] = useState<BulkMode>('POST');
  const [resource, setResource] = useState<BulkResource>('Users');
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<CsvParseResult>({ headers: [], rows: [] });
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [idColumn, setIdColumn] = useState<string>('id');
  const [failOnErrors, setFailOnErrors] = useState<number>(0);
  const [outcome, setOutcome] = useState<ScimBulkOutcome | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);

  // Re-parse + rebuild default mapping whenever csvText changes.
  useEffect(() => {
    if (csvText.length === 0) {
      setParsed({ headers: [], rows: [] });
      setMapping({});
      return;
    }
    const r = parseCsv(csvText);
    setParsed(r);
    if (!r.error) {
      // Default mapping: each header maps to itself as the SCIM target.
      const m: ColumnMapping = {};
      for (const h of r.headers) m[h] = h;
      setMapping(m);
    }
  }, [csvText]);

  const handleFile = async (file: File): Promise<void> => {
    const text = await file.text();
    setCsvText(text);
    setOutcome(null);
    setSubmitError(null);
  };

  const envelope = useMemo(() => {
    if (parsed.rows.length === 0 || Object.keys(mapping).length === 0) return null;
    try {
      return buildBulkRequest({
        mode,
        resourcePath: `/${resource}`,
        resourceSchema: RESOURCE_SCHEMA[resource],
        rows: parsed.rows,
        mapping,
        idColumn: mode === 'POST' ? undefined : idColumn,
        failOnErrors,
      });
    } catch (e) {
      setSubmitError(e);
      return null;
    }
  }, [parsed.rows, mapping, mode, resource, idColumn, failOnErrors]);

  const submitDisabled =
    !!parsed.error || envelope === null || envelope.Operations.length === 0 || submit.isPending;

  const handleSubmit = async (): Promise<void> => {
    if (!envelope) return;
    setSubmitError(null);
    setOutcome(null);
    try {
      const o = await submit.mutateAsync(envelope as unknown as Record<string, unknown>);
      setOutcome(o);
    } catch (e) {
      setSubmitError(e);
    }
  };

  const operations: BulkOperationResultLite[] = useMemo(() => {
    if (!outcome?.body || typeof outcome.body !== 'object') return [];
    const ops = (outcome.body as Record<string, unknown>).Operations;
    return Array.isArray(ops) ? (ops as BulkOperationResultLite[]) : [];
  }, [outcome]);

  const successCount = operations.filter((o) => !isFailure(o)).length;
  const failureCount = operations.filter(isFailure).length;

  const handleDownloadFailures = (): void => {
    const failures = operations.filter(isFailure);
    const rows = failures.map((op) => ({
      bulkId: op.bulkId ?? '',
      method: op.method ?? '',
      status: op.status ?? '',
      scimType: op.response?.scimType ?? '',
      detail: op.response?.detail ?? '',
    }));
    const csv = toCsv(rows, { columns: ['bulkId', 'method', 'status', 'scimType', 'detail'] });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    triggerCsvDownload(`bulk-failures-${ts}.csv`, csv);
  };

  return (
    <div className={classes.page} data-testid="bulk-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Stack24Regular />
        <Subtitle1>Bulk operations</Subtitle1>
      </div>
      <Caption1>
        Upload a CSV of resources and submit them as a single SCIM Bulk request (RFC 7644 §3.7).
        Cap: 1000 operations + 1 MB payload. Failure rows are downloadable as CSV with the per-op
        scimType + detail for retry triage.
      </Caption1>

      <Card style={{ padding: '12px' }}>
        <div className={classes.toolbar}>
          <Field label="Mode">
            <select
              data-testid="bulk-mode-picker"
              value={mode}
              onChange={(e) => setMode(e.target.value as BulkMode)}
              style={{ height: '32px', padding: '0 8px' }}
            >
              <option value="POST">POST (create)</option>
              <option value="PATCH">PATCH (update)</option>
              <option value="DELETE">DELETE</option>
            </select>
          </Field>
          <Field label="Resource">
            <select
              data-testid="bulk-resource-picker"
              value={resource}
              onChange={(e) => setResource(e.target.value as BulkResource)}
              style={{ height: '32px', padding: '0 8px' }}
            >
              <option value="Users">Users</option>
              <option value="Groups">Groups</option>
            </select>
          </Field>
          <Field label="CSV file">
            <input
              type="file"
              accept=".csv,text/csv"
              data-testid="bulk-csv-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </Field>
          <Button
            appearance="primary"
            icon={<Send24Regular />}
            onClick={() => void handleSubmit()}
            disabled={submitDisabled}
            data-testid="bulk-submit"
          >
            {submit.isPending ? 'Submitting...' : 'Submit'}
          </Button>
        </div>

        {parsed.error && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1, marginTop: '8px' }} data-testid="bulk-csv-error">
            CSV parse error: {parsed.error}
          </Caption1>
        )}

        {parsed.headers.length > 0 && !parsed.error && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            {(mode === 'PATCH' || mode === 'DELETE') && (
              <Field label="ID column">
                <select
                  data-testid="bulk-id-column"
                  value={idColumn}
                  onChange={(e) => setIdColumn(e.target.value)}
                  style={{ height: '32px', padding: '0 8px' }}
                >
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="failOnErrors (0 = process all)">
              <Input
                type="number"
                value={String(failOnErrors)}
                onChange={(_e, d) => setFailOnErrors(Math.max(0, parseInt(d.value, 10) || 0))}
                data-testid="bulk-fail-on-errors"
                input={{ style: { width: '80px' } }}
              />
            </Field>
          </div>
        )}
      </Card>

      {parsed.headers.length > 0 && !parsed.error && (
        <Card style={{ padding: '12px' }} data-testid="bulk-mapping">
          <Subtitle2>Column mapping</Subtitle2>
          <Caption1>Each CSV column maps to a SCIM target attribute. Edit to override.</Caption1>
          <div className={classes.mappingGrid} style={{ marginTop: '8px' }}>
            {parsed.headers.map((h) => (
              <React.Fragment key={h}>
                <Text style={{ fontFamily: tokens.fontFamilyMonospace }}>{h}</Text>
                <span style={{ color: tokens.colorNeutralForeground3 }}>{'->'}</span>
                <Input
                  data-testid={`bulk-mapping-row-${h}`}
                  value={mapping[h] ?? ''}
                  onChange={(_e, d) =>
                    setMapping((prev) => ({ ...prev, [h]: d.value }))
                  }
                  input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
                />
              </React.Fragment>
            ))}
          </div>
        </Card>
      )}

      {envelope && !parsed.error && (
        <Card style={{ padding: '12px' }} data-testid="bulk-preview">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <Subtitle2>Preview (first 10 operations)</Subtitle2>
            <CopyJsonButton
              value={envelope}
              label="Copy full envelope as JSON"
              data-testid="bulk-preview-copy-full"
            />
          </div>
          <Caption1>{envelope.Operations.length} total operations queued.</Caption1>
          <CopyableJsonBlock
            value={{ ...envelope, Operations: envelope.Operations.slice(0, 10) }}
            label="First 10 operations"
            maxHeight="360px"
            data-testid="bulk-preview-json"
          />
        </Card>
      )}

      {submitError != null && <ScimErrorMessage error={submitError} />}

      {outcome && (
        <Card style={{ padding: '12px' }} data-testid="bulk-result">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Subtitle2>Result</Subtitle2>
            <Badge appearance="filled" color={statusBadgeColor(String(outcome.status))} size="medium">
              HTTP {outcome.status}
            </Badge>
            <Caption1>{outcome.durationMs} ms</Caption1>
            <Badge appearance="filled" color="success" size="small">
              <span data-testid="bulk-result-success-count">{successCount}</span> success
            </Badge>
            <Badge appearance="filled" color="danger" size="small">
              <span data-testid="bulk-result-failure-count">{failureCount}</span> failure
            </Badge>
            {failureCount > 0 && (
              <Button
                appearance="secondary"
                icon={<ArrowDownload24Regular />}
                onClick={handleDownloadFailures}
                data-testid="bulk-download-failures"
              >
                Download failures CSV
              </Button>
            )}
          </div>
          <div style={{ marginTop: '12px' }}>
            {operations.map((op) => (
              <div
                key={op.bulkId ?? Math.random()}
                className={classes.resultRow}
                data-testid={`bulk-result-row-${op.bulkId ?? 'unknown'}`}
              >
                <Text style={{ fontFamily: tokens.fontFamilyMonospace }}>{op.bulkId ?? '-'}</Text>
                <Badge appearance="filled" color={statusBadgeColor(op.status)} size="small">
                  {op.status ?? '-'}
                </Badge>
                <Caption1 style={{ fontFamily: tokens.fontFamilyMonospace }}>
                  {op.location ?? '-'}
                </Caption1>
                <Caption1>{op.response?.detail ?? ''}</Caption1>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
