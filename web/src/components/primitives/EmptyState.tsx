/**
 * EmptyState - displayed when a list / table / search result returns
 * zero rows. Encourages an action (CTA) when one is available.
 *
 * Used by Phases D (Activity / Schemas tabs) and E (Credentials,
 * Manual Provision) to replace ad-hoc "No X yet" Text snippets in
 * tab components with a single visual treatment.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase C3
 */
import React from 'react';
import { Body1, Button, Caption1, Subtitle2, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '48px 24px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
  icon: {
    fontSize: '48px',
    color: tokens.colorNeutralForeground4,
    marginBottom: '4px',
    lineHeight: 1,
  },
  body: {
    maxWidth: '420px',
  },
  cta: {
    marginTop: '12px',
  },
});

export interface EmptyStateProps {
  /** Optional ReactNode (typically a Fluent UI icon component). */
  icon?: React.ReactNode;
  /** One-line headline (e.g. "No credentials yet"). */
  title: string;
  /** Sub-line explaining what to do next. */
  body?: string;
  /** Optional action label - renders a Button when set with onAction. */
  actionLabel?: string;
  /** Click handler for the action button. */
  onAction?: () => void;
  /** Override the default test id for table-of-contents queries. */
  'data-testid'?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  ...rest
}) => {
  const classes = useStyles();
  const testId = rest['data-testid'] ?? 'empty-state';

  return (
    <div className={classes.root} role="status" aria-live="polite" data-testid={testId}>
      {icon !== undefined && (
        <div className={classes.icon} data-testid={`${testId}-icon`} aria-hidden="true">
          {icon}
        </div>
      )}
      <Subtitle2 data-testid={`${testId}-title`}>{title}</Subtitle2>
      {body && (
        <Body1 className={classes.body} data-testid={`${testId}-body`}>
          {body}
        </Body1>
      )}
      {actionLabel && onAction && (
        <Button
          appearance="primary"
          onClick={onAction}
          className={classes.cta}
          data-testid={`${testId}-action`}
        >
          {actionLabel}
        </Button>
      )}
      {/* Sub-caption rendered as a sibling so screen readers don't merge
          it with the body. Useful when a future caller wants to add a
          help link beneath the body without restyling. */}
      {!body && !actionLabel && (
        <Caption1 data-testid={`${testId}-caption`}>&nbsp;</Caption1>
      )}
    </div>
  );
};
