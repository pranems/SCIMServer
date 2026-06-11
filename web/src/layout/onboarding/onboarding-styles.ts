/**
 * Shared styles + types for the OnboardingWizard surface (Phase N2).
 *
 * Extracted from OnboardingWizard.tsx (2026-05-17, Stage X.1 A.4
 * closure) so the wizard becomes a thin step-dispatcher and per-step
 * bodies live in dedicated files under `web/src/layout/onboarding/`.
 * No behavior change.
 */
import { makeStyles, tokens } from '@fluentui/react-components';

export type Step = 1 | 2 | 3 | 4;

export const STEP_TITLES: Record<Step, string> = {
  1: 'Welcome to SCIMServer',
  2: 'Pick a preset',
  3: 'Issue your first credential',
  4: 'Send your first request',
};

export const DEFAULT_PRESET = 'entra-id';

export const useOnboardingStyles = makeStyles({
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
