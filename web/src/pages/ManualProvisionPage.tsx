/**
 * ManualProvisionPage - top-level /manual-provision UX (Phase E3).
 *
 * Replaces the legacy components/manual/ManualProvision form. Workflow:
 *   1. User picks a target endpoint from a Combobox driven by useEndpoints.
 *   2. A TabList lets them choose User vs Group resource type.
 *   3. The matching form (CreateUserForm / CreateGroupForm) collects
 *      the minimum SCIM-required fields (userName for Users, displayName
 *      for Groups) plus a small set of common optional ones.
 *   4. Submit fires useCreateUser / useCreateGroup against the chosen
 *      endpoint; the ProvisionResult panel shows the returned resource
 *      id + raw JSON on success, or the server error message on failure.
 *
 * The legacy component used a bespoke createManualUser / createManualGroup
 * REST helper. This page goes through the standard SCIM hooks instead so
 * the cache invalidation (users/groups list, dashboard, overview) is
 * consistent with the rest of the redesigned UI - any open UsersTab on
 * the picked endpoint will refetch automatically.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Combobox,
  Option,
  Field,
  Button,
  Card,
  TabList,
  Tab,
  Subtitle1,
  Caption1,
  Text,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import { Add24Regular, Person24Regular, People24Regular } from '@fluentui/react-icons';
import {
  useCreateGroup,
  useCreateResource,
  useCreateUser,
  useEndpointResourceTypes,
  useEndpointSchemas,
  useEndpoints,
} from '../api/queries';
import { LoadingSkeleton, ScimErrorMessage, CopyableField, CopyableJsonBlock } from '../components/primitives';
import { ProfileResourceBodyEditor } from '../resources/ProfileResourceBodyEditor';
import {
  buildCreatePayload,
  resolveEffectiveResourceShape,
  type EffectiveResourceShape,
} from '../resources/profile-resource-shape';

// ─── Styles ───────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' },
  pickerCard: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  body: {
    display: 'grid',
    gridTemplateColumns: 'minmax(360px, 1fr) minmax(320px, 1fr)',
    gap: '16px',
  },
  formCard: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  resultCard: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' },
  center: {
    display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '180px',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px' },
});

// ─── Form sub-components ──────────────────────────────────────────────

interface ManualResourceFormProps {
  endpointId: string;
  shape: EffectiveResourceShape;
  isPending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}

const ManualResourceForm: React.FC<ManualResourceFormProps> = ({
  endpointId,
  shape,
  isPending,
  onSubmit,
}) => {
  const classes = useStyles();
  const [payload, setPayload] = React.useState<Record<string, unknown>>({});
  const [valid, setValid] = React.useState(true);

  React.useEffect(() => {
    setPayload(buildCreatePayload(
      shape,
      Object.fromEntries(shape.fields.map((field) => [field.id, field.example])),
    ));
    setValid(true);
  }, [shape]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!endpointId || isPending || !valid) return;
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className={classes.formCard} data-testid="manual-resource-create-form">
      <ProfileResourceBodyEditor
        key={shape.resourceType.id}
        shape={shape}
        body={payload}
        onChange={setPayload}
        onValidityChange={setValid}
        disabled={!endpointId || isPending}
        data-testid="manual-resource"
      />
      <div className={classes.actions}>
        <Button
          appearance="primary"
          icon={<Add24Regular />}
          type="submit"
          disabled={!endpointId || isPending || !valid}
        >
          Create {shape.resourceType.name}
        </Button>
      </div>
    </form>
  );
};

interface ProvisionResultProps {
  result: { kind: 'success'; resource: Record<string, unknown> } | { kind: 'error'; error: unknown } | null;
}

const ProvisionResult: React.FC<ProvisionResultProps> = ({ result }) => {
  const classes = useStyles();
  if (!result) {
    return (
      <Card className={classes.resultCard} data-testid="provision-result-empty">
        <Caption1>Result</Caption1>
        <Text>Submit a form to see the created resource here.</Text>
      </Card>
    );
  }
  if (result.kind === 'error') {
    return (
      <Card className={classes.resultCard} data-testid="provision-result-error">
        <ScimErrorMessage error={result.error} />
      </Card>
    );
  }
  const id = (result.resource.id as string | undefined) ?? '(no id)';
  return (
    <Card className={classes.resultCard} data-testid="provision-result-success">
      <MessageBar intent="success">
        <MessageBarBody>
          <MessageBarTitle>Created</MessageBarTitle>
          <span>Resource id: </span>
          <CopyableField
            value={id}
            monospace
            data-testid="provision-result-id"
            ariaLabel={`Copy resource id ${id}`}
          />
        </MessageBarBody>
      </MessageBar>
      <CopyableJsonBlock
        value={result.resource}
        label="Server response"
        data-testid="provision-result-json"
      />
    </Card>
  );
};

// ─── Main page ───────────────────────────────────────────────────────

export const ManualProvisionPage: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpoints();
  const [endpointId, setEndpointId] = React.useState('');
  const [resourceTypeId, setResourceTypeId] = React.useState('User');
  const [result, setResult] = React.useState<
    { kind: 'success'; resource: Record<string, unknown> } | { kind: 'error'; error: unknown } | null
  >(null);

  // Mutations - always create the hooks (React rule of hooks); they
  // accept '' but we only invoke mutateAsync when endpointId is set.
  const createUser = useCreateUser(endpointId);
  const createGroup = useCreateGroup(endpointId);
  const schemasQuery = useEndpointSchemas(endpointId);
  const resourceTypesQuery = useEndpointResourceTypes(endpointId);
  const resourceTypes = resourceTypesQuery.data?.Resources ?? [];
  const activeResourceType = resourceTypes.find((resourceType) =>
    resourceType.id === resourceTypeId || resourceType.name === resourceTypeId);
  const createResource = useCreateResource(endpointId, activeResourceType?.endpoint ?? '');
  const shape = React.useMemo(() => {
    if (!activeResourceType || !schemasQuery.data) return undefined;
    try {
      return resolveEffectiveResourceShape(activeResourceType, schemasQuery.data.Resources);
    } catch {
      return undefined;
    }
  }, [activeResourceType, schemasQuery.data]);

  React.useEffect(() => {
    if (resourceTypes.length === 0) return;
    if (!resourceTypes.some((resourceType) => resourceType.id === resourceTypeId)) {
      setResourceTypeId(resourceTypes[0].id);
    }
  }, [resourceTypeId, resourceTypes]);

  if (isLoading) {
    // G1 - skeleton mirrors the page (header + endpoint picker + tabs +
    // form area) instead of an indeterminate Spinner.
    return (
      <div data-testid="manual-provision-loading">
        <LoadingSkeleton count={1} height="40px" data-testid="manual-provision-skeleton-header" />
        <LoadingSkeleton count={1} height="56px" data-testid="manual-provision-skeleton-picker" />
        <LoadingSkeleton count={5} height="40px" data-testid="manual-provision-skeleton-form" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={classes.center} data-testid="manual-provision-error">
        <Text>Failed to load endpoints.</Text>
      </div>
    );
  }

  const endpoints = data.endpoints;
  const selected = endpoints.find((e) => e.id === endpointId);

  function selectEndpoint(_e: unknown, d: { optionValue?: string }) {
    if (d.optionValue) {
      setEndpointId(d.optionValue);
      setResourceTypeId('');
      setResult(null);
    }
  }

  async function submitResource(body: Record<string, unknown>) {
    setResult(null);
    try {
      const resource = (activeResourceType?.name === 'User'
        ? await createUser.mutateAsync(body)
        : activeResourceType?.name === 'Group'
          ? await createGroup.mutateAsync(body)
          : await createResource.mutateAsync(body)) as Record<string, unknown>;
      setResult({ kind: 'success', resource });
    } catch (err) {
      // Pass the raw error so <ScimErrorMessage /> can map scimType +
      // status to a plain-English explanation (Phase K3).
      setResult({ kind: 'error', error: err });
    }
  }

  const pending = activeResourceType?.name === 'User'
    ? createUser.isPending
    : activeResourceType?.name === 'Group'
      ? createGroup.isPending
      : createResource.isPending;

  return (
    <div className={classes.root} data-testid="manual-provision-page">
      <Subtitle1>Manual Provisioning</Subtitle1>
      <Caption1>
        Create any SCIM resource declared by the selected endpoint profile.
      </Caption1>

      <Card className={classes.pickerCard}>
        <Field label="Target endpoint" required>
          <Combobox
            aria-label="Target endpoint"
            placeholder={endpoints.length === 0 ? 'No endpoints available' : 'Pick an endpoint'}
            value={selected ? (selected.displayName ?? selected.name) : ''}
            selectedOptions={endpointId ? [endpointId] : []}
            onOptionSelect={selectEndpoint}
            disabled={endpoints.length === 0}
          >
            {endpoints.map((ep) => (
              <Option key={ep.id} value={ep.id} text={ep.displayName ?? ep.name}>
                {ep.displayName ?? ep.name}
              </Option>
            ))}
          </Combobox>
        </Field>
        <TabList
          selectedValue={resourceTypeId}
          onTabSelect={(_, d) => { setResourceTypeId(String(d.value)); setResult(null); }}
        >
          {resourceTypes.map((resourceType) => (
            <Tab
              key={resourceType.id}
              value={resourceType.id}
              icon={resourceType.name === 'User'
                ? <Person24Regular />
                : resourceType.name === 'Group'
                  ? <People24Regular />
                  : undefined}
            >
              {resourceType.name}
            </Tab>
          ))}
        </TabList>
      </Card>

      <div className={classes.body}>
        {shape ? (
          <ManualResourceForm
            endpointId={endpointId}
            shape={shape}
            isPending={pending}
            onSubmit={(body) => void submitResource(body)}
          />
        ) : (
          <Card className={classes.formCard} data-testid="manual-resource-profile-state">
            <Text>
              {endpointId
                ? 'Loading the selected endpoint profile...'
                : 'Select a target endpoint to load its resource forms.'}
            </Text>
          </Card>
        )}
        <ProvisionResult result={result} />
      </div>
    </div>
  );
};
