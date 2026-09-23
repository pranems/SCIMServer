import React from 'react';
import {
  Button,
  Caption1,
  Subtitle2,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Add24Regular } from '@fluentui/react-icons';
import {
  useCreateResource,
  useEndpointResources,
  useEndpointResourceTypes,
  useEndpointSchemas,
} from '../api/queries';
import {
  CopyableField,
  EmptyState,
  LoadingSkeleton,
} from '../components/primitives';
import {
  ResourceDetailDrawer,
  type ScimResource,
} from '../components/detail/ResourceDetailDrawer';
import { clickableProps } from '../utils/interactive';
import { CreateProfileResourceDialog } from '../resources/CreateProfileResourceDialog';
import {
  resolveEffectiveResourceShape,
  valueForField,
} from '../resources/profile-resource-shape';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
  },
  th: {
    width: '25%',
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: `2px solid ${tokens.colorNeutralStroke1}`,
    color: tokens.colorNeutralForeground3,
    fontSize: '13px',
  },
  td: {
    width: '25%',
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: 'hidden',
    fontSize: '13px',
  },
  row: {
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  error: {
    padding: '24px',
    color: tokens.colorPaletteRedForeground1,
  },
});

export interface GenericResourcesTabProps {
  endpointId: string;
  resourceTypeId: string;
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const GenericResourcesTab: React.FC<GenericResourcesTabProps> = ({
  endpointId,
  resourceTypeId,
}) => {
  const classes = useStyles();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<ScimResource | undefined>();
  const schemasQuery = useEndpointSchemas(endpointId);
  const resourceTypesQuery = useEndpointResourceTypes(endpointId);
  const resourceType = resourceTypesQuery.data?.Resources.find((candidate) =>
    candidate.id === resourceTypeId || candidate.name === resourceTypeId);
  const resourceEndpoint = resourceType?.endpoint ?? '';
  const resourcesQuery = useEndpointResources(endpointId, resourceEndpoint, {
    startIndex: 1,
    count: 100,
  });
  const createResource = useCreateResource(endpointId, resourceEndpoint);
  const shape = React.useMemo(() => {
    if (!resourceType || !schemasQuery.data) return undefined;
    try {
      return resolveEffectiveResourceShape(resourceType, schemasQuery.data.Resources);
    } catch {
      return undefined;
    }
  }, [resourceType, schemasQuery.data]);

  if (schemasQuery.isLoading || resourceTypesQuery.isLoading || resourcesQuery.isLoading) {
    return (
      <div className={classes.root} data-testid="custom-resources-loading">
        <LoadingSkeleton count={6} height="40px" />
      </div>
    );
  }

  const error = schemasQuery.error ?? resourceTypesQuery.error ?? resourcesQuery.error;
  if (error || !resourceType || !shape) {
    return (
      <div className={classes.error} data-testid="custom-resources-error">
        <Text>Could not load {resourceTypeId} resources: {error?.message ?? 'Profile metadata is incomplete.'}</Text>
      </div>
    );
  }

  const resources = (resourcesQuery.data?.Resources ?? []) as ScimResource[];
  const total = resourcesQuery.data?.totalResults ?? resources.length;
  const displayFields = shape.fields
    .filter((field) => field.type !== 'complex' && !field.multiValued)
    .slice(0, 2);

  return (
    <div className={classes.root} data-testid="custom-resources-tab">
      <div className={classes.header}>
        <div>
          <Subtitle2>{total} {resourceType.name}{total === 1 ? '' : ' resources'}</Subtitle2>
          {resourceType.description && <Caption1>{resourceType.description}</Caption1>}
        </div>
        <Button
          appearance="primary"
          icon={<Add24Regular />}
          onClick={() => setCreateOpen(true)}
          data-testid="custom-resources-create"
        >
          Create {resourceType.name}
        </Button>
      </div>

      {resources.length === 0 ? (
        <EmptyState
          title={`No ${resourceType.name} resources`}
          body={`Create the first ${resourceType.name} resource for this endpoint.`}
          actionLabel={`Create ${resourceType.name}`}
          onAction={() => setCreateOpen(true)}
          data-testid="custom-resources-empty"
        />
      ) : (
        <table className={classes.table}>
          <thead>
            <tr>
              <th className={classes.th}>ID</th>
              {displayFields.map((field) => (
                <th className={classes.th} key={field.id}>{field.label}</th>
              ))}
              <th className={classes.th}>Last modified</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => (
              <tr
                key={resource.id}
                className={classes.row}
                {...clickableProps(
                  () => setSelected(resource),
                  `Open ${resourceType.name} ${resource.id}`,
                )}
                data-testid={`custom-resource-row-${resource.id}`}
              >
                <td className={classes.td}>
                  <CopyableField
                    value={resource.id}
                    monospace
                    truncate
                    maxWidth="100%"
                    data-testid={`custom-resource-id-${resource.id}`}
                  />
                </td>
                {displayFields.map((field) => (
                  <td className={classes.td} key={field.id}>
                    <CopyableField
                      value={displayValue(valueForField(field, resource))}
                      truncate
                      maxWidth="100%"
                      data-testid={`custom-resource-${field.name}-${resource.id}`}
                    />
                  </td>
                ))}
                <td className={classes.td}>
                  <Caption1>{displayValue(resource.meta?.lastModified)}</Caption1>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CreateProfileResourceDialog
        open={createOpen}
        shape={shape}
        onCreate={(payload) => createResource.mutateAsync(payload)}
        onClose={() => setCreateOpen(false)}
      />

      {selected && (
        <ResourceDetailDrawer
          kind="custom"
          endpointId={endpointId}
          resourceEndpoint={resourceType.endpoint}
          resource={selected}
          shape={shape}
          open
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
};