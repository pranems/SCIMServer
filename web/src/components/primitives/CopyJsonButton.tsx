/**
 * CopyJsonButton - one-click "copy this thing as pretty-printed JSON"
 * button. The canonical affordance for surfaces that show a structured
 * payload (an SCIM resource, a schema definition, a request/response
 * body, a discovery diff) where the operator's natural next action is
 * "give me that as JSON so I can paste it into Postman / a ticket /
 * a regression spec."
 *
 * Distinct from CopyableField which copies a single string value.
 * CopyJsonButton serialises an object via JSON.stringify(value, null,
 * indent) so the clipboard receives a human-readable block.
 *
 * Reuses useCopyToClipboard for the success / error / auto-reset
 * state machine so all copy buttons in the app feel identical.
 *
 * Testid: `<id>` is the button itself; tooltip + aria-label are
 * derived from the `label` prop ("Copy as JSON" by default).
 */
import * as React from 'react';
import { Button, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  Code16Regular,
  Checkmark16Regular,
  ErrorCircle16Regular,
} from '@fluentui/react-icons';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

const useStyles = makeStyles({
  button: {
    minWidth: 'auto',
    height: '24px',
    padding: '0 8px',
    gap: '4px',
  },
});

export interface CopyJsonButtonProps {
  /** The object/value to serialise + copy. Anything JSON.stringify can handle. */
  value: unknown;
  /** Indent spaces. Default 2 (matches the rest of our pretty-printed JSON). */
  indent?: number;
  /** Button label - rendered inline next to the icon. Default "Copy as JSON". */
  label?: string;
  /** Optional `data-testid`; used directly on the button. */
  'data-testid'?: string;
  /** Accessible label override. Defaults to `Copy <label> as JSON`. */
  ariaLabel?: string;
  /** Tooltip placement; default "above". */
  tooltipPlacement?: 'above' | 'below' | 'before' | 'after';
  /** Button appearance; default "subtle". */
  appearance?: 'subtle' | 'outline' | 'primary' | 'transparent' | 'secondary';
  /** Hide the inline text label and render icon-only (use ariaLabel for a11y). */
  iconOnly?: boolean;
}

export const CopyJsonButton: React.FC<CopyJsonButtonProps> = ({
  value,
  indent = 2,
  label = 'Copy as JSON',
  'data-testid': testId,
  ariaLabel,
  tooltipPlacement = 'above',
  appearance = 'subtle',
  iconOnly = false,
}) => {
  const classes = useStyles();
  const { copy, status } = useCopyToClipboard();

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    let payload: string;
    try {
      payload = JSON.stringify(value, null, indent) ?? 'null';
    } catch {
      // Cyclical structure or BigInt: fall back to String() so the
      // operator gets SOMETHING rather than nothing.
      payload = String(value);
    }
    void copy(payload);
  };

  const tooltipContent =
    status === 'copied' ? 'Copied!' : status === 'error' ? 'Failed to copy' : label;

  const icon =
    status === 'copied' ? (
      <Checkmark16Regular />
    ) : status === 'error' ? (
      <ErrorCircle16Regular />
    ) : (
      <Code16Regular />
    );

  return (
    <Tooltip content={tooltipContent} relationship="label" positioning={tooltipPlacement}>
      <Button
        appearance={appearance}
        icon={icon}
        size="small"
        className={classes.button}
        onClick={onClick}
        data-testid={testId}
        aria-label={ariaLabel ?? label}
      >
        {iconOnly ? undefined : label}
      </Button>
    </Tooltip>
  );
};
