/**
 * ResourceTypesTab (Phase M3) - Custom Resource Type registration UI.
 *
 * Per [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S4.4], wires the
 * already-shipped custom-resource-type machinery (G8b, v0.18.0) into a
 * friendly UX. Pre-M3 the feature was invisible from the UI; customers
 * paying for "extensible SCIM" could not extend it without curl.
 *
 * Mounted as a nested tab under EndpointDetailPage between Schemas
 * and Credentials.
 *
 * Architecture note: as of v0.28.0 the dedicated admin RT API
 * (`POST /admin/endpoints/:id/resource-types`) was REMOVED. Custom
 * resource types now live in `endpoint.profile.resourceTypes[]` and
 * are added/removed via PATCH /admin/endpoints/:id with the merged
 * profile. M3 reuses `useUpdateEndpointConfig` (the L1 mutation hook
 * that powers SettingsTab) to avoid a parallel hook surface.
 *
 * Gating: `CustomResourceTypesEnabled` config flag controls whether
 * the wildcard SCIM controller answers /:resourceType requests, i.e.
 * whether the operator can register CUSTOM types. The tab always shows
 * a read-only inventory of the endpoint's current resource types
 * (built-in User/Group and any custom ones) regardless of the flag, so
 * a user-only endpoint still shows its supported User type. When the
 * flag is off, the create/delete affordances are hidden and an info
 * panel points at SettingsTab to enable custom registration.
 *
 * @see docs/PHASE_M3_CUSTOM_RESOURCE_TYPES.md
 * @see docs/G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md
 */
import React, { useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Badge,
  Subtitle1,
  Caption1,
  Text,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import {
  Add24Regular,
  Delete24Regular,
  CubeTree24Regular,
} from '@fluentui/react-icons';
import { useEndpoint, useUpdateEndpointConfig } from '../api/queries';
import { LoadingSkeleton } from '../components/primitives';
import { FormDialog } from '../components/primitives/FormDialog';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';

const RESERVED_NAMES = new Set(['User', 'Group']);
const RESERVED_ENDPOINTS = new Set([
  '/Users',
  '/Groups',
  '/Schemas',
  '/ResourceTypes',
  '/ServiceProviderConfig',
  '/Bulk',
  '/Me',
]);

interface ResourceType {
  id: string;
  name: string;
  endpoint: string;
  description?: string;
  schema: string;
  schemaExtensions?: Array<{ schema: string; required?: boolean }>;
}

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '8px',
  },
  invRow: {
    display: 'grid',
    gridTemplateColumns: '150px 90px 150px 1fr auto',
    columnGap: '12px',
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    alignItems: 'center',
    fontSize: tokens.fontSizeBase300,
  },
  flagHint: {
    color: tokens.colorNeutralForeground3,
  },
  monoCell: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  disabledPanel: {
    padding: '16px',
  },
});

function isCustomRt(rt: { name?: string }): boolean {
  return !!rt.name && !RESERVED_NAMES.has(rt.name);
}

function isBuiltInRt(rt: { name?: string }): boolean {
  return !!rt.name && RESERVED_NAMES.has(rt.name);
}

// Fail-open default: when the profile declares no resourceTypes the endpoint
// still serves the built-in User + Group (mirrors the server resolver in
// api/src/modules/scim/common/resource-type-resolver.ts). We surface those so
// the tab always shows the endpoint's current valid resource types - even when
// the CustomResourceTypesEnabled flag is off.
const DEFAULT_BUILTIN_RTS: ResourceType[] = [
  { id: 'User', name: 'User', endpoint: '/Users', schema: 'urn:ietf:params:scim:schemas:core:2.0:User' },
  { id: 'Group', name: 'Group', endpoint: '/Groups', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group' },
];

export interface ResourceTypesTabProps {
  endpointId: string;
}

export const ResourceTypesTab: React.FC<ResourceTypesTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const ep = useEndpoint(endpointId);
  const update = useUpdateEndpointConfig(endpointId);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEndpoint, setCreateEndpoint] = useState('');
  const [createSchema, setCreateSchema] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [submitError, setSubmitError] = useState<unknown>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResourceType | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const profile = ep.data?.profile as
    | {
        settings?: Record<string, unknown>;
        schemas?: Array<Record<string, unknown>>;
        resourceTypes?: ResourceType[];
      }
    | undefined;

  const flagOn = useMemo<boolean>(() => {
    const v = profile?.settings?.CustomResourceTypesEnabled;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true';
    return false;
  }, [profile]);

  const allRts: ResourceType[] = profile?.resourceTypes ?? [];
  // The inventory shown to the operator: declared types when present, else the
  // fail-open built-ins. customRts (used by the create/delete management UI) is
  // derived from the same inventory so a user-only endpoint shows User only.
  const inventory: ResourceType[] = allRts.length > 0 ? allRts : DEFAULT_BUILTIN_RTS;
  const customRts = inventory.filter(isCustomRt);

  // ─── Validation for the Create form ────────────────────────────────

  const nameError = (() => {
    if (createName.length === 0) return null;
    if (RESERVED_NAMES.has(createName)) return `Reserved name. Pick another.`;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(createName)) return `Must match ^[A-Za-z][A-Za-z0-9]*$`;
    if (allRts.some((r) => r.name === createName)) return `Already used on this endpoint.`;
    return null;
  })();

  const endpointError = (() => {
    if (createEndpoint.length === 0) return null;
    if (RESERVED_ENDPOINTS.has(createEndpoint)) return `Reserved endpoint path.`;
    if (!/^\/[A-Za-z][A-Za-z0-9]*$/.test(createEndpoint)) return `Must start with / and be alphanumeric.`;
    if (allRts.some((r) => r.endpoint === createEndpoint)) return `Already used on this endpoint.`;
    return null;
  })();

  const schemaError = createSchema.length === 0 || !createSchema.startsWith('urn:')
    ? createSchema.length === 0
      ? null
      : `Schema must be a URN starting with 'urn:'`
    : null;

  const createValid =
    createName.length > 0 &&
    createEndpoint.length > 0 &&
    createSchema.length > 0 &&
    nameError === null &&
    endpointError === null &&
    schemaError === null;

  const handleCreateOpen = (): void => {
    setCreateName('');
    setCreateEndpoint('');
    setCreateSchema('');
    setCreateDescription('');
    setSubmitError(null);
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (): Promise<void> => {
    if (!createValid || !profile) return;
    setSubmitError(null);
    const newRt: ResourceType = {
      id: createName,
      name: createName,
      endpoint: createEndpoint,
      description: createDescription || undefined,
      schema: createSchema,
      schemaExtensions: [],
    };
    const newSchema = {
      id: createSchema,
      name: createName,
      description: createDescription || `${createName} schema`,
      attributes: [],
    };
    const existingSchemas = profile.schemas ?? [];
    const schemaAlreadyPresent = existingSchemas.some((s) => s.id === createSchema);
    const mergedSchemas = schemaAlreadyPresent
      ? existingSchemas
      : [...existingSchemas, newSchema];
    const mergedRts = [...allRts, newRt as unknown as Record<string, unknown>] as unknown as ResourceType[];

    try {
      await update.mutateAsync({
        profile: {
          resourceTypes: mergedRts,
          schemas: mergedSchemas,
        },
      });
      setCreateOpen(false);
    } catch (e) {
      setSubmitError(e);
    }
  };

  const handleDeleteOpen = (rt: ResourceType): void => {
    setDeleteTarget(rt);
    setDeleteConfirm('');
    setSubmitError(null);
    setDeleteOpen(true);
  };

  const handleDeleteSubmit = async (): Promise<void> => {
    if (!deleteTarget || deleteConfirm !== deleteTarget.name) return;
    setSubmitError(null);
    const filtered = allRts.filter((r) => r.name !== deleteTarget.name);
    try {
      await update.mutateAsync({
        profile: {
          resourceTypes: filtered as unknown as Array<Record<string, unknown>>,
        },
      });
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (e) {
      setSubmitError(e);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────

  if (ep.isLoading) {
    return (
      <div className={classes.page} data-testid="resource-types-tab">
        <LoadingSkeleton count={5} height="40px" />
      </div>
    );
  }

  return (
    <div className={classes.page} data-testid="resource-types-tab">
      <div className={classes.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CubeTree24Regular />
          <Subtitle1>Resource types</Subtitle1>
        </div>
        {flagOn && (
          <Button
            appearance="primary"
            icon={<Add24Regular />}
            onClick={handleCreateOpen}
            data-testid="resource-types-create-button"
          >
            Create resource type
          </Button>
        )}
      </div>
      <Caption1>
        The resource types this endpoint currently serves. Built-in User and Group are listed
        unless the profile narrows them; custom types add a schema URN and expose a wildcard SCIM
        endpoint at
        <code style={{ marginLeft: '4px' }}>/scim/endpoints/{endpointId}/&lt;Endpoint&gt;</code>.
      </Caption1>

      {/* Always-visible inventory of the endpoint's current resource types. */}
      <Card style={{ padding: 0 }} data-testid="resource-types-inventory">
        <div className={classes.invRow} style={{ background: tokens.colorNeutralBackground2, fontWeight: 600 }}>
          <Caption1>name</Caption1>
          <Caption1>kind</Caption1>
          <Caption1>endpoint</Caption1>
          <Caption1>schema</Caption1>
          <span />
        </div>
        {inventory.map((rt) => {
          const builtIn = isBuiltInRt(rt);
          return (
            <div
              key={rt.name}
              className={classes.invRow}
              data-testid={`resource-types-row-${rt.name}`}
            >
              <Text weight="semibold">{rt.name}</Text>
              <Badge
                appearance="outline"
                color={builtIn ? 'informative' : 'brand'}
                data-testid={`resource-types-row-${rt.name}-kind`}
              >
                {builtIn ? 'built-in' : 'custom'}
              </Badge>
              <Text className={classes.monoCell}>{rt.endpoint}</Text>
              <Text className={classes.monoCell}>{rt.schema}</Text>
              {!builtIn && flagOn ? (
                <Button
                  appearance="subtle"
                  icon={<Delete24Regular />}
                  onClick={() => handleDeleteOpen(rt)}
                  data-testid={`resource-types-row-${rt.name}-delete`}
                  title={`Delete ${rt.name}`}
                />
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </Card>

      {flagOn && customRts.length === 0 && (
        <Caption1 className={classes.flagHint} data-testid="resource-types-empty">
          No custom resource types registered yet. Use &quot;Create resource type&quot; to add one
          beyond the built-in User and Group.
        </Caption1>
      )}

      {!flagOn && (
        <Card className={classes.disabledPanel} data-testid="resource-types-disabled-panel">
          <MessageBar intent="info">
            <MessageBarBody>
              <MessageBarTitle>Custom resource types are disabled</MessageBarTitle>
              The endpoint still serves the resource types listed above. The
              {' '}
              <code>CustomResourceTypesEnabled</code> config flag is off, so you cannot register
              custom types beyond the built-in User and Group yet. Turn it on from the Settings tab.
            </MessageBarBody>
          </MessageBar>
        </Card>
      )}

      {/* Create dialog */}
      <FormDialog
        open={createOpen}
        onCancel={() => {
          if (update.isPending) return;
          setCreateOpen(false);
        }}
        onSubmit={() => { void handleCreateSubmit(); }}
        title="Create custom resource type"
        submitLabel="Create"
        cancelLabel="Cancel"
        busy={update.isPending}
        disabled={!createValid}
        error={submitError}
        data-testid="resource-types-create-dialog"
      >
        <Field
          label="Name"
          validationState={nameError ? 'error' : 'none'}
          validationMessage={
            nameError ? <span data-testid="resource-types-create-name-error">{nameError}</span> : undefined
          }
        >
          <Input
            value={createName}
            onChange={(_e, d) => setCreateName(d.value)}
            placeholder="Device"
            data-testid="resource-types-create-name"
          />
        </Field>
        <Field
          label="Endpoint path (under /scim/endpoints/:id)"
          validationState={endpointError ? 'error' : 'none'}
          validationMessage={
            endpointError ? <span data-testid="resource-types-create-endpoint-error">{endpointError}</span> : undefined
          }
        >
          <Input
            value={createEndpoint}
            onChange={(_e, d) => setCreateEndpoint(d.value)}
            placeholder="/Devices"
            data-testid="resource-types-create-endpoint"
          />
        </Field>
        <Field
          label="Schema URN"
          validationState={schemaError ? 'error' : 'none'}
          validationMessage={schemaError ?? undefined}
        >
          <Input
            value={createSchema}
            onChange={(_e, d) => setCreateSchema(d.value)}
            placeholder="urn:ietf:params:scim:schemas:custom:Device"
            data-testid="resource-types-create-schema"
          />
        </Field>
        <Field label="Description (optional)">
          <Input
            value={createDescription}
            onChange={(_e, d) => setCreateDescription(d.value)}
            placeholder="Custom Device resource type"
            data-testid="resource-types-create-description"
          />
        </Field>
      </FormDialog>

      {/* Delete confirm dialog */}
      <FormDialog
        open={deleteOpen}
        onCancel={() => {
          if (update.isPending) return;
          setDeleteOpen(false);
          setDeleteTarget(null);
        }}
        onSubmit={() => { void handleDeleteSubmit(); }}
        title="Delete custom resource type"
        submitLabel="Delete"
        cancelLabel="Cancel"
        busy={update.isPending}
        disabled={!deleteTarget || deleteConfirm !== deleteTarget.name}
        error={submitError}
        data-testid="resource-types-delete-dialog"
      >
        {deleteTarget && (
          <>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>This deletes the registration only</MessageBarTitle>
                Existing resources of type {deleteTarget.name} stay in storage but become
                unreachable through SCIM until you re-register the type. Type the name to confirm.
              </MessageBarBody>
            </MessageBar>
            <Text className={classes.monoCell}>{deleteTarget.name}</Text>
            <Field label="Confirm name">
              <Input
                value={deleteConfirm}
                onChange={(_e, d) => setDeleteConfirm(d.value)}
                placeholder={deleteTarget.name}
                data-testid="resource-types-delete-confirm"
              />
            </Field>
          </>
        )}
      </FormDialog>

      {/* Generic error surface for non-form errors */}
      {!createOpen && !deleteOpen && submitError != null && (
        <ScimErrorMessage error={submitError} />
      )}
    </div>
  );
};
