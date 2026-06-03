/**
 * Step 3 - Issue first credential (Phase N2 OnboardingWizard).
 *
 * Renders the issue-credential button or the plaintext-token copy box
 * (E1 one-shot UX). Extracted from OnboardingWizard.tsx (2026-05-17,
 * Stage X.1 A.4 closure). data-testid attributes preserved exactly.
 */
import React from 'react';
import {
  Button,
  Subtitle2,
  Text,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import { Copy16Regular } from '@fluentui/react-icons';
import { ScimErrorMessage } from '../../components/primitives/ScimErrorMessage';
import { useOnboardingStyles } from './onboarding-styles';

export interface StepIssueCredentialProps {
  plaintextToken: string | undefined;
  copyState: 'idle' | 'copied' | 'error';
  isPending: boolean;
  hasEndpointId: boolean;
  onIssue: () => void;
  onCopy: () => void;
  advanceError: unknown;
}

export const StepIssueCredential: React.FC<StepIssueCredentialProps> = ({
  plaintextToken,
  copyState,
  isPending,
  hasEndpointId,
  onIssue,
  onCopy,
  advanceError,
}) => {
  const classes = useOnboardingStyles();
  return (
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
          onClick={onIssue}
          disabled={isPending || !hasEndpointId}
          data-testid="onboarding-issue-credential"
        >
          {isPending ? 'Issuing...' : 'Issue first credential'}
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
              onClick={onCopy}
              data-testid="onboarding-copy-token"
            >
              {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : 'Copy'}
            </Button>
          </div>
        </>
      )}
      <ScimErrorMessage error={advanceError} />
    </div>
  );
};
