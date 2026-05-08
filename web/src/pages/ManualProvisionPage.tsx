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
  Input,
  Switch,
  Button,
  Card,
  Spinner,
  TabList,
  Tab,
  type TabValue,
  Subtitle1,
  Subtitle2,
  Caption1,
  Text,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import { Add24Regular, Person24Regular, People24Regular } from '@fluentui/react-icons';
import { useEndpoints, useCreateUser, useCreateGroup } from '../api/queries';

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
  switchRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '4px',
  },
  pre: {
    fontFamily: 'monospace',
    fontSize: '12px',
    backgroundColor: tokens.colorNeutralBackground3,
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '480px',
    overflow: 'auto',
  },
  center: {
    display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '180px',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px' },
});

// ─── User schema URN ──────────────────────────────────────────────────

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';

// ─── Form sub-components ──────────────────────────────────────────────

interface CreateUserFormProps {
  endpointId: string;
  isPending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}

const CreateUserForm: React.FC<CreateUserFormProps> = ({ endpointId, isPending, onSubmit }) => {
  const classes = useStyles();
  const [userName, setUserName] = React.useState('');
  const [externalId, setExternalId] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [givenName, setGivenName] = React.useState('');
  const [familyName, setFamilyName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [active, setActive] = React.useState(true);

  const formId = React.useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userName.trim()) return;
    const body: Record<string, unknown> = {
      schemas: [USER_SCHEMA],
      userName: userName.trim(),
      active,
    };
    if (externalId.trim()) body.externalId = externalId.trim();
    if (displayName.trim()) body.displayName = displayName.trim();
    if (givenName.trim() || familyName.trim()) {
      body.name = {
        ...(givenName.trim() ? { givenName: givenName.trim() } : {}),
        ...(familyName.trim() ? { familyName: familyName.trim() } : {}),
      };
    }
    if (email.trim()) {
      body.emails = [{ value: email.trim(), primary: true, type: 'work' }];
    }
    onSubmit(body);
  }

  const disabled = !endpointId || isPending;
  return (
    <form id={formId} onSubmit={handleSubmit} className={classes.formCard} data-testid="create-user-form">
      <Field label="userName" required>
        <Input value={userName} onChange={(_, d) => setUserName(d.value)} disabled={disabled} required />
      </Field>
      <Field label="externalId">
        <Input value={externalId} onChange={(_, d) => setExternalId(d.value)} disabled={disabled} />
      </Field>
      <Field label="displayName">
        <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} disabled={disabled} />
      </Field>
      <Field label="givenName">
        <Input value={givenName} onChange={(_, d) => setGivenName(d.value)} disabled={disabled} />
      </Field>
      <Field label="familyName">
        <Input value={familyName} onChange={(_, d) => setFamilyName(d.value)} disabled={disabled} />
      </Field>
      <Field label="email">
        <Input value={email} onChange={(_, d) => setEmail(d.value)} type="email" disabled={disabled} />
      </Field>
      <div className={classes.switchRow}>
        <Text>active</Text>
        <Switch
          aria-label="active"
          checked={active}
          onChange={(_, d) => setActive(d.checked)}
          disabled={disabled}
        />
      </div>
      <div className={classes.actions}>
        <Button
          appearance="primary"
          icon={<Add24Regular />}
          type="submit"
          disabled={disabled}
        >
          Create User
        </Button>
      </div>
    </form>
  );
};

interface CreateGroupFormProps {
  endpointId: string;
  isPending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}

const CreateGroupForm: React.FC<CreateGroupFormProps> = ({ endpointId, isPending, onSubmit }) => {
  const classes = useStyles();
  const [displayName, setDisplayName] = React.useState('');
  const [externalId, setExternalId] = React.useState('');
  const [memberText, setMemberText] = React.useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    const body: Record<string, unknown> = {
      schemas: [GROUP_SCHEMA],
      displayName: displayName.trim(),
    };
    if (externalId.trim()) body.externalId = externalId.trim();
    const memberIds = memberText
      .split(/[\s,]+/u)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (memberIds.length > 0) {
      body.members = memberIds.map((value) => ({ value }));
    }
    onSubmit(body);
  }

  const disabled = !endpointId || isPending;
  return (
    <form onSubmit={handleSubmit} className={classes.formCard} data-testid="create-group-form">
      <Field label="displayName" required>
        <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} disabled={disabled} required />
      </Field>
      <Field label="externalId">
        <Input value={externalId} onChange={(_, d) => setExternalId(d.value)} disabled={disabled} />
      </Field>
      <Field label="members (comma-separated user ids)" hint="Optional. Each token becomes a {value} entry on members[].">
        <Input value={memberText} onChange={(_, d) => setMemberText(d.value)} disabled={disabled} />
      </Field>
      <div className={classes.actions}>
        <Button
          appearance="primary"
          icon={<Add24Regular />}
          type="submit"
          disabled={disabled}
        >
          Create Group
        </Button>
      </div>
    </form>
  );
};

interface ProvisionResultProps {
  result: { kind: 'success'; resource: Record<string, unknown> } | { kind: 'error'; message: string } | null;
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
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>Create failed</MessageBarTitle>
            {result.message}
          </MessageBarBody>
        </MessageBar>
      </Card>
    );
  }
  const id = (result.resource.id as string | undefined) ?? '(no id)';
  return (
    <Card className={classes.resultCard} data-testid="provision-result-success">
      <MessageBar intent="success">
        <MessageBarBody>
          <MessageBarTitle>Created</MessageBarTitle>
          Resource id: <Text weight="semibold">{id}</Text>
        </MessageBarBody>
      </MessageBar>
      <Caption1>Server response</Caption1>
      <pre className={classes.pre}>{JSON.stringify(result.resource, null, 2)}</pre>
    </Card>
  );
};

// ─── Main page ───────────────────────────────────────────────────────

type Tab = 'user' | 'group';

export const ManualProvisionPage: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpoints();
  const [endpointId, setEndpointId] = React.useState('');
  const [tab, setTab] = React.useState<Tab>('user');
  const [result, setResult] = React.useState<
    { kind: 'success'; resource: Record<string, unknown> } | { kind: 'error'; message: string } | null
  >(null);

  // Mutations - always create the hooks (React rule of hooks); they
  // accept '' but we only invoke mutateAsync when endpointId is set.
  const createUser = useCreateUser(endpointId);
  const createGroup = useCreateGroup(endpointId);

  if (isLoading) {
    return (
      <div className={classes.center} data-testid="manual-provision-loading">
        <Spinner label="Loading endpoints..." />
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
      setResult(null);
    }
  }

  async function submitUser(body: Record<string, unknown>) {
    setResult(null);
    try {
      const resource = (await createUser.mutateAsync(body)) as Record<string, unknown>;
      setResult({ kind: 'success', resource });
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : 'Create failed.' });
    }
  }

  async function submitGroup(body: Record<string, unknown>) {
    setResult(null);
    try {
      const resource = (await createGroup.mutateAsync(body)) as Record<string, unknown>;
      setResult({ kind: 'success', resource });
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : 'Create failed.' });
    }
  }

  return (
    <div className={classes.root} data-testid="manual-provision-page">
      <Subtitle1>Manual Provisioning</Subtitle1>
      <Caption1>
        Provision a SCIM User or Group through the admin path. Select a target endpoint
        and resource type to begin.
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
          selectedValue={tab}
          onTabSelect={(_, d) => { setTab(d.value as Tab); setResult(null); }}
        >
          <Tab value="user" icon={<Person24Regular />}>User</Tab>
          <Tab value="group" icon={<People24Regular />}>Group</Tab>
        </TabList>
      </Card>

      <div className={classes.body}>
        {tab === 'user' ? (
          <CreateUserForm
            endpointId={endpointId}
            isPending={createUser.isPending}
            onSubmit={submitUser}
          />
        ) : (
          <CreateGroupForm
            endpointId={endpointId}
            isPending={createGroup.isPending}
            onSubmit={submitGroup}
          />
        )}
        <ProvisionResult result={result} />
      </div>
    </div>
  );
};
