/**
 * Step-progress dots for the OnboardingWizard (Phase N2).
 *
 * Extracted from OnboardingWizard.tsx (2026-05-17, Stage X.1 A.4
 * closure). data-testid attributes preserved exactly for test
 * compatibility.
 */
import React from 'react';
import { Step, useOnboardingStyles } from './onboarding-styles';

export interface StepDotsProps {
  step: Step;
}

export const StepDots: React.FC<StepDotsProps> = ({ step }) => {
  const classes = useOnboardingStyles();
  return (
    <div className={classes.stepDots} aria-label={`Step ${step} of 4`}>
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
  );
};
