/**
 * CreateEndpointWizard (Phase L1) - 4-step wizard at `/endpoints/new`.
 *
 * Wires the already-shipped `POST /admin/endpoints` surface
 * (v0.30.0; see [endpoint.controller.ts](../../api/src/modules/endpoint/controllers/endpoint.controller.ts))
 * into the redesigned UI. Until L1 the only way to create an endpoint
 * was a hand-crafted curl command - L1 makes the redesigned admin UI
 * truly self-service.
 *
 * Step layout (per docs/PHASE_L1_ENDPOINT_CRUD.md S2.1):
 *   1. Identity & Preset - name (required) + display name (opt) + preset (required)
 *   2. Preview - read-only display of preset's schemas, settings, SPC
 *   3. Override - placeholder for future per-flag override grid (Step 3
 *      is currently optional and Next is always enabled; the grid will
 *      be wired in a follow-up commit once a shared BOOLEAN_FLAGS
 *      registry is extracted from SettingsTab into its own module so
 *      the wizard chunk does not re-import SettingsTab and merge
 *      chunks)
 *   4. Confirm - read-only summary + Create button
 *
 * The mutation is `useCreateEndpoint` (Phase L1 hook). On success the
 * wizard navigates straight to `/endpoints/{newId}`. On 400 (duplicate
 * name) or any other ScimApiError, the K3 `<ScimErrorMessage />`
 * primitive renders the structured catalog explanation inline.
 *
 * Preset picker design choice: the picker is a single-select list of
 * Cards (one per preset) rather than a Fluent UI Combobox. The Card
 * surface lets us show schemaCount / resourceTypeCount / default
 * badge inline, and is easier to drive in jsdom (Combobox open/close
 * + keyboard listbox are flaky in unit tests).
 */
import React, { useState } from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Input,
  Field,
  Card,
  Badge,
  Subtitle1,
  Subtitle2,
  Text,
  Caption1,
  MessageBar,
  MessageBarBody,
  Spinner,
} from '@fluentui/react-components';
import { useNavigate } from '@tanstack/react-router';
import {
  useCreateEndpoint,
  usePresets,
  usePresetDetail,
  type CreateEndpointBody,
} from '../api/queries';
import { LoadingSkeleton, EmptyState, CopyJsonButton } from '../components/primitives';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '900px',
    margin: '0 auto',
    padding: '24px',
  },
  stepHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
  },
  stepNumbers: {
    display: 'flex',
    gap: '8px',
  },
  stepDot: {
    minWidth: '28px',
    minHeight: '28px',
    borderRadius: '50%',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyMonospace,
  },
  stepDotActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    borderColor: tokens.colorBrandBackground,
  },
  stepBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  presetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '12px',
  },
  presetCard: {
    cursor: 'pointer',
    padding: '12px',
    border: `1px solid transparent`,
  },
  presetCardSelected: {
    borderColor: tokens.colorBrandStroke1,
    boxShadow: tokens.shadow4Brand,
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    paddingTop: '16px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
});

type WizardStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Identity & Preset',
  2: 'Preview',
  3: 'Override (optional)',
  4: 'Confirm',
};

export const CreateEndpointWizard: React.FC = () => {
  const classes = useStyles();
  const navigate = useNavigate();

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const presets = usePresets();
  const presetDetail = usePresetDetail(picked);
  const createMutation = useCreateEndpoint();

  // Step 1 gate: name + preset must both be set before Next enables.
  const step1Valid = name.trim().length > 0 && !!picked;

  const goNext = (): void => {
    if (step === 1 && !step1Valid) return;
    if (step === 4) return;
    setStep((step + 1) as WizardStep);
  };
  const goBack = (): void => {
    if (step === 1) return;
    setStep((step - 1) as WizardStep);
  };
  const goCancel = (): void => {
    void navigate({ to: '/endpoints' });
  };

  const handleCreate = async (): Promise<void> => {
    if (!step1Valid) return;
    setSubmitError(null);
    const body: CreateEndpointBody = {
      name: name.trim(),
      profilePreset: picked,
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
    };
    try {
      const created = await createMutation.mutateAsync(body);
      void navigate({
        to: '/endpoints/$endpointId',
        params: { endpointId: created.id },
      });
    } catch (err) {
      setSubmitError(err);
    }
  };

  return (
    <div className={classes.page} data-testid="create-endpoint-wizard">
      <div className={classes.stepHeader}>
        <Subtitle1>Create endpoint</Subtitle1>
        <div className={classes.stepNumbers} aria-label={`Step ${step} of 4: ${STEP_LABELS[step]}`}>
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={`${classes.stepDot} ${n === step ? classes.stepDotActive : ''}`}
              data-testid={`wizard-step-dot-${n}`}
            >
              {n}
            </span>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className={classes.stepBody} data-testid="wizard-step-1">
          <Field
            label="Name"
            required
            hint="Allowed characters: letters, digits, hyphen, underscore."
          >
            <Input
              value={name}
              onChange={(_e, d) => setName(d.value)}
              placeholder="prod-tenant"
              data-testid="wizard-name-input"
            />
          </Field>

          <Field label="Display name (optional)">
            <Input
              value={displayName}
              onChange={(_e, d) => setDisplayName(d.value)}
              placeholder="Production tenant"
              data-testid="wizard-displayname-input"
            />
          </Field>

          <Field label="Description (optional)">
            <Input
              value={description}
              onChange={(_e, d) => setDescription(d.value)}
              data-testid="wizard-description-input"
            />
          </Field>

          <Field label="Preset" required hint="Determines schemas, settings, and SCIM contract.">
            <div className={classes.presetGrid} data-testid="wizard-preset-combobox">
              {presets.isLoading ? (
                <LoadingSkeleton count={3} height="80px" data-testid="wizard-preset-skeleton" />
              ) : presets.error ? (
                <Text>Failed to load presets: {(presets.error as Error).message}</Text>
              ) : (presets.data?.presets ?? []).length === 0 ? (
                <EmptyState title="No presets" body="The server reported zero built-in profile presets." />
              ) : (
                (presets.data?.presets ?? []).map((p) => {
                  const selected = p.name === picked;
                  return (
                    <Card
                      key={p.name}
                      className={`${classes.presetCard} ${selected ? classes.presetCardSelected : ''}`}
                      onClick={() => setPicked(p.name)}
                      role="button"
                      aria-pressed={selected}
                      data-testid={`wizard-preset-option-${p.name}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text weight="semibold">{p.name}</Text>
                        {p.default ? (
                          <Badge appearance="filled" color="brand">
                            default
                          </Badge>
                        ) : null}
                      </div>
                      <Caption1>
                        {p.summary?.schemaCount ?? 0} schemas, {p.summary?.resourceTypeCount ?? 0} resource types
                      </Caption1>
                    </Card>
                  );
                })
              )}
            </div>
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className={classes.stepBody} data-testid="wizard-step-2">
          <Subtitle2>Preset preview: {picked}</Subtitle2>
          {presetDetail.isLoading ? (
            <Spinner data-testid="wizard-preset-detail-spinner" />
          ) : presetDetail.error ? (
            <Text>Failed to load preset detail: {(presetDetail.error as Error).message}</Text>
          ) : presetDetail.data ? (
            <PresetPreview detail={presetDetail.data} />
          ) : (
            <Text>No detail loaded.</Text>
          )}
        </div>
      )}

      {step === 3 && (
        <div className={classes.stepBody} data-testid="wizard-step-3">
          <Subtitle2>Override settings (optional)</Subtitle2>
          <MessageBar intent="info">
            <MessageBarBody>
              Per-flag overrides will be available here in the next L1 follow-up
              once the shared boolean-flag registry is extracted. For now
              the preset defaults are accepted as-is. You can edit any flag
              after creation from the endpoint Settings tab.
            </MessageBarBody>
          </MessageBar>
        </div>
      )}

      {step === 4 && (
        <div className={classes.stepBody} data-testid="wizard-step-4">
          <Subtitle2>Confirm</Subtitle2>
          <Card>
            <SummaryRow label="Name" value={name} />
            {displayName ? <SummaryRow label="Display name" value={displayName} /> : null}
            {description ? <SummaryRow label="Description" value={description} /> : null}
            <SummaryRow label="Preset" value={picked ?? ''} />
          </Card>
          <ScimErrorMessage error={submitError} />
        </div>
      )}

      <div className={classes.buttonRow}>
        <div>
          <Button
            appearance="subtle"
            onClick={goCancel}
            data-testid="wizard-cancel-button"
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {step > 1 && (
            <Button
              onClick={goBack}
              data-testid="wizard-back-button"
              disabled={createMutation.isPending}
            >
              Back
            </Button>
          )}
          {step < 4 ? (
            <Button
              appearance="primary"
              onClick={goNext}
              disabled={step === 1 && !step1Valid}
              data-testid="wizard-next-button"
            >
              Next
            </Button>
          ) : (
            <Button
              appearance="primary"
              onClick={() => {
                void handleCreate();
              }}
              disabled={!step1Valid || createMutation.isPending}
              data-testid="wizard-create-button"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const classes = useStyles();
  return (
    <div className={classes.summaryRow}>
      <Caption1>{label}</Caption1>
      <Text weight="semibold">{value}</Text>
    </div>
  );
};

const PresetPreview: React.FC<{ detail: { profile: Record<string, unknown> } }> = ({ detail }) => {
  const profile = detail.profile;
  const schemas = (profile.schemas as Array<{ name?: string; id?: string }> | undefined) ?? [];
  const resourceTypes = (profile.resourceTypes as Array<{ name?: string; id?: string }> | undefined) ?? [];
  const settings = (profile.settings as Record<string, unknown> | undefined) ?? {};
  const spc = (profile.serviceProviderConfig as Record<string, { supported?: boolean }> | undefined) ?? {};

  return (
    <div data-testid="wizard-preset-preview" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <CopyJsonButton
          value={profile}
          label="Copy preset profile as JSON"
          data-testid="wizard-preset-copy-json"
          appearance="secondary"
        />
      </div>
      <Card>
        <Subtitle2>Schemas ({schemas.length} schemas)</Subtitle2>
        <ul>
          {schemas.map((s) => (
            <li key={s.id ?? s.name}>
              <Caption1 style={{ fontFamily: 'monospace' }}>{s.name ?? s.id}</Caption1>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <Subtitle2>{resourceTypes.length} resource types</Subtitle2>
        <ul>
          {resourceTypes.map((r) => (
            <li key={r.id ?? r.name}>
              <Caption1>{r.name ?? r.id}</Caption1>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <Subtitle2>ServiceProviderConfig</Subtitle2>
        <ul>
          {Object.entries(spc).map(([k, v]) => (
            <li key={k}>
              <Caption1>
                {k}: {v && typeof v === 'object' && 'supported' in v ? String(v.supported) : '-'}
              </Caption1>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <Subtitle2>Default settings ({Object.keys(settings).length})</Subtitle2>
        <ul>
          {Object.entries(settings).map(([k, v]) => (
            <li key={k}>
              <Caption1>
                {k}: {String(v)}
              </Caption1>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};
