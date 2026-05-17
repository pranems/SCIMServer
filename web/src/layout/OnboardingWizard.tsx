/**
 * OnboardingWizard (Phase N2).
 *
 * Chrome-level first-run wizard mounted once in AppShell. Walks an
 * operator through endpoint creation -> first credential -> first
 * Workbench request in 4 steps, reducing "first useful action" time
 * from ~20 minutes to ~2 minutes.
 *
 * Trigger logic lives in [useOnboarding.ts](../hooks/useOnboarding.ts).
 * Dismissed at any step writes `localStorage.scimserver.onboarding.completedAt`
 * via `markOnboardingComplete()` so the wizard never auto-reappears
 * (an explicit "Show onboarding again" link in SettingsPage clears
 * the flag and re-opens it via the `forceOpen` escape hatch).
 *
 * Architecture choices:
 *
 *   - One component handles all 4 steps with a local `step` state.
 *     The L1 CreateEndpointWizard uses the same pattern; the
 *     wizard is short enough that splitting into 4 components would
 *     just shuffle props around.
 *   - Reuses L1's `useCreateEndpoint` and E1's `useCreateCredential`
 *     mutation hooks - no new HTTP surface. The endpoint is created
 *     on the Step 2 -> Step 3 transition; the credential is issued
 *     on operator click in Step 3.
 *   - Step 3 mirrors the E1 CredentialsTab plaintext-token UX: the
 *     token is rendered ONCE in a monospace copy-to-clipboard box
 *     with the same warning copy ("save it now - cannot be
 *     recovered"). E1 covers the recovery semantics live.
 *   - Step 4 navigates to `/workbench` with the M1 deep-link
 *     contract: `?prefill=<urlencoded JSON {method, path, body?}>`.
 *
 * Out of scope (deferred per analysis-doc S5.8):
 *   - Server-side "is this a fresh tenant" check (deferred to N4)
 *   - Tour guide / coach-mark overlay (deferred indefinitely)
 *   - Localized welcome copy (deferred to 5.3 i18n)
 *
 * @see docs/PHASE_N2_ONBOARDING_WIZARD.md
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S5.8
 * @see web/src/pages/CreateEndpointWizard.tsx (L1 4-step template)
 * @see web/src/pages/CredentialsTab.tsx (E1 plaintext-token UX)
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Card,
  Subtitle1,
  Subtitle2,
  Text,
  Caption1,
  Badge,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Dismiss20Regular,
  Copy16Regular,
  Rocket24Regular,
} from '@fluentui/react-icons';
import { useNavigate } from '@tanstack/react-router';
import {
  usePresets,
  useCreateEndpoint,
  useCreateCredential,
} from '../api/queries';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import {
  useShowOnboarding,
  markOnboardingComplete,
} from '../hooks/useOnboarding';

type Step = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
  1: 'Welcome to SCIMServer',
  2: 'Pick a preset',
  3: 'Issue your first credential',
  4: 'Send your first request',
};

const useStyles = makeStyles({
  surface: {
    maxWidth: '720px',
    width: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  stepDots: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
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
    border: `1px solid ${tokens.colorBrandBackground}`,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  presetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '12px',
  },
  presetCard: {
    cursor: 'pointer',
    padding: '12px',
    border: `1px solid transparent`,
  },
  presetCardSelected: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    boxShadow: tokens.shadow4Brand,
  },
  tokenBox: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    padding: '12px',
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    wordBreak: 'break-all',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
});

const DEFAULT_PRESET = 'entra-id';

export const OnboardingWizard: React.FC = () => {
  const show = useShowOnboarding();

  if (!show) return null;
  return <OnboardingWizardInner />;
};

const OnboardingWizardInner: React.FC = () => {
  const classes = useStyles();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [picked, setPicked] = useState<string>(DEFAULT_PRESET);
  const [createdEndpointId, setCreatedEndpointId] = useState<string | undefined>();
  const [plaintextToken, setPlaintextToken] = useState<string | undefined>();
  const [advanceError, setAdvanceError] = useState<unknown>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const presets = usePresets();
  const createEndpoint = useCreateEndpoint();
  // useCreateCredential needs an endpointId at hook time. We bind a
  // placeholder until step 2 -> 3 transition stores the real one;
  // the hook only fires its mutation when the operator clicks the
  // Issue button (Step 3), so the placeholder is never used.
  const createCredential = useCreateCredential(createdEndpointId ?? '');

  const dismiss = (): void => {
    markOnboardingComplete();
  };

  const handleGetStarted = (): void => {
    setAdvanceError(null);
    setStep(2);
  };

  const handlePickPreset = (name: string): void => {
    setPicked(name);
  };

  const handleStep2Next = async (): Promise<void> => {
    setAdvanceError(null);
    try {
      // Generate a deterministic-ish name that's unlikely to collide.
      const stamp = Date.now().toString(36);
      const created = await createEndpoint.mutateAsync({
        name: `onboarding-${stamp}`,
        displayName: 'Onboarding endpoint',
        description: 'Created by the first-run onboarding wizard.',
        profilePreset: picked,
      });
      setCreatedEndpointId(created.id);
      setStep(3);
    } catch (err) {
      setAdvanceError(err);
    }
  };

  const handleIssueCredential = async (): Promise<void> => {
    setAdvanceError(null);
    try {
      const raw = await createCredential.mutateAsync({ label: 'onboarding-first' });
      // CreateCredential controller returns { id, label, token, ... }
      // with `token` as the plaintext bearer string (locked at backend
      // by the "Token is returned ONLY here" contract).
      const cred = raw as unknown as { token?: string };
      if (typeof cred?.token === 'string') {
        setPlaintextToken(cred.token);
      }
    } catch (err) {
      setAdvanceError(err);
    }
  };

  const handleCopyToken = async (): Promise<void> => {
    if (!plaintextToken) return;
    try {
      await navigator.clipboard.writeText(plaintextToken);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  const handleStep3Next = (): void => {
    setStep(4);
  };

  const handleSendItNow = (): void => {
    if (!createdEndpointId) return;
    const prefill = encodeURIComponent(
      JSON.stringify({
        method: 'GET',
        path: `/scim/endpoints/${createdEndpointId}/Users`,
      }),
    );
    dismiss();
    void navigate({
      to: '/workbench',
      search: { prefill } as Record<string, string>,
    });
  };

  const handleDoThisLater = (): void => {
    dismiss();
  };

  return (
    <Dialog open modalType="modal">
      <DialogSurface className={classes.surface} data-testid="onboarding-wizard">
        <DialogBody>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                icon={<Dismiss20Regular />}
                aria-label="Close onboarding"
                data-testid="onboarding-close"
                onClick={dismiss}
              />
            }
          >
            <Rocket24Regular style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {STEP_TITLES[step]}
          </DialogTitle>
          <DialogContent>
            <div
              className={classes.stepDots}
              aria-label={`Step ${step} of 4`}
            >
              {[1, 2, 3, 4].map((n) => (
                <span
                  key={n}
                  className={`${classes.stepDot} ${n === step ? classes.stepDotActive : ''}`}
                  data-testid={`onboarding-step-dot-${n}`}
                >
                  {n}
                </span>
              ))}
            </div>

            {step === 1 && (
              <div className={classes.body} data-testid="onboarding-step-1">
                <Subtitle2>Set up your first SCIM endpoint in 3 quick steps.</Subtitle2>
                <Text>
                  SCIMServer hosts SCIM 2.0 endpoints for testing identity-provider
                  integrations. This wizard walks you through creating an endpoint,
                  issuing a bearer credential, and sending your first request -
                  all without leaving the UI.
                </Text>
                <Caption1>
                  You can dismiss this at any time and re-open it later from Settings.
                </Caption1>
              </div>
            )}

            {step === 2 && (
              <div className={classes.body} data-testid="onboarding-step-2">
                <Subtitle2>Pick the schema profile that matches your IdP.</Subtitle2>
                {presets.isLoading ? (
                  <Spinner />
                ) : presets.error ? (
                  <Text>Failed to load presets: {(presets.error as Error).message}</Text>
                ) : (
                  <div className={classes.presetGrid}>
                    {presets.data?.presets.map((p) => {
                      const selected = p.name === picked;
                      return (
                        <Card
                          key={p.name}
                          className={`${classes.presetCard} ${selected ? classes.presetCardSelected : ''}`}
                          onClick={() => handlePickPreset(p.name)}
                          data-testid={`onboarding-preset-card-${p.name}`}
                          data-selected={selected ? 'true' : 'false'}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Subtitle2>{p.name}</Subtitle2>
                            {p.default ? <Badge appearance="filled" size="small">Default</Badge> : null}
                          </div>
                          <Caption1>
                            {p.summary?.schemaCount ?? 0} schemas /{' '}
                            {p.summary?.resourceTypeCount ?? 0} resource types
                          </Caption1>
                        </Card>
                      );
                    })}
                  </div>
                )}
                <ScimErrorMessage error={advanceError} />
              </div>
            )}

            {step === 3 && (
              <div className={classes.body} data-testid="onboarding-step-3">
                <Subtitle2>Issue a bearer credential for your new endpoint.</Subtitle2>
                <Text>
                  Your SCIM client (Entra ID, Okta, curl) needs a bearer token to
                  call the endpoint. Click below to issue one - the plaintext value
                  is shown exactly once and cannot be recovered later.
                </Text>
                {!plaintextToken ? (
                  <Button
                    appearance="primary"
                    onClick={() => {
                      void handleIssueCredential();
                    }}
                    disabled={createCredential.isPending || !createdEndpointId}
                    data-testid="onboarding-issue-credential"
                  >
                    {createCredential.isPending ? 'Issuing...' : 'Issue first credential'}
                  </Button>
                ) : (
                  <>
                    <MessageBar intent="warning">
                      <MessageBarBody>
                        <MessageBarTitle>Save this token now</MessageBarTitle>
                        The plaintext value is shown ONCE. The server only stores a
                        bcrypt hash - we cannot recover the original.
                      </MessageBarBody>
                    </MessageBar>
                    <div className={classes.tokenBox} data-testid="onboarding-plaintext-token">
                      <span>{plaintextToken}</span>
                      <Button
                        appearance="subtle"
                        icon={<Copy16Regular />}
                        onClick={() => {
                          void handleCopyToken();
                        }}
                        data-testid="onboarding-copy-token"
                      >
                        {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : 'Copy'}
                      </Button>
                    </div>
                  </>
                )}
                <ScimErrorMessage error={advanceError} />
              </div>
            )}

            {step === 4 && (
              <div className={classes.body} data-testid="onboarding-step-4">
                <Subtitle2>Try a SCIM request in the Workbench.</Subtitle2>
                <Text>
                  We will pre-fill a <code>GET /scim/endpoints/{createdEndpointId ?? '...'}/Users</code>{' '}
                  request so you can verify everything works end-to-end. The
                  Workbench supports every SCIM verb and copies-as-curl/PowerShell
                  for hand-off to your IdP team.
                </Text>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            {step === 1 && (
              <>
                <Button
                  appearance="subtle"
                  onClick={dismiss}
                  data-testid="onboarding-skip"
                >
                  Skip
                </Button>
                <Button
                  appearance="primary"
                  onClick={handleGetStarted}
                  data-testid="onboarding-get-started"
                >
                  Get started
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button onClick={() => setStep(1)}>Back</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    void handleStep2Next();
                  }}
                  disabled={!picked || createEndpoint.isPending}
                  data-testid="onboarding-step-2-next"
                >
                  {createEndpoint.isPending ? 'Creating endpoint...' : 'Next'}
                </Button>
              </>
            )}
            {step === 3 && (
              <Button
                appearance="primary"
                onClick={handleStep3Next}
                disabled={!plaintextToken}
                data-testid="onboarding-step-3-next"
              >
                Next
              </Button>
            )}
            {step === 4 && (
              <>
                <Button
                  appearance="subtle"
                  onClick={handleDoThisLater}
                  data-testid="onboarding-do-this-later"
                >
                  I will do this later
                </Button>
                <Button
                  appearance="primary"
                  onClick={handleSendItNow}
                  disabled={!createdEndpointId}
                  data-testid="onboarding-send-it-now"
                >
                  Send it now
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
