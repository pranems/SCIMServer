import React from 'react';
import {
  Button,
  Caption1,
  Card,
  Field,
  Subtitle2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { BeakerEdit24Regular } from '@fluentui/react-icons';
import {
  useEndpointResources,
  useEndpointResourceTypes,
  useEndpointSchemas,
} from '../api/queries';
import {
  buildEndpointWorkbenchTemplates,
  buildResourceWorkbenchTemplates,
  getStaticWorkbenchTemplates,
  type WorkbenchRequestTemplate,
  type WorkbenchTemplateResource,
} from './workbench-templates';

const useStyles = makeStyles({
  root: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  controls: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 1fr) minmax(260px, 2fr) auto',
    gap: '8px',
    alignItems: 'end',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  select: {
    width: '100%',
    height: '32px',
    padding: '0 8px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  hint: {
    minHeight: '18px',
    color: tokens.colorNeutralForeground3,
  },
});

export interface WorkbenchEndpointOption {
  id: string;
  name: string;
  displayName?: string;
}

export interface WorkbenchExamplesPanelProps {
  endpoints: WorkbenchEndpointOption[];
  endpointId: string;
  onEndpointChange: (endpointId: string) => void;
  onApply: (template: WorkbenchRequestTemplate) => void;
}

export const WorkbenchExamplesPanel: React.FC<WorkbenchExamplesPanelProps> = ({
  endpoints,
  endpointId,
  onEndpointChange,
  onApply,
}) => {
  const classes = useStyles();
  const [exampleSuffix] = React.useState(() =>
    `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
  const [resourceTypeId, setResourceTypeId] = React.useState('');
  const [templateId, setTemplateId] = React.useState('server-health');
  const schemas = useEndpointSchemas(endpointId);
  const resourceTypesQuery = useEndpointResourceTypes(endpointId);
  const resourceTypes = resourceTypesQuery.data?.Resources ?? [];
  const selectedResourceType = resourceTypes.find((resourceType) =>
    resourceType.id === resourceTypeId) ?? resourceTypes[0];
  const selectedResourceTypeId = selectedResourceType?.id ?? '';
  const existingResources = useEndpointResources(
    endpointId,
    selectedResourceType?.endpoint ?? '',
    { startIndex: 1, count: 1 },
  );

  React.useEffect(() => {
    setResourceTypeId('');
  }, [endpointId]);

  const templates = React.useMemo(() => {
    const result = [
      ...getStaticWorkbenchTemplates(exampleSuffix),
      ...buildEndpointWorkbenchTemplates(endpointId),
    ];
    if (!endpointId || !selectedResourceType || !schemas.data) return result;
    try {
      result.push(...buildResourceWorkbenchTemplates({
        endpointId,
        resourceType: selectedResourceType,
        schemas: schemas.data.Resources,
        existingResource: existingResources.data?.Resources[0] as
          | WorkbenchTemplateResource
          | undefined,
        exampleSuffix,
      }));
    } catch {
      // Static and endpoint examples remain usable when discovery is incomplete.
    }
    return result;
  }, [endpointId, exampleSuffix, existingResources.data, schemas.data, selectedResourceType]);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
  const selectedTemplateId = selectedTemplate?.id ?? '';
  const discoveryError = schemas.error ?? resourceTypesQuery.error ?? existingResources.error;

  return (
    <Card className={classes.root} data-testid="workbench-examples-panel">
      <div className={classes.header}>
        <BeakerEdit24Regular />
        <Subtitle2>Examples</Subtitle2>
      </div>
      <div className={classes.controls}>
        <Field label="Endpoint context">
          <select
            aria-label="Endpoint context"
            className={classes.select}
            value={endpointId}
            onChange={(event) => onEndpointChange(event.target.value)}
            data-testid="workbench-endpoint-picker"
          >
            <option value="">Server and admin only</option>
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.displayName ?? endpoint.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ResourceType">
          <select
            aria-label="ResourceType context"
            className={classes.select}
            value={selectedResourceTypeId}
            onChange={(event) => setResourceTypeId(event.target.value)}
            disabled={!endpointId || resourceTypes.length === 0}
            data-testid="workbench-example-resource-type"
          >
            {!endpointId && <option value="">Select an endpoint</option>}
            {endpointId && resourceTypes.length === 0 && <option value="">No ResourceTypes</option>}
            {resourceTypes.map((resourceType) => (
              <option key={resourceType.id} value={resourceType.id}>{resourceType.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Request example">
          <select
            aria-label="Request example"
            className={classes.select}
            value={selectedTemplateId}
            onChange={(event) => setTemplateId(event.target.value)}
            data-testid="workbench-example-template"
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.category} - {template.label}
              </option>
            ))}
          </select>
        </Field>
        <Button
          appearance="primary"
          onClick={() => selectedTemplate && onApply(selectedTemplate)}
          disabled={!selectedTemplate}
          data-testid="workbench-example-apply"
        >
          Apply
        </Button>
      </div>
      <Caption1 className={classes.hint} data-testid="workbench-example-description">
        {discoveryError
          ? `Discovery is unavailable: ${discoveryError.message}. Static examples remain available.`
          : selectedTemplate?.description}
      </Caption1>
    </Card>
  );
};