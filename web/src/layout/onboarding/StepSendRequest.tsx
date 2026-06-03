/**
 * Step 4 - Send first request (Phase N2 OnboardingWizard).
 *
 * Renders the Workbench prefill teaser copy. Extracted from
 * OnboardingWizard.tsx (2026-05-17, Stage X.1 A.4 closure).
 * data-testid attribute preserved exactly.
 */
import React from 'react';
import { Subtitle2, Text } from '@fluentui/react-components';
import { useOnboardingStyles } from './onboarding-styles';

export interface StepSendRequestProps {
  endpointId: string | undefined;
}

export const StepSendRequest: React.FC<StepSendRequestProps> = ({ endpointId }) => {
  const classes = useOnboardingStyles();
  return (
    <div className={classes.body} data-testid="onboarding-step-4">
      <Subtitle2>Try a SCIM request in the Workbench.</Subtitle2>
      <Text>
        We will pre-fill a <code>GET /scim/endpoints/{endpointId ?? '...'}/Users</code>{' '}
        request so you can verify everything works end-to-end. The
        Workbench supports every SCIM verb and copies-as-curl/PowerShell
        for hand-off to your IdP team.
      </Text>
    </div>
  );
};
