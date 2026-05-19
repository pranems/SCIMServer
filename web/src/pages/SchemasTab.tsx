/**
 * SchemasTab - read-only tree view of an endpoint's SCIM schemas.
 *
 * Phase D3 per UI_REDESIGN_REMAINING_GAPS_PLAN.md S7.3.
 *
 * Renders:
 *   - One row per schema: name + URN + attribute count + Copy URN button
 *   - Expand/collapse: schema -> attribute list
 *   - Each attribute shows characteristic badges (type, mutability,
 *     returned, uniqueness, required, multiValued, caseExact)
 *   - Complex attributes can expand a second level into sub-attributes
 *   - LoadingSkeleton on isLoading (G1 pattern)
 *   - EmptyState when SchemaDiscovery is disabled (zero schemas)
 *
 * Data source: GET /scim/endpoints/$id/Schemas (cached 5min via
 * useEndpointSchemas - schemas rarely change).
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Subtitle2,
  Body1,
  Caption1,
  Button,
  Badge,
} from '@fluentui/react-components';
import {
  DocumentBulletList24Regular,
  ChevronRight20Regular,
  ChevronDown20Regular,
  Copy16Regular,
} from '@fluentui/react-icons';
import {
  useEndpointSchemas,
  type ScimAttributeCharacteristic,
  type ScimSchemaResource,
} from '../api/queries';
import { EmptyState, LoadingSkeleton } from '../components/primitives';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  schemaCard: {
    padding: '12px 16px',
  },
  schemaHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  schemaTitle: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  urnRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: tokens.colorNeutralForeground3,
  },
  urn: {
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  attrCount: {
    color: tokens.colorNeutralForeground3,
  },
  attrList: {
    marginTop: '8px',
    paddingLeft: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  attrLeaf: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  attrLeafAlt: {
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  attrName: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  subAttrList: {
    marginTop: '4px',
    paddingLeft: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    borderLeft: `2px dashed ${tokens.colorNeutralStroke2}`,
  },
  errorBlock: {
    padding: '16px',
    color: tokens.colorPaletteRedForeground1,
  },
});

export interface SchemasTabProps {
  endpointId: string;
}

export const SchemasTab: React.FC<SchemasTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpointSchemas(endpointId);

  if (isLoading) {
    return (
      <div className={classes.root} data-testid="tab-schemas">
        <Subtitle2>Schemas</Subtitle2>
        <LoadingSkeleton count={5} height="56px" data-testid="schemas-skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="tab-schemas">
        <div className={classes.errorBlock} data-testid="schemas-error">
          <Body1>Failed to load schemas: {(error as Error).message}</Body1>
        </div>
      </div>
    );
  }

  if (!data || data.Resources.length === 0) {
    return (
      <div data-testid="tab-schemas">
        <Subtitle2 style={{ marginBottom: '12px' }}>Schemas</Subtitle2>
        <EmptyState
          icon={<DocumentBulletList24Regular />}
          title="No schemas available"
          body="This endpoint has no schemas published, or schema discovery is disabled in its profile settings."
          data-testid="schemas-empty"
        />
      </div>
    );
  }

  return (
    <div className={classes.root} data-testid="tab-schemas">
      <Subtitle2>Schemas</Subtitle2>
      <div data-testid="schemas-tree">
        {data.Resources.map((schema) => (
          <SchemaRow key={schema.id} schema={schema} />
        ))}
      </div>
    </div>
  );
};

const SchemaRow: React.FC<{ schema: ScimSchemaResource }> = ({ schema }) => {
  const classes = useStyles();
  const [expanded, setExpanded] = React.useState(false);
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'error'>('idle');

  const attrCount = schema.attributes.length;
  const countLabel = attrCount === 1 ? '1 attribute' : `${attrCount} attributes`;

  const onCopy = async (): Promise<void> => {
    try {
      // navigator.clipboard.writeText is unavailable in some legacy
      // browsers and in jsdom by default; the test stubs it via
      // Object.defineProperty, and at runtime the admin tool is
      // chrome/edge-only so the path is reliable in production.
      await navigator.clipboard.writeText(schema.id);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  return (
    <Card
      className={classes.schemaCard}
      data-testid={`schema-row-${schema.id}`}
      style={{ marginBottom: '8px' }}
    >
      <div className={classes.schemaHeader}>
        <Button
          appearance="subtle"
          icon={expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse schema' : 'Expand schema'}
          data-testid={`schema-toggle-${schema.id}`}
        />
        <div className={classes.schemaTitle}>
          <span style={{ fontWeight: 600 }}>{schema.name ?? schema.id}</span>
          <div className={classes.urnRow}>
            <span className={classes.urn}>{schema.id}</span>
            <Caption1 className={classes.attrCount}>· {countLabel}</Caption1>
          </div>
        </div>
        <Button
          appearance="secondary"
          icon={<Copy16Regular />}
          onClick={() => { void onCopy(); }}
          aria-label="Copy schema URN"
          data-testid={`schema-copy-${schema.id}`}
        >
          {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy URN'}
        </Button>
      </div>
      {expanded && (
        <div className={classes.attrList}>
          {schema.attributes.map((attr, i) => (
            <AttributeLeaf
              key={attr.name}
              schemaId={schema.id}
              attr={attr}
              alternate={i % 2 === 1}
            />
          ))}
        </div>
      )}
    </Card>
  );
};

interface AttributeLeafProps {
  schemaId: string;
  attr: ScimAttributeCharacteristic;
  alternate: boolean;
}

const AttributeLeaf: React.FC<AttributeLeafProps> = ({ schemaId, attr, alternate }) => {
  const classes = useStyles();
  const [expanded, setExpanded] = React.useState(false);
  const hasSubs = (attr.subAttributes?.length ?? 0) > 0;

  return (
    <div>
      <div
        className={`${classes.attrLeaf} ${alternate ? classes.attrLeafAlt : ''}`}
        data-testid={`attr-leaf-${schemaId}-${attr.name}`}
      >
        {hasSubs && (
          <Button
            appearance="transparent"
            size="small"
            icon={expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse sub-attributes' : 'Expand sub-attributes'}
            data-testid={`attr-toggle-${schemaId}-${attr.name}`}
          />
        )}
        <span className={classes.attrName}>{attr.name}</span>
        <CharacteristicBadges attr={attr} />
      </div>
      {expanded && hasSubs && (
        <div className={classes.subAttrList}>
          {attr.subAttributes!.map((sub) => (
            <div
              key={sub.name}
              className={classes.attrLeaf}
              data-testid={`subattr-leaf-${schemaId}-${attr.name}-${sub.name}`}
            >
              <span className={classes.attrName}>{sub.name}</span>
              <CharacteristicBadges attr={sub} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CharacteristicBadges: React.FC<{ attr: ScimAttributeCharacteristic }> = ({ attr }) => {
  // Render a badge per characteristic the spec calls out as relevant.
  // Each badge color/appearance encodes a hint:
  //   - type/mutability -> outline (informational)
  //   - returned -> filled (caller-visible at write time)
  //   - uniqueness -> filled subtle
  //   - required -> filled brand
  //   - multiValued -> outline (only when true)
  return (
    <>
      <Badge appearance="outline" size="small">{attr.type}</Badge>
      {attr.required && (
        <Badge appearance="filled" color="brand" size="small">required</Badge>
      )}
      {attr.mutability && attr.mutability !== 'readWrite' && (
        <Badge appearance="outline" size="small">{attr.mutability}</Badge>
      )}
      {attr.mutability === 'readWrite' && (
        <Badge appearance="outline" size="small">readWrite</Badge>
      )}
      {attr.returned && attr.returned !== 'default' && (
        <Badge appearance="filled" color="informative" size="small">{attr.returned}</Badge>
      )}
      {attr.uniqueness && attr.uniqueness !== 'none' && (
        <Badge appearance="filled" color="warning" size="small">{attr.uniqueness}</Badge>
      )}
      {attr.multiValued && (
        <Badge appearance="outline" size="small">multiValued</Badge>
      )}
      {attr.caseExact && (
        <Badge appearance="outline" size="small">caseExact</Badge>
      )}
    </>
  );
};
