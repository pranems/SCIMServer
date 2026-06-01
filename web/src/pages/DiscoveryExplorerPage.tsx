/**
 * DiscoveryExplorerPage (Phase L5) - Discovery Explorer + two-endpoint diff.
 *
 * Source-of-truth gap closed per
 * [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S4.8].
 *
 * Mounts at `/discovery` (5th sidebar nav entry, between Manual
 * Provision and Logs). Three sub-tabs each render one of the SCIM
 * Discovery surfaces for the picked endpoint:
 *
 *   - ServiceProviderConfig - capability flags (patch/filter/etag/bulk/...)
 *   - ResourceTypes         - list of resource types + schema URNs
 *   - Schemas               - list of schemas (with attribute count)
 *
 * Endpoint scope picker: 1 endpoint by default; clicking
 * "Compare with another" reveals a secondary picker. When two are
 * picked the Schemas tab swaps to a side-by-side diff view with
 * cells colored red/green/grey by the diff reducer status (the
 * `data-status` attribute drives the CSS, mirroring the API's
 * tighten-only validator algebra).
 *
 * Action buttons:
 *   - Copy as JSON     - clipboard write of the active surface (JSON)
 *   - Copy as URN      - clipboard write of the active schema URN (when applicable)
 *   - Open in Workbench - disabled stub; wired in Phase M1
 *
 * @see docs/PHASE_L5_DISCOVERY_EXPLORER.md
 * @see web/src/utils/discovery-diff.ts (the diff reducer)
 */
import React, { useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Button,
  Subtitle1,
  Subtitle2,
  Caption1,
  Text,
  Badge,
  TabList,
  Tab,
  Tooltip,
} from '@fluentui/react-components';
import {
  Search24Regular,
  Copy16Regular,
  ArrowSwap20Regular,
  Open24Regular,
  ArrowSync20Regular,
} from '@fluentui/react-icons';
import { useNavigate } from '@tanstack/react-router';
import {
  useEndpoints,
  useEndpointSchemas,
  useEndpointResourceTypes,
  useEndpointServiceProviderConfig,
  type ScimSchemaResource,
  type ScimResourceType,
  type ScimServiceProviderConfig,
} from '../api/queries';
import { EmptyState, LoadingSkeleton, CopyableField, CopyJsonButton } from '../components/primitives';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import {
  compareSchemas,
  type ScimSchemaForDiff,
  type DiffStatus,
  type CharacteristicKey,
  type AttributeDiffRow,
} from '../utils/discovery-diff';

type DiscoveryTabKey = 'serviceProviderConfig' | 'resourceTypes' | 'schemas';

const TAB_LABEL: Record<DiscoveryTabKey, string> = {
  serviceProviderConfig: 'ServiceProviderConfig',
  resourceTypes: 'ResourceTypes',
  schemas: 'Schemas',
};

// ─── Styles ──────────────────────────────────────────────────────────

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px',
  },
  pickerRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  pickerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '8px',
  },
  pickerCard: {
    padding: '10px',
    cursor: 'pointer',
    border: `1px solid transparent`,
  },
  pickerCardSelected: {
    borderColor: tokens.colorBrandStroke1,
    boxShadow: tokens.shadow4Brand,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  surfaceCard: {
    padding: '12px 16px',
  },
  rowGrid: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    columnGap: '12px',
    rowGap: '6px',
    alignItems: 'center',
  },
  diffTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  diffHeaderCell: {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
  },
  diffRow: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  diffNameCell: {
    padding: '6px 8px',
    fontWeight: 600,
  },
  diffCell: {
    padding: '4px 8px',
    fontSize: '11px',
  },
  cellTighten: {
    backgroundColor: '#e5f5e0', // light green
    color: '#1b5e20',
  },
  cellRelax: {
    backgroundColor: '#fde0dc', // light red
    color: '#b71c1c',
  },
  cellUnchanged: {
    color: tokens.colorNeutralForeground3,
  },
  cellIncomparable: {
    backgroundColor: '#fff3e0', // light orange
    color: '#bf360c',
  },
  cellMissing: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
  },
  schemaIdMono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
  },
});

// ─── Component ───────────────────────────────────────────────────────

export const DiscoveryExplorerPage: React.FC = () => {
  const classes = useStyles();
  const navigate = useNavigate();

  const endpoints = useEndpoints();

  const [primaryId, setPrimaryId] = useState<string>('');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [secondaryId, setSecondaryId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<DiscoveryTabKey>('serviceProviderConfig');

  // Hook fan-out: 2 endpoints x 3 surfaces = 6 hooks. Each surface
  // has its own staleTime so the cache tier is correct per resource.
  const primarySchemas = useEndpointSchemas(primaryId);
  const secondarySchemas = useEndpointSchemas(compareEnabled ? secondaryId : '');
  const primaryRT = useEndpointResourceTypes(primaryId);
  const secondaryRT = useEndpointResourceTypes(compareEnabled ? secondaryId : '');
  const primarySpc = useEndpointServiceProviderConfig(primaryId);
  const secondarySpc = useEndpointServiceProviderConfig(
    compareEnabled ? secondaryId : '',
  );

  const endpointList = endpoints.data?.endpoints ?? [];

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const activePayload = useMemo<unknown>(() => {
    if (activeTab === 'serviceProviderConfig') return primarySpc.data;
    if (activeTab === 'resourceTypes') return primaryRT.data;
    return primarySchemas.data;
  }, [activeTab, primarySchemas.data, primaryRT.data, primarySpc.data]);

  const handleCopyJson = async (): Promise<void> => {
    if (!activePayload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(activePayload, null, 2));
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  const handleCopyUrn = async (): Promise<void> => {
    // Pick a sensible URN to copy: first schema URN if on Schemas
    // tab; SPC schema URN otherwise.
    let urn: string | undefined;
    if (activeTab === 'schemas') {
      urn = primarySchemas.data?.Resources?.[0]?.id;
    } else if (activeTab === 'serviceProviderConfig') {
      urn = primarySpc.data?.schemas?.[0];
    } else if (activeTab === 'resourceTypes') {
      urn = primaryRT.data?.Resources?.[0]?.schema;
    }
    if (!urn) return;
    try {
      await navigator.clipboard.writeText(urn);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  // ─── No endpoints state ──────────────────────────────────────────

  if (!endpoints.isLoading && endpointList.length === 0) {
    return (
      <div className={classes.page} data-testid="discovery-page">
        <Subtitle1>Discovery Explorer</Subtitle1>
        <EmptyState
          icon={<Search24Regular />}
          title="No endpoints"
          body="Create an endpoint first, then come back to explore its Discovery surfaces."
          data-testid="discovery-no-endpoints"
        />
      </div>
    );
  }

  return (
    <div className={classes.page} data-testid="discovery-page">
      <Subtitle1>Discovery Explorer</Subtitle1>
      <Caption1>
        Read-only view of each endpoint`s SCIM Discovery surfaces (RFC 7644 S4 + S5).
        Pick one endpoint to inspect, or two to compare side-by-side. The Schemas diff
        view colors each attribute characteristic green (tighten), red (relax), or grey
        (unchanged) using the same partial order the API`s tighten-only validator enforces.
      </Caption1>

      {/* Endpoint scope picker */}
      <Card data-testid="discovery-primary-picker">
        <Subtitle2>Primary endpoint</Subtitle2>
        {endpoints.isLoading ? (
          <LoadingSkeleton count={2} height="40px" />
        ) : (
          <div className={classes.pickerGrid}>
            {endpointList.map((ep) => {
              const selected = ep.id === primaryId;
              return (
                <Card
                  key={ep.id}
                  className={`${classes.pickerCard} ${selected ? classes.pickerCardSelected : ''}`}
                  onClick={() => setPrimaryId(ep.id)}
                  role="button"
                  aria-pressed={selected}
                  data-testid={`discovery-primary-option-${ep.id}`}
                >
                  <Text weight="semibold">{ep.displayName ?? ep.name}</Text>
                  <br />
                  <span className={classes.schemaIdMono}>{ep.name}</span>
                </Card>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: '12px' }}>
          <Button
            appearance="subtle"
            icon={<ArrowSwap20Regular />}
            onClick={() => {
              setCompareEnabled((v) => !v);
              if (compareEnabled) setSecondaryId('');
            }}
            data-testid="discovery-toggle-compare"
          >
            {compareEnabled ? 'Hide compare' : 'Compare with another'}
          </Button>
        </div>
      </Card>

      {compareEnabled && (
        <Card data-testid="discovery-secondary-picker">
          <Subtitle2>Secondary endpoint (for diff)</Subtitle2>
          <div className={classes.pickerGrid}>
            {endpointList
              .filter((ep) => ep.id !== primaryId)
              .map((ep) => {
                const selected = ep.id === secondaryId;
                return (
                  <Card
                    key={ep.id}
                    className={`${classes.pickerCard} ${selected ? classes.pickerCardSelected : ''}`}
                    onClick={() => setSecondaryId(ep.id)}
                    role="button"
                    aria-pressed={selected}
                    data-testid={`discovery-secondary-option-${ep.id}`}
                  >
                    <Text weight="semibold">{ep.displayName ?? ep.name}</Text>
                    <br />
                    <span className={classes.schemaIdMono}>{ep.name}</span>
                  </Card>
                );
              })}
          </div>
        </Card>
      )}

      {/* Sub-tabs */}
      <TabList
        selectedValue={activeTab}
        onTabSelect={(_e, d) => setActiveTab(d.value as DiscoveryTabKey)}
        data-testid="discovery-subtabs"
      >
        <Tab
          value="serviceProviderConfig"
          data-testid="discovery-tab-serviceProviderConfig"
        >
          {TAB_LABEL.serviceProviderConfig}
        </Tab>
        <Tab value="resourceTypes" data-testid="discovery-tab-resourceTypes">
          {TAB_LABEL.resourceTypes}
        </Tab>
        <Tab value="schemas" data-testid="discovery-tab-schemas">
          {TAB_LABEL.schemas}
        </Tab>
      </TabList>

      {/* Action toolbar */}
      <div className={classes.toolbar}>
        <CopyJsonButton
          value={activePayload}
          label="Copy as JSON"
          appearance="secondary"
          data-testid="discovery-copy-json"
        />
        <Button
          appearance="secondary"
          icon={<Copy16Regular />}
          onClick={() => void handleCopyUrn()}
          disabled={!primaryId}
          data-testid="discovery-copy-urn"
        >
          Copy as URN
        </Button>
        <Tooltip
          relationship="label"
          content="Open the active surface as a prefilled GET in the Workbench"
        >
          <Button
            appearance="subtle"
            icon={<Open24Regular />}
            disabled={!primaryId}
            onClick={() => {
              // Build the canonical Discovery URL for the active sub-tab
              // and deep-link the Workbench with method=GET prefilled.
              const surface =
                activeTab === 'serviceProviderConfig'
                  ? 'ServiceProviderConfig'
                  : activeTab === 'resourceTypes'
                    ? 'ResourceTypes'
                    : 'Schemas';
              const path = `/scim/endpoints/${primaryId}/${surface}`;
              const prefill = encodeURIComponent(
                JSON.stringify({ method: 'GET', path }),
              );
              navigate({ to: '/workbench', search: { prefill } as Record<string, string> });
            }}
            data-testid="discovery-open-in-workbench"
          >
            Open in Workbench
          </Button>
        </Tooltip>
        <Button
          appearance="subtle"
          icon={<ArrowSync20Regular />}
          onClick={() => {
            // Manual refetch escape hatch (5min staleTime can feel
            // long if the operator just edited a profile in the API).
            primarySchemas.refetch?.();
            primaryRT.refetch?.();
            primarySpc.refetch?.();
            if (compareEnabled && secondaryId) {
              secondarySchemas.refetch?.();
              secondaryRT.refetch?.();
              secondarySpc.refetch?.();
            }
          }}
          data-testid="discovery-refetch"
        >
          Refresh
        </Button>
      </div>

      {/* No primary picked yet */}
      {!primaryId && (
        <EmptyState
          title="Pick an endpoint to begin"
          body="Choose a primary endpoint above to explore its Discovery surfaces."
        />
      )}

      {/* Active surface */}
      {primaryId && activeTab === 'serviceProviderConfig' && (
        <SpcSection
          primary={primarySpc.data}
          primaryLoading={primarySpc.isLoading}
          primaryError={primarySpc.error}
          secondary={compareEnabled && secondaryId ? secondarySpc.data : undefined}
          secondaryLoading={
            compareEnabled && secondaryId ? secondarySpc.isLoading : false
          }
          secondaryError={compareEnabled && secondaryId ? secondarySpc.error : null}
        />
      )}
      {primaryId && activeTab === 'resourceTypes' && (
        <ResourceTypesSection
          primary={primaryRT.data?.Resources ?? []}
          primaryLoading={primaryRT.isLoading}
          primaryError={primaryRT.error}
          secondary={
            compareEnabled && secondaryId
              ? secondaryRT.data?.Resources ?? []
              : undefined
          }
        />
      )}
      {primaryId && activeTab === 'schemas' && (
        <SchemasSection
          primary={primarySchemas.data?.Resources ?? []}
          primaryLoading={primarySchemas.isLoading}
          primaryError={primarySchemas.error}
          secondary={
            compareEnabled && secondaryId
              ? secondarySchemas.data?.Resources ?? []
              : undefined
          }
        />
      )}
    </div>
  );
};

// ─── ServiceProviderConfig section ───────────────────────────────────

const SpcSection: React.FC<{
  primary: ScimServiceProviderConfig | undefined;
  primaryLoading: boolean;
  primaryError: unknown;
  secondary?: ScimServiceProviderConfig;
  secondaryLoading: boolean;
  secondaryError: unknown;
}> = ({ primary, primaryLoading, primaryError, secondary, secondaryLoading, secondaryError }) => {
  const classes = useStyles();
  if (primaryLoading) return <LoadingSkeleton count={4} height="32px" />;
  if (primaryError) return <ScimErrorMessage error={primaryError} />;
  if (!primary) return null;

  const rows: Array<{ key: string; primaryValue: string; secondaryValue?: string }> = [];
  const flagKeys = ['patch', 'filter', 'etag', 'bulk', 'changePassword', 'sort'] as const;
  for (const k of flagKeys) {
    const pVal = (primary as Record<string, { supported?: boolean } | undefined>)[k];
    const sVal = secondary
      ? (secondary as Record<string, { supported?: boolean } | undefined>)[k]
      : undefined;
    rows.push({
      key: k,
      primaryValue: pVal ? `supported=${pVal.supported}` : 'absent',
      secondaryValue: secondary ? (sVal ? `supported=${sVal.supported}` : 'absent') : undefined,
    });
  }

  return (
    <Card className={classes.surfaceCard} data-testid="discovery-spc-section">
      {secondaryLoading && <LoadingSkeleton count={2} height="20px" />}
      {secondaryError && <ScimErrorMessage error={secondaryError} />}
      <table className={classes.diffTable}>
        <thead>
          <tr>
            <th className={classes.diffHeaderCell}>Capability</th>
            <th className={classes.diffHeaderCell}>Primary</th>
            {secondary && <th className={classes.diffHeaderCell}>Secondary</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={classes.diffRow} data-testid={`discovery-spc-row-${r.key}`}>
              <td className={classes.diffNameCell}>{r.key}</td>
              <td className={classes.diffCell}>{r.primaryValue}</td>
              {secondary && <td className={classes.diffCell}>{r.secondaryValue}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

// ─── ResourceTypes section ───────────────────────────────────────────

const ResourceTypesSection: React.FC<{
  primary: ScimResourceType[];
  primaryLoading: boolean;
  primaryError: unknown;
  secondary?: ScimResourceType[];
}> = ({ primary, primaryLoading, primaryError, secondary }) => {
  const classes = useStyles();
  if (primaryLoading) return <LoadingSkeleton count={3} height="32px" />;
  if (primaryError) return <ScimErrorMessage error={primaryError} />;
  if (primary.length === 0) {
    return (
      <EmptyState
        title="No resource types"
        body="The endpoint published an empty ResourceTypes ListResponse."
      />
    );
  }

  const secMap = new Map<string, ScimResourceType>();
  for (const rt of secondary ?? []) secMap.set(rt.id, rt);

  return (
    <Card className={classes.surfaceCard} data-testid="discovery-resourcetypes-section">
      {primary.map((rt) => {
        const sRt = secMap.get(rt.id);
        return (
          <div key={rt.id} data-testid={`discovery-resourcetype-row-${rt.id}`} style={{ marginBottom: '8px' }}>
            <Text weight="semibold">{rt.name}</Text>
            <span className={classes.schemaIdMono}> · endpoint {rt.endpoint}</span>
            <CopyableField
              value={`schema: ${rt.schema}`}
              copyValue={rt.schema}
              monospace
              truncate
              maxWidth="100%"
              data-testid={`discovery-resourcetype-schema-${rt.id}`}
            />
            {sRt && sRt.schema !== rt.schema && (
              <Badge appearance="filled" color="warning" size="small">
                differs from secondary
              </Badge>
            )}
          </div>
        );
      })}
    </Card>
  );
};

// ─── Schemas section ─────────────────────────────────────────────────

const SchemasSection: React.FC<{
  primary: ScimSchemaResource[];
  primaryLoading: boolean;
  primaryError: unknown;
  secondary?: ScimSchemaResource[];
}> = ({ primary, primaryLoading, primaryError, secondary }) => {
  const classes = useStyles();
  if (primaryLoading) return <LoadingSkeleton count={3} height="32px" />;
  if (primaryError) return <ScimErrorMessage error={primaryError} />;
  if (primary.length === 0) {
    return (
      <EmptyState
        title="No schemas"
        body="The endpoint published an empty Schemas ListResponse."
      />
    );
  }

  // Single-endpoint mode: render a simple list.
  if (!secondary) {
    return (
      <Card className={classes.surfaceCard} data-testid="discovery-schemas-single">
        {primary.map((s) => (
          <div
            key={s.id}
            data-testid={`discovery-schema-row-${s.id}`}
            style={{ marginBottom: '6px' }}
          >
            <Text weight="semibold">{s.name ?? s.id}</Text>
            <CopyableField
              value={s.id}
              monospace
              truncate
              maxWidth="100%"
              data-testid={`discovery-schema-urn-${s.id}`}
            />
            <Caption1>{s.attributes.length} attributes</Caption1>
          </div>
        ))}
      </Card>
    );
  }

  // Two-endpoint diff view.
  return <SchemasDiffView primary={primary} secondary={secondary} />;
};

// ─── Schemas diff view ───────────────────────────────────────────────

const CHAR_KEYS: CharacteristicKey[] = [
  'required',
  'caseExact',
  'mutability',
  'returned',
  'uniqueness',
  'type',
  'multiValued',
];

const SchemasDiffView: React.FC<{
  primary: ScimSchemaResource[];
  secondary: ScimSchemaResource[];
}> = ({ primary, secondary }) => {
  const classes = useStyles();

  // Build per-schema diff for the union of schema URNs.
  const secMap = new Map<string, ScimSchemaResource>();
  for (const s of secondary) secMap.set(s.id, s);

  const allUrns = new Set<string>([
    ...primary.map((s) => s.id),
    ...secondary.map((s) => s.id),
  ]);

  return (
    <Card className={classes.surfaceCard} data-testid="discovery-schemas-diff">
      {Array.from(allUrns).map((urn) => {
        const a = primary.find((s) => s.id === urn);
        const b = secMap.get(urn);
        // Either side may be missing the schema entirely.
        const aForDiff: ScimSchemaForDiff = {
          id: urn,
          attributes: a?.attributes ?? [],
        };
        const bForDiff: ScimSchemaForDiff = {
          id: urn,
          attributes: b?.attributes ?? [],
        };
        const diff = compareSchemas(aForDiff, bForDiff);
        return (
          <div key={urn} style={{ marginBottom: '20px' }}>
            <Subtitle2>{a?.name ?? b?.name ?? urn}</Subtitle2>
            <CopyableField
              value={urn}
              monospace
              truncate
              maxWidth="100%"
              data-testid={`discovery-diff-schema-urn-${urn}`}
            />
            <Caption1>
              {diff.summary.tightenCount} tightened ·{' '}
              {diff.summary.relaxCount} relaxed ·{' '}
              {diff.summary.unchangedCount} unchanged ·{' '}
              {diff.summary.incomparableCount} incomparable ·{' '}
              {diff.summary.onlyACount} only on primary ·{' '}
              {diff.summary.onlyBCount} only on secondary
            </Caption1>
            <table className={classes.diffTable} style={{ marginTop: '8px' }}>
              <thead>
                <tr>
                  <th className={classes.diffHeaderCell}>Attribute</th>
                  {CHAR_KEYS.map((k) => (
                    <th key={k} className={classes.diffHeaderCell}>
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diff.rows.map((row) => (
                  <DiffRowRender key={row.name} schemaId={urn} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </Card>
  );
};

const DiffRowRender: React.FC<{
  schemaId: string;
  row: AttributeDiffRow;
}> = ({ schemaId, row }) => {
  const classes = useStyles();

  const statusClass = (status: DiffStatus): string => {
    switch (status) {
      case 'tighten':
        return classes.cellTighten;
      case 'relax':
        return classes.cellRelax;
      case 'incomparable':
        return classes.cellIncomparable;
      case 'only-a':
      case 'only-b':
        return classes.cellMissing;
      case 'unchanged':
      default:
        return classes.cellUnchanged;
    }
  };

  return (
    <tr
      className={classes.diffRow}
      data-testid={`discovery-diff-row-${schemaId}-${row.name}`}
      data-presence={row.presence}
    >
      <td className={classes.diffNameCell}>
        {row.name}
        {row.presence === 'only-a' && (
          <Badge appearance="filled" color="warning" size="small" style={{ marginLeft: '4px' }}>
            only on primary
          </Badge>
        )}
        {row.presence === 'only-b' && (
          <Badge appearance="filled" color="warning" size="small" style={{ marginLeft: '4px' }}>
            only on secondary
          </Badge>
        )}
      </td>
      {CHAR_KEYS.map((k) => {
        const status = row.characteristics[k];
        const aVal = row.a?.[k];
        const bVal = row.b?.[k];
        let cellText = String(aVal ?? '-');
        if (row.presence === 'both' && status !== 'unchanged') {
          cellText = `${aVal ?? '-'} -> ${bVal ?? '-'}`;
        } else if (row.presence === 'only-a') {
          cellText = String(aVal ?? '-');
        } else if (row.presence === 'only-b') {
          cellText = String(bVal ?? '-');
        }
        return (
          <td
            key={k}
            className={`${classes.diffCell} ${statusClass(status)}`}
            data-status={status}
            data-testid={`discovery-diff-cell-${schemaId}-${row.name}-${k}`}
          >
            {cellText}
          </td>
        );
      })}
    </tr>
  );
};
