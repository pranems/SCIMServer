/**
 * Step 1 - Welcome (Phase N2 OnboardingWizard).
 *
 * Static intro copy. No props - the wizard owns step state and
 * footer actions. Extracted from OnboardingWizard.tsx
 * (2026-05-17, Stage X.1 A.4 closure).
 */
import React from 'react';
import { Subtitle2, Text, Caption1 } from '@fluentui/react-components';
import { useOnboardingStyles } from './onboarding-styles';

export const StepWelcome: React.FC = () => {
  const classes = useOnboardingStyles();
  return (
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
  );
};
