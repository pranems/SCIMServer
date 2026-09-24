import React from 'react';
import {
  Badge,
  Card,
  Link,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  useEndpointServiceProviderConfig,
  type ScimServiceProviderConfig,
} from '../api/queries';
import { CopyableJsonBlock, EmptyState, LoadingSkeleton, ScimErrorMessage } from '../components/primitives';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    minWidth: 0,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  heading: {
    margin: 0,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  capabilityGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '10px',
  },
  capability: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minHeight: '84px',
  },
  capabilityHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  sectionHeading: {
    margin: 0,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  authGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '10px',
  },
  authCard: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
});

function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

function capabilityRows(config: ScimServiceProviderConfig) {
  return [
    { key: 'patch', label: 'PATCH', supported: config.patch.supported },
    {
      key: 'filter',
      label: 'Filtering',
      supported: config.filter.supported,
      detail: config.filter.maxResults === undefined ? undefined : `${config.filter.maxResults} resources maximum`,
    },
    { key: 'etag', label: 'ETags', supported: config.etag.supported },
    {
      key: 'bulk',
      label: 'Bulk operations',
      supported: config.bulk.supported,
      detail: [
        config.bulk.maxOperations === undefined ? undefined : `${config.bulk.maxOperations} operations maximum`,
        formatBytes(config.bulk.maxPayloadSize) === undefined
          ? undefined
          : `${formatBytes(config.bulk.maxPayloadSize)} maximum payload`,
      ].filter(Boolean).join(', '),
    },
    { key: 'sort', label: 'Sorting', supported: config.sort?.supported === true },
    { key: 'changePassword', label: 'Password changes', supported: config.changePassword.supported },
  ];
}

export const ServiceProviderConfigTab: React.FC<{ endpointId: string }> = ({ endpointId }) => {
  const classes = useStyles();
  const query = useEndpointServiceProviderConfig(endpointId);

  if (query.isLoading) return <LoadingSkeleton count={6} height="84px" />;
  if (query.error) return <ScimErrorMessage error={query.error} />;
  if (!query.data) {
    return <EmptyState title="No Service Provider Config" body="The endpoint did not publish this discovery document." />;
  }

  const config = query.data;
  return (
    <div className={classes.root} data-testid="service-provider-config-tab">
      <header className={classes.header}>
        <h2 className={classes.heading}>Service Provider Config</h2>
        <Text>Effective SCIM capabilities published by this endpoint.</Text>
        {config.documentationUri && (
          <Link href={config.documentationUri} target="_blank" rel="noreferrer">
            Provider documentation
          </Link>
        )}
      </header>

      <section className={classes.section} aria-labelledby="spc-capabilities-heading">
        <h3 id="spc-capabilities-heading" className={classes.sectionHeading}>Capabilities</h3>
        <div className={classes.capabilityGrid}>
          {capabilityRows(config).map((capability) => (
            <Card
              key={capability.key}
              className={classes.capability}
              data-testid={`spc-capability-${capability.key}`}
            >
              <div className={classes.capabilityHeader}>
                <Text weight="semibold">{capability.label}</Text>
                <Badge color={capability.supported ? 'success' : 'informative'}>
                  {capability.supported ? 'Supported' : 'Not supported'}
                </Badge>
              </div>
              {capability.detail && <Text size={200}>{capability.detail}</Text>}
            </Card>
          ))}
        </div>
      </section>

      <section className={classes.section} aria-labelledby="spc-auth-heading">
        <h3 id="spc-auth-heading" className={classes.sectionHeading}>Authentication schemes</h3>
        {config.authenticationSchemes.length === 0 ? (
          <Text>No authentication schemes are published.</Text>
        ) : (
          <div className={classes.authGrid}>
            {config.authenticationSchemes.map((scheme, index) => (
              <Card key={`${scheme.type}-${scheme.name ?? index}`} className={classes.authCard}>
                <div className={classes.capabilityHeader}>
                  <Text weight="semibold">{scheme.name ?? scheme.type}</Text>
                  {scheme.primary && <Badge color="brand">Primary</Badge>}
                </div>
                <Text size={200}>{scheme.type}</Text>
                {scheme.description && <Text>{scheme.description}</Text>}
                {scheme.documentationUri && (
                  <Link href={scheme.documentationUri} target="_blank" rel="noreferrer">
                    Authentication documentation
                  </Link>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <CopyableJsonBlock value={config} label="Published JSON" data-testid="spc-json" />
    </div>
  );
};