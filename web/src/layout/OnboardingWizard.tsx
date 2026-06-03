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
 *   - Thin step-dispatcher (this file). Per-step UI lives in
 *     `web/src/layout/onboarding/Step*.tsx` (extracted 2026-05-17,
 *     Stage X.1 A.4 closure - was a single 478-line monolith).
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
} from '@fluentui/react-components';
import {
  Dismiss20Regular,
  Rocket24Regular,
} from '@fluentui/react-icons';
import { useNavigate } from '@tanstack/react-router';
import {
  usePresets,
  useCreateEndpoint,
  useCreateCredential,
} from '../api/queries';
import {
  useShowOnboarding,
  markOnboardingComplete,
} from '../hooks/useOnboarding';
import {
  Step,
  STEP_TITLES,
  DEFAULT_PRESET,
  useOnboardingStyles,
} from './onboarding/onboarding-styles';
import { StepDots } from './onboarding/StepDots';
import { StepWelcome } from './onboarding/StepWelcome';
import { StepPickPreset } from './onboarding/StepPickPreset';
import { StepIssueCredential } from './onboarding/StepIssueCredential';
import { StepSendRequest } from './onboarding/StepSendRequest';

export const OnboardingWizard: React.FC = () => {
  const show = useShowOnboarding();

  if (!show) return null;
  return <OnboardingWizardInner />;
};

const OnboardingWizardInner: React.FC = () => {
  const classes = useOnboardingStyles();
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
            <StepDots step={step} />

            {step === 1 && <StepWelcome />}

            {step === 2 && (
              <StepPickPreset
                presets={{
                  isLoading: presets.isLoading,
                  error: presets.error as Error | null,
                  data: presets.data,
                }}
                picked={picked}
                onPick={handlePickPreset}
                advanceError={advanceError}
              />
            )}

            {step === 3 && (
              <StepIssueCredential
                plaintextToken={plaintextToken}
                copyState={copyState}
                isPending={createCredential.isPending}
                hasEndpointId={Boolean(createdEndpointId)}
                onIssue={() => {
                  void handleIssueCredential();
                }}
                onCopy={() => {
                  void handleCopyToken();
                }}
                advanceError={advanceError}
              />
            )}

            {step === 4 && <StepSendRequest endpointId={createdEndpointId} />}
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
